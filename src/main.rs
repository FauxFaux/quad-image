#[macro_use]
extern crate failure;

extern crate image;
extern crate libc;
extern crate rand;
#[macro_use]
extern crate rouille;
extern crate tempfile_fast;

#[cfg(test)]
extern crate tempdir;

#[cfg(test)]
mod tests;

use std::fs;
use std::io;
use std::io::Seek;
use std::io::SeekFrom;

use failure::Error;
use failure::ResultExt;
use image::ImageFormat;
use rand::distributions::Alphanumeric;
use rand::distributions::Distribution;
use rouille::input::post;
use rouille::Request;
use rouille::Response;
use tempfile_fast::PersistableTempFile;

const BAD_REQUEST: u16 = 400;

fn make_readable(path: &str) -> io::Result<()> {
    let mut perms = fs::File::open(path)?.metadata()?.permissions();

    use std::os::unix::fs::PermissionsExt;
    perms.set_mode(0o0644);
    fs::set_permissions(path, perms)
}

fn store(f: &post::BufferedFile) -> Result<String, Error> {
    let loaded: image::DynamicImage;
    let guessed_format: image::ImageFormat;
    {
        let file = io::Cursor::new(&f.data);

        guessed_format = {
            let bytes = file.get_ref();
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

fn upload(request: &Request) -> Response {
    let remote_addr = request.remote_addr();
    let remote_forwarded = request.header("X-Forwarded-For");

    let params = try_or_400!(post_input!(request, {
        image: Vec<post::BufferedFile>,
        redirect: Option<String>,
    }));

    let image = match params.image.len() {
        1 => &params.image[0],
        _ => return Response::text("exactly one upload required").with_status_code(BAD_REQUEST),
    };

    let redirect = match params.redirect {
        Some(string) => match string.parse() {
            Ok(val) => val,
            Err(_) => return Response::text("invalid redirect value").with_status_code(BAD_REQUEST),
        },
        None => true,
    };

    match store(image) {
        Err(e) => {
            println!("{:?} {:?}: failed: {:?}", remote_addr, remote_forwarded, e);
            Response::text("internal server error").with_status_code(500)
        }
        Ok(code) => {
            println!("{:?} {:?}: {}", remote_addr, remote_forwarded, code);
            if redirect {
                // relative to api/upload
                Response::redirect_303(format!("../{}", code))
            } else {
                Response::text(code)
            }
        }
    }
}

fn main() {
    rouille::start_server("127.0.0.1:6699", move |request| {
        rouille::log(&request, io::stdout(), || {
            if let Some(e) = request.remove_prefix("/e") {
                return rouille::match_assets(&e, "e");
            }

            router!(request,
                (GET)  (/)           => { static_file("web/index.html")       },
                (GET)  (/terms/)     => { static_file("web/terms/index.html") },
                (GET)  (/dumb/)      => { static_file("web/dumb/index.html")  },
                (POST) (/api/upload) => { upload(request)                     },
                _                    => { rouille::Response::empty_404()      }
            )
        })
    });
}

fn static_file(path: &'static str) -> Response {
    Response::from_file("text/html", fs::File::open(path).expect("static"))
}
