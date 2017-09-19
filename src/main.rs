extern crate iron;
extern crate image;
extern crate params;
extern crate rand;
extern crate router;
extern crate tempfile;

use std::fs;
use std::io;
use std::io::BufRead;

use iron::prelude::*;
use iron::status;
use params::Params;

use rand::Rng;

const C_OPEN_FAILED_ALREADY_EXISTS: i32 = 17;

fn outfile(ext: &str) -> String {
    let mut rand = rand::thread_rng();
    loop {
        let rand_bit: String = rand.gen_ascii_chars().take(10).collect();
        let cand = format!("images/{}.{}", rand_bit, ext);
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
    let loaded: image::DynamicImage;
    let guessed_format: image::ImageFormat;
    {
        let mut file = io::BufReader::new(fs::File::open(&f.path).expect("open posted file"));
        guessed_format = image::guess_format(file.fill_buf().expect("fill")).expect("guess");
        loaded = image::load(file, guessed_format).expect("load");
    }

    use image::ImageFormat::*;
    let target_format = match guessed_format {
        PNG | PPM | TIFF | BMP | ICO | HDR | TGA => PNG,
        JPEG | WEBP => JPEG,
        GIF => GIF,
    };

    let mut temp = tempfile::NamedTempFileOptions::new()
        .create_in("images")
        .expect("temp file");
    loaded.save(&mut temp, target_format).expect("save");
    let written_to = outfile(match target_format {
        PNG => "png",
        JPEG => "jpg",
        GIF => "gif",
        _ => unreachable!(),
    });
    temp.persist(&written_to).expect("rename");

    make_readable(&written_to)?;

    Ok(written_to)
}

fn upload(req: &mut Request) -> IronResult<Response> {
    let host = req.headers
        .get::<iron::headers::Host>()
        .expect("host header present")
        .hostname
        .clone();
    let remote_addr = req.remote_addr;
    let params = req.get_ref::<Params>();
    if params.is_err() {
        return Ok(Response::with((status::BadRequest, "'not a form post'")));
    }

    let params: &params::Map = params.unwrap();

    match params.get("image") {
        Some(&params::Value::File(ref f)) => {
            match store(f) {
                Err(e) => {
                    println!("failed: {:?}", e);
                    Ok(Response::with(status::InternalServerError))
                }
                Ok(code) => {
                    println!("{:?} {}", remote_addr, code);
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
