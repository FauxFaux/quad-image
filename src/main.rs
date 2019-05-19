mod gallery;
pub mod ingest;
#[cfg(test)]
mod tests;
mod thumbs;

use std::fs;
use std::io;
use std::io::Read;
use std::io::Write;
use std::path;
use std::sync::Arc;
use std::sync::Mutex;

use failure::Error;
use lazy_static::lazy_static;
use rand::RngCore;
use rouille::input::json::JsonError;
use rouille::input::json_input;
use rouille::input::post;
use rouille::post_input;
use rouille::router;
use rouille::Request;
use rouille::Response;
use serde_json::json;

const BAD_REQUEST: u16 = 400;

type Conn = Arc<Mutex<rusqlite::Connection>>;

lazy_static! {
    static ref IMAGE_ID: regex::Regex =
        regex::Regex::new("^e/[a-zA-Z0-9]{10}\\.(?:png|jpg|gif)$").unwrap();
    static ref GALLERY_SPEC: regex::Regex =
        regex::Regex::new("^([a-zA-Z][a-zA-Z0-9]{3,9})!(.{4,99})$").unwrap();
}

fn upload(request: &Request) -> Response {
    let params = match post_input!(request, {
        image: Vec<post::BufferedFile>,
        return_json: Option<String>,
    }) {
        Ok(params) => params,
        Err(_) => return bad_request("invalid / missing parameters"),
    };

    let image = match params.image.len() {
        1 => &params.image[0],
        _ => return bad_request("exactly one upload required"),
    };

    let return_json = match params.return_json {
        Some(string) => match string.parse() {
            Ok(val) => val,
            Err(_) => return bad_request("invalid return_json value"),
        },
        None => false,
    };

    match ingest::store(&image.data) {
        Ok(image_id) => {
            let remote_addr = request.remote_addr();
            let remote_forwarded = request.header("X-Forwarded-For");

            println!("{:?} {:?}: {}", remote_addr, remote_forwarded, image_id);

            if let Err(e) = thumbs::thumbnail(&image_id) {
                return log_error("thumbnailing just written", request, &e);
            }

            if return_json {
                data_response(resource_object(image_id, "image"))
            } else {
                // relative to api/upload
                Response::redirect_303(format!("../{}", image_id))
            }
        }
        Err(e) => log_error("storing image", request, &e),
    }
}

/// http://jsonapi.org/format/#errors
fn error_object(message: &str) -> Response {
    println!("error: {}", message);
    Response::json(&json!({ "errors": [
        { "title": message }
    ] }))
}

fn json_api_validate_obj(obj: &serde_json::Map<String, serde_json::Value>) {
    assert!(obj.contains_key("id"), "id is mandatory in {:?}", obj);
    assert!(obj.contains_key("type"), "type is mandatory in {:?}", obj);
}

