extern crate base64;
#[macro_use]
extern crate failure;
extern crate hmac;
extern crate image;
#[macro_use]
extern crate lazy_static;
extern crate libc;
extern crate rand;
extern crate regex;
#[macro_use]
extern crate rouille;
extern crate rusqlite;
#[macro_use]
extern crate serde_json;
extern crate sha2;
extern crate tempfile_fast;

#[cfg(test)]
extern crate tempdir;

mod gallery;
pub mod ingest;
#[cfg(test)]
mod tests;

use std::fs;
use std::io;
use std::io::Read;
use std::io::Write;
use std::path;

use failure::Error;
use rand::RngCore;
use rouille::input::post;
use rouille::Request;
use rouille::Response;

const BAD_REQUEST: u16 = 400;

lazy_static! {
    static ref IMAGE_ID: regex::Regex =
        regex::Regex::new("^e/[a-zA-Z0-9]{10}\\.(?:png|jpg)$").unwrap();
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
        Ok(img) => {
            let remote_addr = request.remote_addr();
            let remote_forwarded = request.header("X-Forwarded-For");

            println!("{:?} {:?}: {}", remote_addr, remote_forwarded, img);

            if return_json {
                data_response(resource_object(img, "image"))
            } else {
                // relative to api/upload
                Response::redirect_303(format!("../{}", img))
            }
        }
        Err(e) => log_error("storing image", request, &e),
    }
}

/// http://jsonapi.org/format/#errors
fn error_object(message: &str) -> Response {
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

fn not_url_safe(string: &str) -> bool {
    string.chars().any(|x| !x.is_ascii_alphanumeric())
}

fn gallery_put(secret: &[u8], request: &Request) -> Response {
    let params = try_or_400!(post_input!(request, {
        gallery: String,
        key: String,
        image: String,
    }));

    if not_url_safe(&params.gallery) || params.gallery.is_empty() || params.gallery.len() > 16 {
        return bad_request("disallowed gallery");
    }

    if params.key.len() < 4 {
        return bad_request("disallowed key");
    }

    if !IMAGE_ID.is_match(&params.image) {
        return bad_request("bad image id");
    }

    match gallery::gallery_store(secret, &params.gallery, &params.key, &params.image) {
        Ok(gallery::StoreResult::Ok(public)) => data_response(resource_object(public, "gallery")),
        Ok(gallery::StoreResult::Duplicate) => error_object("duplicate image for gallery"),
        Err(e) => log_error("saving gallery item", request, &e),
    }
}

#[test]
fn validate_image_id() {
    assert!(IMAGE_ID.is_match("e/abcdefghij.png"));
    assert!(!IMAGE_ID.is_match(" e/abcdefghij.png"));
    assert!(!IMAGE_ID.is_match("e/abcdefghi.png"));
}

fn gallery_get(request: &Request, public: &str) -> Response {
    if public.len() > 32 || public.find(|c: char| !c.is_ascii_graphic()).is_some() {
        return bad_request("invalid gallery id");
    }

    match gallery::gallery_list_all(public) {
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

fn main() -> Result<(), Error> {
    gallery::migrate_gallery()?;
    let secret = app_secret()?;

    rouille::start_server("127.0.0.1:6699", move |request| {
        rouille::log(&request, io::stdout(), || {
            if let Some(e) = request.remove_prefix("/e") {
                return rouille::match_assets(&e, "e");
            }

            router!(request,
                (GET)  (/)            => { static_file("web/index.html")         },
                (GET)  (/terms/)      => { static_file("web/terms/index.html")   },
                (GET)  (/dumb/)       => { static_file("web/dumb/index.html")    },
                (GET)  (/gallery/)    => { static_file("web/gallery/index.html") },
                (POST) (/api/upload)  => { upload(request)                       },
                (PUT)  (/api/gallery) => { gallery_put(&secret, request)         },

                (GET)  (/api/gallery/{public: String}) => {
                    gallery_get(request, &public)
                },

                _ => rouille::Response::empty_404()
            )
        })
    });
}

fn static_file(path: &'static str) -> Response {
    Response::from_file("text/html", fs::File::open(path).expect("static"))
}
