extern crate base64;
#[macro_use]
extern crate failure;
extern crate hmac;
extern crate image;
extern crate libc;
extern crate rand;
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
                Response::json(&json!({ "id": img }))
            } else {
                // relative to api/upload
                Response::redirect_303(format!("../{}", img))
            }
        }
        Err(e) => log_error("storing image", request, &e),
    }
}

fn error_object(message: &str) -> Response {
    Response::json(&json!({ "error": message }))
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
        user: String,
        pass: String,
        image: String,
    }));

    if not_url_safe(&params.user) || params.user.is_empty() || params.user.len() > 16 {
        return bad_request("disallowed user");
    }
    if params.pass.len() < 4 {
        return bad_request("disallowed pass");
    }

    if not_url_safe(&params.image) || params.image.len() != 10 {
        return bad_request("bad image id");
    }

    match gallery::gallery_store(secret, &params.user, &params.pass, &params.image) {
        Ok(public) => Response::json(&json!({ "gallery": public })),
        Err(e) => log_error("saving gallery item", request, &e),
    }
}

fn gallery_get(request: &Request, public: &str) -> Response {
    if public.len() > 32 || public.find(|c: char| !c.is_ascii_graphic()).is_some() {
        return bad_request("invalid gallery id");
    }

    match gallery::gallery_list_all(public) {
        Ok(resp) => Response::json(&json!({ "items": resp })),
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
                (GET)  (/)            => { static_file("web/index.html")       },
                (GET)  (/terms/)      => { static_file("web/terms/index.html") },
                (GET)  (/dumb/)       => { static_file("web/dumb/index.html")  },
                (POST) (/api/upload)  => { upload(request)                     },
                (PUT)  (/api/gallery) => { gallery_put(&secret, request)       },

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
