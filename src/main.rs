#[macro_use]
extern crate error_chain;

extern crate image;
extern crate iron;
extern crate params;
extern crate rand;
extern crate router;
extern crate tempfile;

mod errors;
use errors::*;

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

fn outfile(ext: &str) -> Result<String> {
    let mut rand = rand::thread_rng();
    loop {
        let rand_bit: String = rand.gen_ascii_chars().take(10).collect();
        let cand = format!("e/{}.{}", rand_bit, ext);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&cand)
        {
            Ok(_) => return Ok(cand),
            Err(e) => {
                // TODO: this probably panics on non-Linux(?).
                // TODO: not a major problem as it's hard to hit anyway.
                match e.raw_os_error() {
                    Some(C_OPEN_FAILED_ALREADY_EXISTS) => {}
                    _ => bail!(format!("couldn't create candidate {}: {:?}", cand, e)),
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

fn store(f: &params::File) -> Result<String> {
    let loaded: image::DynamicImage;
    let guessed_format: image::ImageFormat;
    {
        let mut file =
            io::BufReader::new(fs::File::open(&f.path).chain_err(|| "open posted file")?);
        guessed_format =
            image::guess_format(file.fill_buf().chain_err(|| "fill")?).chain_err(|| "guess")?;
        loaded = image::load(file, guessed_format).chain_err(|| "load")?;
    }

    use image::ImageFormat::*;
    let mut target_format = match guessed_format {
        PNG | PPM | PNM | TIFF | BMP | ICO | HDR | TGA | GIF => PNG,
        JPEG | WEBP => JPEG,
    };

    let mut temp = tempfile::NamedTempFileOptions::new()
        .create_in("e")
        .chain_err(|| "temp file")?;
    loaded
        .save(temp.as_mut(), target_format)
        .chain_err(|| "save")?;

    if target_format == PNG {
        // Chrome seems to convert everything parted to png, even if it's huge.
        // So, if we see a png that's too big, down-convert it to a jpg,
        // and log about how proud we are of having ruined the internet.
        // Alternatively, we could record whether it was a pasted upload?

        let png_length = temp.metadata().chain_err(|| "temp metadata")?.len();
        if png_length > 1024 * 1024 {
            temp.seek(SeekFrom::Start(0))
                .chain_err(|| "truncating temp file 2")?;

            temp.set_len(0).chain_err(|| "truncating temp file")?;

            target_format = JPEG;

            loaded
                .save(temp.as_mut(), target_format)
                .chain_err(|| "save attempt 2")?;

            let jpeg_length = temp.metadata().chain_err(|| "temp metadata 2")?.len();
            println!(
                "png came out too big so we jpeg'd it: {} -> {}",
                png_length,
                jpeg_length
            );
        }
    }

    let written_to = outfile(match target_format {
        PNG => "png",
        JPEG => "jpg",
        GIF => "gif",
        _ => unreachable!(),
    })?;
    temp.persist(&written_to).chain_err(|| "rename")?;

    make_readable(&written_to)?;

    Ok(written_to)
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
            .map(|vec| {
                String::from_utf8(vec.clone()).expect("valid utf-8 forwarded for")
            })
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
                    Ok(Response::with(
                        (status::SeeOther, iron::modifiers::Redirect(dest)),
                    ))
                }
            }
        },
        _ => {
            println!(
                "{:?} {:?}: invalid request, no image attr",
                remote_addr,
                remote_forwarded
            );
            Ok(Response::with(
                (status::BadRequest, "'image attr not present'"),
            ))
        }
    }
}

quick_main!(run);

fn run() -> Result<()> {
    let mut router = router::Router::new();
    router.post("/api/upload", upload, "upload");
    Iron::new(router)
        .http("127.0.0.1:6699")
        .map_err(|iron| format!("couldn't start server: {:?}", iron))?;
    Ok(())
}
