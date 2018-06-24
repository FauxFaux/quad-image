#[macro_use]
extern crate failure;

extern crate image;
extern crate iron;
extern crate libc;
extern crate params;
extern crate rand;
extern crate router;
extern crate tempfile_fast;

#[cfg(test)]
extern crate tempdir;

#[cfg(test)]
mod tests;

use std::fs;
use std::io;
use std::io::BufRead;
use std::io::Seek;
use std::io::SeekFrom;

use failure::Error;
use failure::ResultExt;
use image::ImageFormat;
use iron::prelude::*;
use iron::status;
use params::Params;
use rand::distributions::Alphanumeric;
use rand::distributions::Distribution;
use tempfile_fast::PersistableTempFile;

fn make_readable(path: &str) -> io::Result<()> {
    let mut perms = fs::File::open(path)?.metadata()?.permissions();

    use std::os::unix::fs::PermissionsExt;
    perms.set_mode(0o0644);
    fs::set_permissions(path, perms)
}

fn store(f: &params::File) -> Result<String, Error> {
    let loaded: image::DynamicImage;
    let guessed_format: image::ImageFormat;
    {
        let mut file = io::BufReader::new(
            fs::File::open(&f.path).with_context(|_| format_err!("open posted file"))?,
        );

        guessed_format = {
            let bytes = file.fill_buf().with_context(|_| format_err!("fill"))?;
            // the crate supports webp, but doesn't seem to detect it:
            // https://github.com/PistonDevelopers/image/issues/660
            if bytes.len() >= 4 && b"RIFF"[..] == bytes[..4] {
                ImageFormat::WEBP
            } else {
                image::guess_format(bytes).with_context(|_| {
                    format_err!(
                        "guess from {} bytes: {:?}",
                        bytes.len(),
                        &bytes[..30.min(bytes.len())]
                    )
                })?
            }
        };
        loaded = image::load(file, guessed_format).with_context(|_| format_err!("load"))?;
    }

    use image::ImageFormat::*;
    let mut target_format = match guessed_format {
        PNG | PNM | TIFF | BMP | ICO | HDR | TGA | GIF => PNG,
        JPEG | WEBP => JPEG,
    };

    let mut temp = PersistableTempFile::new_in("e").with_context(|_| format_err!("temp file"))?;
    loaded
        .write_to(temp.as_mut(), target_format)
        .with_context(|_| format_err!("save"))?;

    if target_format == PNG {
        // Chrome seems to convert everything pasted to png, even if it's huge.
        // So, if we see a png that's too big, down-convert it to a jpg,
        // and log about how proud we are of having ruined the internet.
        // Alternatively, we could record whether it was a pasted upload?

        let png_length = temp
            .metadata()
            .with_context(|_| format_err!("temp metadata"))?
            .len();
        if png_length > 1024 * 1024 {
            temp.seek(SeekFrom::Start(0))
                .with_context(|_| format_err!("truncating temp file 2"))?;

            temp.set_len(0)
                .with_context(|_| format_err!("truncating temp file"))?;

            target_format = JPEG;

            loaded
                .write_to(temp.as_mut(), target_format)
                .with_context(|_| format_err!("save attempt 2"))?;

            let jpeg_length = temp
                .metadata()
                .with_context(|_| format_err!("temp metadata 2"))?
                .len();
            println!(
                "png came out too big so we jpeg'd it: {} -> {}",
                png_length, jpeg_length
            );
        }
    }
    let ext = match target_format {
        PNG => "png",
        JPEG => "jpg",
        GIF => "gif",
        _ => unreachable!(),
    };

    let mut rand = rand::thread_rng();

    for _ in 0..32768 {
        let rand_bit: String = Alphanumeric.sample_iter(&mut rand).take(10).collect();
        let cand = format!("e/{}.{}", rand_bit, ext);
        temp = match temp.persist_noclobber(&cand) {
            Ok(_) => {
                make_readable(&cand)?;
                return Ok(cand);
            }
            Err(e) => match e.error.raw_os_error() {
                Some(libc::EEXIST) => e.file,
                _ => bail!("couldn't create candidate {}: {:?}", cand, e),
            },
        }
    }

    bail!("couldn't find a viable file name")
}

fn upload(req: &mut Request) -> IronResult<Response> {
    let host = {
        match req.headers.get::<iron::headers::Host>() {
            Some(header) => header.hostname.clone(),
            None => return Ok(Response::with((status::BadRequest, "'no Host header'"))),
        }
    };

    let remote_addr = req.remote_addr;
    let remote_forwarded = req.headers.get_raw("X-Forwarded-For").map(|vecs| {
        vecs.iter()
            .map(|vec| String::from_utf8(vec.clone()).expect("valid utf-8 forwarded for"))
            .collect::<Vec<String>>()
    });

    let params = match req.get_ref::<Params>() {
        Ok(params) => params,
        Err(_) => return Ok(Response::with((status::BadRequest, "'not a form post'"))),
    };

    match params.get("image") {
        Some(&params::Value::File(ref f)) => match store(f) {
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
                    Ok(Response::with((
                        status::SeeOther,
                        iron::modifiers::Redirect(dest),
                    )))
                }
            }
        },
        _ => {
            println!(
                "{:?} {:?}: invalid request, no image attr",
                remote_addr, remote_forwarded
            );
            Ok(Response::with((
                status::BadRequest,
                "'image attr not present'",
            )))
        }
    }
}

fn main() -> Result<(), Error> {
    let mut router = router::Router::new();
    router.post("/api/upload", upload, "upload");
    Iron::new(router)
        .http("127.0.0.1:6699")
        .map_err(|iron| format_err!("couldn't start server: {:?}", iron))?;
    Ok(())
}
