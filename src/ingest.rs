use std::fs;
use std::io;
use std::io::Seek;
use std::io::SeekFrom;

use failure::bail;
use failure::err_msg;
use failure::format_err;
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

pub fn make_readable(path: &str) -> io::Result<()> {
    let mut perms = fs::File::open(path)?.metadata()?.permissions();

    use std::os::unix::fs::PermissionsExt;
    perms.set_mode(0o0644);
    fs::set_permissions(path, perms)
}

pub type SavedImage = String;

/// the crate supports webp, but doesn't seem to detect it:
/// https://github.com/PistonDevelopers/image/issues/660
fn guess_format(data: &[u8]) -> Result<ImageFormat, Error> {
    Ok(if data.len() >= 4 && b"RIFF"[..] == data[..4] {
        ImageFormat::WEBP
    } else {
        image::guess_format(data).with_context(|_| {
            format_err!(
                "guess from {} bytes: {:?}",
                data.len(),
                &data[..30.min(data.len())]
            )
        })?
    })
}

fn load_image(data: &[u8], format: ImageFormat) -> Result<image::DynamicImage, Error> {
    let mut loaded =
        image::load_from_memory_with_format(data, format).with_context(|_| format_err!("load"))?;

    use image::ImageFormat::*;
    let expect_exif = match format {
        JPEG | WEBP | TIFF => true,
        _ => false,
    };

    if expect_exif {
        match exif_rotation(data) {
            Ok(val) => apply_rotation(val, &mut loaded),
            Err(e) => eprintln!("couldn't find exif info: {:?}", e),
        }
    }

    Ok(loaded)
}

fn temp_file() -> Result<PersistableTempFile, Error> {
    Ok(PersistableTempFile::new_in("e").with_context(|_| format_err!("temp file"))?)
}

fn handle_gif(data: &[u8]) -> Result<SavedImage, Error> {
    // FYI: this does not deserve a trait
    use gif::SetParameter;

    let mut reader = gif::Decoder::new(io::Cursor::new(data))
        .read_info()
        .with_context(|_| err_msg("loading gif"))?;

    let mut temp = temp_file()?;

    {
        let mut encoder = gif::Encoder::new(
            &mut temp,
            reader.width(),
            reader.height(),
            reader.global_palette().unwrap_or(&[]),
        )
        .with_context(|_| err_msg("preparing gif"))?;

        // TODO: clearly a lie, but... who even will notice?
        encoder.set(gif::Repeat::Infinite)?;

        while let Some(frame) = reader
            .read_next_frame()
            .with_context(|_| err_msg("reading frame"))?
        {
            encoder
                .write_frame(frame)
                .with_context(|_| err_msg("writing frame"))?;
        }
    }

    write_out(temp, "gif")
}

pub fn store(data: &[u8]) -> Result<SavedImage, Error> {
    let guessed_format = guess_format(data)?;

    use image::ImageFormat::*;
    if GIF == guessed_format {
        return handle_gif(data);
    }

    let loaded = load_image(data, guessed_format)?;

    let mut target_format = match guessed_format {
        PNG | PNM | TIFF | BMP | ICO | HDR | TGA => PNG,
        JPEG | WEBP => JPEG,
        GIF => unreachable!(),
    };

    let mut temp = temp_file()?;
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

    write_out(temp, ext)
}

fn write_out(mut temp: PersistableTempFile, ext: &str) -> Result<SavedImage, Error> {
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
    if rotation == 0 || rotation > 8 {
        eprintln!("crazy rot: {}", rotation);
        return;
    }

    let rotation = rotation - 1;

    if 0 != rotation & 0b100 {
        *image = flip_diagonal(image);
    }

    if 0 != rotation & 0b010 {
        *image = image::ImageRgba8(imageops::rotate180(image));
    }

    if 0 != rotation & 0b001 {
        *image = image::ImageRgba8(imageops::flip_horizontal(image));
    }
}

fn flip_diagonal(image: &mut image::DynamicImage) -> image::DynamicImage {
    use image::GenericImageView;

    let (width, height) = image.dimensions();
    let mut out = image::ImageBuffer::new(height, width);

    for y in 0..height {
        for x in 0..width {
            let p = image.get_pixel(x, y);
            out.put_pixel(y, x, p);
        }
    }

    image::DynamicImage::ImageRgba8(out)
}

#[cfg(test)]
mod tests {
    use std::fs;

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
        use super::guess_format;
        use super::load_image;
        load_image(from, guess_format(from).unwrap()).unwrap()
    }

    fn assert_similar(expected: &image::DynamicImage, actual: &image::DynamicImage, rot: usize) {
        use image::GenericImageView;

        assert_eq!(expected.dimensions(), actual.dimensions());

        let (w, h) = expected.dimensions();

        let mut diff = 0.;

        // this is a really, really terrible diff algo if you care about visuals
        // the input images are actually different, and the jpeg noise is horrendous
        for x in 0..w {
            for y in 0..h {
                let e = expected.get_pixel(x, y);
                let a = actual.get_pixel(x, y);
                for c in 0..4 {
                    use image::Pixel;
                    diff += ((e.channels()[c] as f64) - (a.channels()[c] as f64)).abs() / 256. / 4.;
                }
            }
        }

        diff /= (w * h) as f64;

        if diff > 0.02 {
            panic!("too much difference in {}: {}", rot, diff);
        }
    }

    #[test]
    fn orientate() {
        let plain = im(include_bytes!("../tests/orient_1.jpg"));

        const FILES: [&'static [u8]; 9] = [
            &[],
            &[],
            include_bytes!("../tests/orient_2.jpg"),
            include_bytes!("../tests/orient_3.jpg"),
            include_bytes!("../tests/orient_4.jpg"),
            include_bytes!("../tests/orient_5.jpg"),
            include_bytes!("../tests/orient_6.jpg"),
            include_bytes!("../tests/orient_7.jpg"),
            include_bytes!("../tests/orient_8.jpg"),
        ];

        for rot in 2..=8 {
            let file = FILES[rot];
            let output = im(file);

            if false {
                output
                    .write_to(
                        &mut fs::OpenOptions::new()
                            .create(true)
                            .write(true)
                            .open(format!("/tmp/orient_fixed_{}.jpg", rot))
                            .unwrap(),
                        image::ImageFormat::JPEG,
                    )
                    .unwrap();
            }

            assert_similar(&plain, &output, rot);
        }
    }

    #[test]
    fn problematic_android_image() {
        use super::store;
        let data = include_bytes!("../tests/no_exif.jpeg");
        let res = store(data);
        assert!(res.is_ok());
    }
}
