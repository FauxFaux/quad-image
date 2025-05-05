mod gallery;
pub mod ingest;
#[cfg(test)]
mod tests;
mod thumbs;

use std::future::IntoFuture;
use std::io::Read;
use std::io::Write;
use std::net::{SocketAddr, ToSocketAddrs as _};
use std::sync::Arc;
use std::sync::Mutex;
use std::{env, fs, path};

use anyhow::{anyhow, Context, Error, Result};
use axum::body::Bytes;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Multipart, Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use lazy_static::lazy_static;
use rand::RngCore;
use serde_json::{json, Value};
use tokio::task::JoinSet;
use tower_http::services::ServeDir;

lazy_static! {
    static ref IMAGE_ID: regex::Regex =
        regex::Regex::new("^e/[a-zA-Z0-9]{10}\\.(?:png|jpg|gif)$").expect("static regex");
    static ref GALLERY_SPEC: regex::Regex =
        regex::Regex::new("^([a-zA-Z][a-zA-Z0-9]{3,9})!(.{4,99})$").expect("static regex");
}

type Caller<'h> = (SocketAddr, Option<&'h HeaderValue>);

struct UploadForm {
    image: Bytes,
    return_json: bool,
    return_redirect: bool,
    return_full_url: bool,
}

enum UploadFormStatus {
    Form(UploadForm),
    BadRequest(&'static str),
}

async fn extract_image_form(mut body: Multipart) -> Result<UploadFormStatus> {
    let mut image: Option<Bytes> = None;
    let mut return_json: bool = false;
    let mut return_redirect: bool = false;
    let mut return_full_url: bool = false;
    while let Some(field) = body.next_field().await? {
        let name = field
            .name()
            .ok_or_else(|| anyhow!("unnamed field"))?
            .to_string();
        let data = field.bytes().await?;
        match name.as_str() {
            "image" if image.is_none() => image = Some(data),
            "image" => return Ok(UploadFormStatus::BadRequest("exactly one upload required")),
            "return_json" => match &*data {
                b"true" => return_json = true,
                b"false" => return_json = false,
                _ => return Ok(UploadFormStatus::BadRequest("invalid return_json value")),
            },
            "return_redirect" => match &*data {
                b"true" => return_redirect = true,
                b"false" => return_redirect = false,
                _ => {
                    return Ok(UploadFormStatus::BadRequest(
                        "invalid return_redirect value",
                    ))
                }
            },
            "return_full_url" => match &*data {
                b"true" => return_full_url = true,
                b"false" => return_full_url = false,
                _ => {
                    return Ok(UploadFormStatus::BadRequest(
                        "invalid return_full_url value",
                    ))
                }
            },
            _ => (),
        }
    }

    match image {
        Some(image) => Ok(UploadFormStatus::Form(UploadForm {
            image,
            return_json,
            return_redirect,
            return_full_url,
        })),
        None => Ok(UploadFormStatus::BadRequest("no image provided")),
    }
}

async fn upload(
    ConnectInfo(conn_info): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    body: Multipart,
) -> (StatusCode, HeaderMap, Response) {
    let caller: Caller = (conn_info, headers.get("X-Forwarded-For"));

    let nh = |(s, b): (StatusCode, Json<Value>)| (s, HeaderMap::new(), b.into_response());
    let form = match extract_image_form(body).await {
        Ok(UploadFormStatus::Form(form)) => form,
        Ok(UploadFormStatus::BadRequest(message)) => return nh(bad_request(message)),
        Err(e) => return nh(log_error("parsing image form", &caller, &e)),
    };

    match ingest::store(&form.image) {
        Ok(image_id) => {
            println!("{caller:?}: {image_id}");

            if let Err(e) = thumbs::thumbnail(&image_id) {
                return nh(log_error("thumbnailing just written", &caller, &e));
            }

            let status = if form.return_redirect {
                StatusCode::SEE_OTHER
            } else {
                StatusCode::OK
            };

            let mut map = HeaderMap::new();
            let url = if form.return_full_url {
                let host = match headers
                    .get("X-Forwarded-Host")
                    .or_else(|| headers.get("host"))
                    .and_then(|h| h.to_str().ok())
                {
                    Some(host) => host,
                    None => return nh(bad_request("missing host header")),
                };
                format!("https://{host}/{image_id}")
            } else {
                image_id
            };

            if form.return_redirect {
                // relative to api/upload
                map.insert(
                    "Location",
                    HeaderValue::from_str(&url).expect("controlled string format"),
                );
            }

            let resp = if form.return_json {
                map.insert(
                    "Content-Type",
                    HeaderValue::from_static("application/vnd.api+json; charset=utf-8"),
                );
                data_response(resource_object(url, "image")).into_response()
            } else {
                map.insert(
                    "Content-Type",
                    HeaderValue::from_static("text/plain; charset=utf-8"),
                );
                url.into_response()
            };

            (status, map, resp)
        }
        Err(e) => nh(log_error("storing image", &caller, &e)),
    }
}

/// http://jsonapi.org/format/#errors
fn error_object(message: &str) -> Json<Value> {
    println!("error: {}", message);
    Json(json!({ "errors": [
        { "title": message }
    ] }))
}

fn json_api_validate_obj(obj: &serde_json::Map<String, Value>) {
    assert!(obj.contains_key("id"), "id is mandatory in {:?}", obj);
    assert!(obj.contains_key("type"), "type is mandatory in {:?}", obj);
}

/// panic if something isn't valid json-api.
/// panic is fine because the structure should be static in code
/// could be only tested at debug time..
fn json_api_validate(obj: &Value) {
    if let Some(obj) = obj.as_object() {
        json_api_validate_obj(obj)
    } else if let Some(list) = obj.as_array() {
        for obj in list {
            if let Some(obj) = obj.as_object() {
                json_api_validate_obj(obj)
            } else {
                panic!("array item must be obj, not {:?}", obj);
            }
        }
    } else {
        panic!("data response contents must be obj, not {:?}", obj);
    }
}

/// http://jsonapi.org/format/#document-top-level
fn data_response(inner: Value) -> Json<Value> {
    json_api_validate(&inner);
    Json(json!({ "data": inner }))
}

/// http://jsonapi.org/format/#document-resource-objects
fn resource_object<I: AsRef<str>>(id: I, type_: &'static str) -> Value {
    json!({ "id": id.as_ref(), "type": type_ })
}

fn bad_request(message: &str) -> (StatusCode, Json<Value>) {
    (StatusCode::BAD_REQUEST, error_object(message))
}

fn log_error(location: &str, caller: &Caller, error: &Error) -> (StatusCode, Json<Value>) {
    println!("{caller:?}: failed: {location}: {error:?}",);
    (StatusCode::INTERNAL_SERVER_ERROR, error_object(location))
}

#[derive(serde::Deserialize)]
struct GalleryAttributes {
    gallery: String,
    images: Vec<String>,
}

#[derive(serde::Deserialize)]
struct GalleryData {
    #[serde(rename = "type")]
    type_: String,
    attributes: GalleryAttributes,
}

#[derive(serde::Deserialize)]
struct GalleryInput {
    data: GalleryData,
}

#[axum_macros::debug_handler]
async fn gallery_put(
    ConnectInfo(conn_info): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    State(state): State<Arc<Ctx>>,
    Json(body): Json<GalleryInput>,
) -> (StatusCode, Json<Value>) {
    let caller: Caller = (conn_info, headers.get("X-Forwarded-For"));
    if body.data.type_ != "gallery" {
        return bad_request("missing/invalid type: gallery");
    }

    let gallery_input = body.data.attributes.gallery;
    let raw_images = body.data.attributes.images;

    let mut images = Vec::with_capacity(raw_images.len());

    for image in &raw_images {
        if !IMAGE_ID.is_match(image) {
            return bad_request("invalid image id");
        }

        if !path::Path::new(&image).exists() {
            return bad_request("no such image");
        }

        images.push(image.as_str());
    }

    let (gallery, private) = match GALLERY_SPEC.captures(&gallery_input) {
        Some(captures) => (
            captures.get(1).expect("static regex").as_str(),
            captures.get(2).expect("static regex").as_str(),
        ),
        None => {
            return bad_request(concat!(
                "gallery format: name!password, ",
                "4-10 letters, pass: 4+ anything"
            ));
        }
    };

    match gallery::gallery_store(&state.conn, &state.secret, gallery, private, &images) {
        Ok(public) => (
            StatusCode::OK,
            data_response(resource_object(public, "gallery")),
        ),
        Err(e) => log_error("saving gallery item", &caller, &e),
    }
}

#[test]
fn validate_image_id() {
    assert!(IMAGE_ID.is_match("e/abcdefghij.png"));
    assert!(!IMAGE_ID.is_match(" e/abcdefghij.png"));
    assert!(!IMAGE_ID.is_match("e/abcdefghi.png"));
}

#[axum_macros::debug_handler]
async fn gallery_get(
    ConnectInfo(conn_info): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    State(state): State<Arc<Ctx>>,
    Path(public): Path<String>,
) -> (StatusCode, Json<Value>) {
    if public.len() > 32 || public.find(|c: char| !c.is_ascii_graphic()).is_some() {
        return bad_request("invalid gallery id");
    }

    let caller: Caller = (conn_info, headers.get("X-Forwarded-For"));

    let conn = match state.conn.lock() {
        Ok(conn) => conn,
        Err(posion) => {
            println!("poisoned! {posion:?}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                error_object("internal error"),
            );
        }
    };

    match gallery::gallery_list_all(&conn, &public) {
        Ok(resp) => {
            let values: Vec<_> = resp
                .into_iter()
                .map(|id| json!({"id": id, "type": "image"}))
                .collect();
            (StatusCode::OK, data_response(json!(values)))
        }
        Err(e) => log_error("listing gallery", &caller, &e),
    }
}

fn app_secret() -> Result<[u8; 32], Error> {
    let mut buf = [0u8; 32];
    let path = path::Path::new(".secret");
    if path.exists() {
        fs::File::open(path)?.read_exact(&mut buf)?;
    } else {
        rand::rng().fill_bytes(&mut buf);
        fs::File::create(path)?.write_all(&buf)?;
    }
    Ok(buf)
}

fn gallery_db() -> Result<rusqlite::Connection, Error> {
    Ok(rusqlite::Connection::open("gallery.db")?)
}

#[derive(Clone)]
struct Ctx {
    conn: Arc<Mutex<rusqlite::Connection>>,
    secret: [u8; 32],
}

#[tokio::main]
async fn main() -> Result<()> {
    fs::create_dir_all("e")
        .with_context(|| anyhow!("creating storage directory inside {:?}", env::current_dir()))?;
    let conn = gallery_db()?;
    gallery::migrate_gallery(&conn)?;
    thumbs::generate_all_thumbs()?;
    let secret = app_secret()?;

    let dist = env::var("FRONTEND_DIR").unwrap_or_else(|_| "dist".to_string());
    let dist = fs::canonicalize(&dist).with_context(|| {
        anyhow!("unresolvable frontend directory: {dist:?}, try e.g. './dist'",)
    })?;

    let dist_test = dist.join("index.html");
    let _ = fs::read(&dist_test).with_context(|| {
        anyhow!(
            "proposed frontend directory {dist:?} does not contain index.html, try e.g. './dist'",
        )
    })?;

    let bind = env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:6699".to_string());
    let bind_resolved = bind
        .to_socket_addrs()
        .with_context(|| anyhow!("invalid bind address: {bind:?}, try e.g. '0.0.0.0:6699'"))?;

    let ctx = Arc::new(Ctx {
        conn: Arc::new(Mutex::new(conn)),
        secret,
    });

    let serve_dir = |p: &path::Path| ServeDir::new(p).call_fallback_on_method_not_allowed(true);

    const MB: usize = 1024 * 1024;

    use axum::routing::{get, post, put};
    let app = axum::Router::new()
        .route("/api/upload", post(upload))
        .route("/api/gallery/{public}", get(gallery_get))
        .route("/api/gallery", put(gallery_put))
        .layer(DefaultBodyLimit::max(10 * MB))
        .with_state(Arc::clone(&ctx))
        .nest_service("/e", serve_dir(path::Path::new("e")))
        .fallback_service(serve_dir(dist.as_path()));

    let mut servers = JoinSet::new();
    for addr in bind_resolved {
        let app = app.clone();
        println!("starting server on http://{:?}", addr);

        let server = tokio::net::TcpListener::bind(&addr)
            .await
            .with_context(|| anyhow!("binding to {addr:?}"))?;
        let server = axum::serve(
            server,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        );
        servers.spawn(server.into_future());
    }

    // servers don't stop or fail, so this is just driving the futures
    while let Some(res) = servers.join_next().await {
        let _ = res?;
    }

    Ok(())
}