/// panic if something isn't valid json-api.
/// panic is fine because the structure should be static in code
/// could be only tested at debug time..
fn json_api_validate(obj: &serde_json::Value) {
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
fn data_response(inner: serde_json::Value) -> Response {
    json_api_validate(&inner);
    Response::json(&json!({ "data": inner }))
}

/// http://jsonapi.org/format/#document-resource-objects
fn resource_object<I: AsRef<str>>(id: I, type_: &'static str) -> serde_json::Value {
    json!({ "id": id.as_ref(), "type": type_ })
}

fn bad_request(message: &str) -> Response {
    error_object(message).with_status_code(BAD_REQUEST)
}

fn log_error(location: &str, request: &Request, error: &Error) -> Response {
    let remote_addr = request.remote_addr();
    let remote_forwarded = request.header("X-Forwarded-For");

    println!(
        "{:?} {:?}: failed: {}: {:?}",
        remote_addr, remote_forwarded, location, error
    );
    error_object(location).with_status_code(500)
}

fn gallery_put(conn: Conn, global_secret: &[u8], request: &Request) -> Response {
    let body: serde_json::Value = match json_input(request) {
        Ok(body) => body,
        Err(JsonError::WrongContentType) => return bad_request("missing/invalid content type"),
        Err(other) => {
            println!("invalid request: {:?}", other);
            return bad_request("missing/invalid content type");
        }
    };

    let body = match body.as_object() {
        Some(body) => body,
        None => return bad_request("non-object body"),
    };

    if body.contains_key("errors") {
        return bad_request("'errors' must be absent");
    }

    let body = match body.get("data").and_then(|data| data.as_object()) {
        Some(body) => body,
        None => return bad_request("missing/invalid data attribute"),
    };

    if !body
        .get("type")
        .and_then(|ty| ty.as_str())
        .map(|ty| "gallery" == ty)
        .unwrap_or(false)
    {
        return bad_request("missing/invalid type: gallery");
    }

    let body = match body.get("attributes").and_then(|body| body.as_object()) {
        Some(body) => body,
        None => return bad_request("missing/invalid type: attributes"),
    };

    let gallery_input = match body.get("gallery").and_then(|val| val.as_str()) {
        Some(string) => string,
        None => return bad_request("missing/invalid type: gallery attribute"),
    };

    let raw_images = match body.get("images").and_then(|val| val.as_array()) {
        Some(raw_images) => raw_images,
        None => return bad_request("missing/invalid type: images"),
    };

    let mut images = Vec::with_capacity(raw_images.len());

    for image in raw_images {
        let image = match image.as_str() {
            Some(image) => image,
            None => return bad_request("non-string image in list"),
        };

        if !IMAGE_ID.is_match(image) {
            return bad_request("invalid image id");
        }

        if !path::Path::new(image).exists() {
            return bad_request("no such image");
        }

        images.push(image);
    }

    let (gallery, private) = match GALLERY_SPEC.captures(gallery_input) {
        Some(captures) => (
            captures.get(1).unwrap().as_str(),
            captures.get(2).unwrap().as_str(),
        ),
        None => {
            return bad_request(concat!(
                "gallery format: name!password, ",
                "4-10 letters, pass: 4+ anything"
            ));
        }
    };

    match gallery::gallery_store(conn, global_secret, gallery, private, &images) {
        Ok(public) => data_response(resource_object(public, "gallery")),
        Err(e) => log_error("saving gallery item", request, &e),
    }
}

#[test]
fn validate_image_id() {
    assert!(IMAGE_ID.is_match("e/abcdefghij.png"));
    assert!(!IMAGE_ID.is_match(" e/abcdefghij.png"));
    assert!(!IMAGE_ID.is_match("e/abcdefghi.png"));
}

fn gallery_get(request: &Request, conn: Conn, public: &str) -> Response {
    if public.len() > 32 || public.find(|c: char| !c.is_ascii_graphic()).is_some() {
        return bad_request("invalid gallery id");
    }

    let mut conn = match conn.lock() {
        Ok(conn) => conn,
        Err(_posion) => {
            println!("poisoned! {:?}", _posion);
            return error_object("internal error").with_status_code(500);
        }
    };

    match gallery::gallery_list_all(&mut *conn, public) {
        Ok(resp) => {
            let values: Vec<_> = resp
                .into_iter()
                .map(|id| json!({"id": id, "type": "image"}))
                .collect();
            data_response(json!(values))
        }
        Err(e) => log_error("listing gallery", request, &e),
    }
}

fn app_secret() -> Result<[u8; 32], Error> {
    let mut buf = [0u8; 32];
    let path = path::Path::new(".secret");
    if path.exists() {
        fs::File::open(path)?.read_exact(&mut buf)?;
    } else {
        rand::thread_rng().fill_bytes(&mut buf);
        fs::File::create(path)?.write_all(&buf)?;
    }
    Ok(buf)
}

fn gallery_db() -> Result<rusqlite::Connection, Error> {
    Ok(rusqlite::Connection::open("gallery.db")?)
}

fn main() -> Result<(), Error> {
    let mut conn = gallery_db()?;
    gallery::migrate_gallery(&mut conn)?;
    thumbs::generate_all_thumbs()?;
    let secret = app_secret()?;

    let conn = Arc::new(Mutex::new(conn));

    rouille::start_server("127.0.0.1:6699", move |request| {
        rouille::log(&request, io::stdout(), || {
            if let Some(e) = request.remove_prefix("/e") {
                return rouille::match_assets(&e, "e");
            }

            router!(request,
                (GET)  ["/"]                    => { static_html("web/index.html")          },
                (GET)  ["/dumb/"]               => { static_html("web/dumb/index.html")     },
                (GET)  ["/terms/"]              => { static_html("web/terms/index.html")    },
                (GET)  ["/gallery/"]            => { static_html("web/gallery/index.html")  },

                (GET)  ["/root.css"]            => { static_css ("web/root.css")            },
                (GET)  ["/user.svg"]            => { static_svg ("web/user.svg")            },
                (GET)  ["/lollipop.js"]         => { static_js  ("web/lollipop.js")         },
                (GET)  ["/gallery/gallery.css"] => { static_css ("web/gallery/gallery.css") },
                (GET)  ["/jquery-3.3.1.min.js"] => { static_js  ("web/jquery-3.3.1.min.js") },

                (POST) ["/api/upload"]          => { upload(request)                        },

                (PUT)  ["/api/gallery"]         => {
                    gallery_put(conn.clone(), &secret, request)
                },

                (GET)  ["/api/gallery/{public}", public: String] => {
                    gallery_get(request, conn.clone(), &public)
                },

                _ => rouille::Response::empty_404()
            )
        })
    });
}

fn static_html(path: &'static str) -> Response {
    static_file("text/html", path)
}

fn static_css(path: &'static str) -> Response {
    static_file("text/css", path)
}

fn static_js(path: &'static str) -> Response {
    static_file("application/javascript", path)
}

fn static_svg(path: &'static str) -> Response {
    static_file("image/svg+xml", path)
}

fn static_file(content_type: &'static str, path: &'static str) -> Response {
    Response::from_file(content_type, fs::File::open(path).expect("static"))
}
