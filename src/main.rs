extern crate iron;
extern crate params;
extern crate rand;
extern crate router;
extern crate tempfile;

use std::fs;
use std::io;
use std::io::BufRead;
use std::io::Seek;
use std::io::SeekFrom;

use iron::prelude::*;
use iron::status;
use params::Params;

use rand::Rng;

const C_OPEN_FAILED_ALREADY_EXISTS: i32 = 17;

fn outfile(ext: &str) -> String {
    let mut rand = rand::thread_rng();
    loop {
        let rand_bit: String = rand.gen_ascii_chars().take(10).collect();
        let cand = format!("e/{}.{}", rand_bit, ext);
        match fs::OpenOptions::new().write(true).create_new(true).open(
            &cand,
        ) {
            Ok(_) => return cand,
            Err(e) => {
                // TODO: this probably panics on non-Linux(?).
                // TODO: not a major problem as it's hard to hit anyway.
                match e.raw_os_error() {
                    Some(C_OPEN_FAILED_ALREADY_EXISTS) => {}
                    _ => panic!(format!("couldn't create candidate {}: {:?}", cand, e)),
                }
            }
        }
    }
}

fn make_readable(path: &str) -> io::Result<()> {
    let mut perms = fs::File::open(path)?.metadata()?.permissions();

    use std::os::unix::fs::PermissionsExt;
    perms.set_mode(0o0644);
    fs::set_permissions(path, perms)
}

fn store(f: &params::File) -> io::Result<String> {
    unimplemented!()
}

fn upload(req: &mut Request) -> IronResult<Response> {
    let host = req.headers
        .get::<iron::headers::Host>()
        .expect("host header present")
        .hostname
        .clone();
    let remote_addr = req.remote_addr;
    let remote_forwarded = req.headers.get_raw("X-Forwarded-For").map(|vecs| {
        vecs.iter()
            .map(|vec| {
                String::from_utf8(vec.clone()).expect("valid utf-8 forwarded for")
            })
            .collect::<Vec<String>>()
    });
    let params = req.get_ref::<Params>();
    if params.is_err() {
        return Ok(Response::with((status::BadRequest, "'not a form post'")));
    }

    let params: &params::Map = params.unwrap();

    match params.get("image") {
        Some(&params::Value::File(ref f)) => {
            match store(f) {
                Err(e) => {
                    println!("{:?} {:?}: failed: {:?}", remote_addr, remote_forwarded, e);
                    Ok(Response::with(status::InternalServerError))
                }
                Ok(code) => {
                    println!("{:?} {:?}: {}", remote_addr, remote_forwarded, code);
                    let url = format!("https://{}/{}", host, code);
                    let dest = iron::Url::parse(url.as_str()).expect("url 2");
                    if params.contains_key("js-sucks") {
                        Ok(Response::with((status::Ok, code)))
                    } else {
                        Ok(Response::with(
                            (status::SeeOther, iron::modifiers::Redirect(dest)),
                        ))
                    }

                }
            }
        }
        _ => Ok(Response::with(
            (status::BadRequest, "'image attr not present'"),
        )),
    }
}

fn main() {
    let mut router = router::Router::new();
    router.post("/api/upload", upload, "upload");
    Iron::new(router).http("127.0.0.1:6699").unwrap();
}
