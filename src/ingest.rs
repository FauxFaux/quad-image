use std::fs;
use std::io;
use std::io::Seek;
use std::io::SeekFrom;

use failure::err_msg;
use failure::Error;
use failure::ResultExt;
use image;
use image::imageops;
use image::ImageFormat;
use libc;
use rand;
use rand::distributions::Alphanumeric;
use rand::distributions::Distribution;
use tempfile_fast::PersistableTempFile;

fn make_readable(path: &str) -> io::Result<()> {
    let mut perms = fs::File::open(path)?.metadata()?.permissions();

    use std::os::unix::fs::PermissionsExt;
    perms.set_mode(0o0644);
    fs::set_permissions(path, perms)
}

pub type SavedImage = String;

fn load_image(data: &[u8]) -> Result<(image::DynamicImage, image::ImageFormat), Error> {
    let mut loaded;
    let guessed_format;
    {
        guessed_format = {
            // the crate supports webp, but doesn't seem to detect it:
            // https://github.com/PistonDevelopers/image/issues/660
            if data.len() >= 4 && b"RIFF"[..] == data[..4] {
                ImageFormat::WEBP
            } else {
                image::guess_format(data).with_context(|_| {
                    format_err!(
                        "guess from {} bytes: {:?}",
                        data.len(),
                        &data[..30.min(data.len())]
                    )
                })?
            }
        };
        loaded = image::load_from_memory_with_format(data, guessed_format)
            .with_context(|_| format_err!("load"))?;
    }

    use image::ImageFormat::*;
    let expect_exif = match guessed_format {
        JPEG | WEBP | TIFF => true,
        _ => false,
    };

    if expect_exif {
        match exif_rotation(data) {
            Ok(val) => apply_rotation(val, &mut loaded),
            Err(e) => eprintln!("couldn't find exif info: {:?}", e),
        }
    }

    Ok((loaded, guessed_format))
}

pub fn store(data: &[u8]) -> Result<SavedImage, Error> {
    let (loaded, guessed_format) = load_image(data)?;

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

fn exif_rotation(from: &[u8]) -> Result<u32, Error> {
    Ok(exif::Reader::new(&mut io::Cursor::new(from))?
        .get_field(exif::Tag::Orientation, false)
        .ok_or_else(|| err_msg("no such field"))?
        .value
        .get_uint(0)
        .ok_or_else(|| err_msg("no uint in value"))?)
}

fn apply_rotation(rotation: u32, image: &mut image::DynamicImage) {
    match rotation {
        1 => (),
        2 => {
            *image = image::ImageRgba8(imageops::flip_horizontal(image));
        }
        3 => {
            *image = image::ImageRgba8(imageops::rotate180(image));
        }
        4 => {
            *image = image::ImageRgba8(imageops::flip_vertical(image));
        }
        other => eprintln!("crazy rot: {}", other),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn exif() {
        use super::exif_rotation as rot;

        assert!(rot(include_bytes!("../tests/orient.png")).is_err());
        assert!(rot(include_bytes!("../tests/orient.jpg")).is_err());
        assert_eq!(1, rot(include_bytes!("../tests/orient_1.jpg")).unwrap());
        assert_eq!(3, rot(include_bytes!("../tests/orient_3.jpg")).unwrap());
        assert_eq!(8, rot(include_bytes!("../tests/orient_8.jpg")).unwrap());
    }

    fn im(from: &[u8]) -> image::DynamicImage {
        use super::load_image;
        let (im, _) = load_image(from).unwrap();
        im
    }

    #[test]
    fn orientate() {
        use image::GenericImageView;

        let plain = im(include_bytes!("../tests/orient_1.jpg"));
        assert_eq!(
            plain.dimensions(),
            im(include_bytes!("../tests/orient_2.jpg")).dimensions()
        );
        assert_eq!(
            plain.dimensions(),
            im(include_bytes!("../tests/orient_3.jpg")).dimensions()
        );
        assert_eq!(
            plain.dimensions(),
            im(include_bytes!("../tests/orient_4.jpg")).dimensions()
        );
    }
}
