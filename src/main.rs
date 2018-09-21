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
extern crate sha2;
extern crate tempfile_fast;

#[cfg(test)]
extern crate tempdir;

#[cfg(test)]
mod tests;

use std::fs;
use std::io;
use std::io::Read;
use std::io::Seek;
use std::io::SeekFrom;
use std::io::Write;
use std::path;

use failure::Error;
use failure::ResultExt;
use image::ImageFormat;
use rand::distributions::Alphanumeric;
use rand::distributions::Distribution;
use rand::RngCore;
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

fn gallery_list_all(public: &str) -> Result<String, Error> {
    let conn = gallery_db()?;

    let mut stat = conn.prepare(
        "select image from gallery_images
where gallery=? order by added desc",
    )?;

    let mut resp = String::new();

    for image in stat.query_map(&[&public], |row| row.get::<usize, String>(0))? {
        resp.push_str(&image?);
        resp.push('\n');
    }

    Ok(resp)
}

fn mac(key: &[u8], val: &[u8]) -> Vec<u8> {
    use hmac::Mac;
    let mut mac = hmac::Hmac::<sha2::Sha512Trunc256>::new_varkey(key).expect("varkey");
    mac.input(val);
    mac.result().code().to_vec()
}

fn gallery_store(secret: &[u8], token: &str, private: &str, image: &str) -> Result<String, Error> {
    let user_details = mac(token.as_bytes(), private.as_bytes());
    let trigger = mac(secret, &user_details);
    let public = format!(
        "{}:{}",
        token,
        base64::encode_config(&trigger[..7], base64::URL_SAFE_NO_PAD)
    );

    gallery_db()?.execute(
        "insert into gallery_images (gallery, image, added) values (?, ?, current_timestamp)",
        &[&public, &image],
    )?;

    Ok(public)
}

fn not_url_safe(string: &str) -> bool {
    string
        .chars()
        .find(|x| !x.is_ascii_alphanumeric())
        .is_some()
}

fn gallery_put(secret: &[u8], request: &Request) -> Response {
    let params = try_or_400!(post_input!(request, {
        user: String,
        pass: String,
        image: String,
    }));

    println!("{:?} {:?}", params, params.user);

    if not_url_safe(&params.user) || params.user.is_empty() || params.user.len() > 16 {
        return Response::text("disallowed user").with_status_code(BAD_REQUEST);
    }
    if params.pass.len() < 4 {
        return Response::text("disallowed pass").with_status_code(BAD_REQUEST);
    }

    if not_url_safe(&params.image) || params.image.len() != 10 {
        return Response::text("bad image id").with_status_code(BAD_REQUEST);
    }

    Response::text(gallery_store(secret, &params.user, &params.pass, &params.image).unwrap())
}

fn gallery_get(public: &str) -> Response {
    match gallery_list_all(public) {
        Ok(resp) => Response::text(resp),
        Err(e) => {
            println!("sqlite error: {:?}", e);
            Response::text("internal server error").with_status_code(500)
        }
    }
}

fn gallery_db() -> Result<rusqlite::Connection, Error> {
    Ok(rusqlite::Connection::open("gallery.db")?)
}

fn migrate_gallery() -> Result<(), Error> {
    let conn = gallery_db()?;
    conn.execute(
        "create table if not exists gallery_images (
gallery char(10) not null,
image char(10) not null,
added datetime not null
)",
        &[],
    )?;
    Ok(())
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
    migrate_gallery()?;
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
                    gallery_get(&public)
                },

                _ => rouille::Response::empty_404()
            )
        })
    });
}

fn static_file(path: &'static str) -> Response {
    Response::from_file("text/html", fs::File::open(path).expect("static"))
}
