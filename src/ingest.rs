use std::fs;
use std::io;
use std::io::Seek;

use anyhow::anyhow;
use anyhow::bail;
use anyhow::Context;
use anyhow::Result;
use image::ImageFormat;
use image::ImageFormat::Jpeg;
use image::{imageops, DynamicImage};
use rand::distr::Alphanumeric;
use rand::distr::Distribution;
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
fn guess_format(data: &[u8]) -> Result<ImageFormat> {
    Ok(if data.len() >= 4 && b"RIFF"[..] == data[..4] {
        ImageFormat::WebP
    } else {
        image::guess_format(data).with_context(|| {
            anyhow!(
                "guess from {} bytes: {:?}",
                data.len(),
                &data[..30.min(data.len())]
            )
        })?
    })
}

fn is_lossless_webp(data: &[u8]) -> bool {
    if data.len() < 12 || &data[..4] != b"RIFF" || &data[8..12] != b"WEBP" {
        return false;
    }

    let riff_size = u32::from_le_bytes(data[4..8].try_into().unwrap()) as usize;
    let Some(riff_end) = riff_size.checked_add(8) else {
        return false;
    };
    if riff_end > data.len() {
        return false;
    }

    let mut offset = 12;
    while offset + 8 <= riff_end {
        let chunk_type = &data[offset..offset + 4];
        let chunk_size =
            u32::from_le_bytes(data[offset + 4..offset + 8].try_into().unwrap()) as usize;

        if chunk_type == b"VP8L" {
            return true;
        }
        if chunk_type == b"VP8 " {
            return false;
        }

        let Some(next_offset) = offset
            .checked_add(8)
            .and_then(|value| value.checked_add(chunk_size))
            .and_then(|value| value.checked_add(chunk_size % 2))
        else {
            return false;
        };
        if next_offset > riff_end {
            return false;
        }
        offset = next_offset;
    }

    false
}

fn load_image(data: &[u8], format: ImageFormat) -> Result<image::DynamicImage> {
    let mut loaded =
        image::load_from_memory_with_format(data, format).with_context(|| anyhow!("load"))?;

    use image::ImageFormat::*;
    let expect_exif = matches!(format, Jpeg | WebP | Tiff);

    if expect_exif {
        match exif_rotation(data) {
            Ok(val) => apply_rotation(val, &mut loaded),
            Err(e) => eprintln!("couldn't find exif info: {:?}", e),
        }
    }

    Ok(loaded)
}

fn temp_file() -> Result<PersistableTempFile> {
    PersistableTempFile::new_in("e").with_context(|| anyhow!("temp file"))
}

fn handle_gif(data: &[u8]) -> Result<SavedImage> {
    let mut reader =
        gif::Decoder::new(io::Cursor::new(data)).with_context(|| anyhow!("loading gif"))?;

    let mut temp = temp_file()?;

    {
        let mut encoder = gif::Encoder::new(
            &mut temp,
            reader.width(),
            reader.height(),
            reader.global_palette().unwrap_or(&[]),
        )
        .with_context(|| anyhow!("preparing gif"))?;

        // TODO: clearly a lie, but... who even will notice?
        encoder.set_repeat(gif::Repeat::Infinite)?;

        while let Some(frame) = reader
            .read_next_frame()
            .with_context(|| anyhow!("reading frame"))?
        {
            encoder
                .write_frame(frame)
                .with_context(|| anyhow!("writing frame"))?;
        }
    }

    write_out(temp, "gif")
}

pub fn store(data: &[u8]) -> Result<SavedImage> {
    let guessed_format = guess_format(data)?;

    use image::ImageFormat::*;
    if Gif == guessed_format {
        return handle_gif(data);
    }

    let loaded = load_image(data, guessed_format)?;

    let mut target_format = match guessed_format {
        Png | Pnm | Tiff | Bmp | Ico | Hdr | Tga => WebP,
        WebP if is_lossless_webp(data) => WebP,
        Gif => unreachable!(),
        _ => Jpeg,
    };

    let mut temp = temp_file()?;
    write_image(temp.as_mut(), loaded.clone(), target_format).with_context(|| anyhow!("save"))?;
    let mut raw = None;

    if target_format == WebP {
        // Chrome seems to convert everything pasted to PNG, even if it's huge.
        // So, if the lossless WebP output is too big, down-convert it to JPEG,
        // and log about how proud we are of having ruined the internet.
        // Alternatively, we could record whether it was a pasted upload?

        let webp_length = temp
            .metadata()
            .with_context(|| anyhow!("temp metadata"))?
            .len();
        if webp_length > 1024 * 1024 {
            raw = Some(temp);
            temp = temp_file()?;

            target_format = Jpeg;

            write_image(temp.as_mut(), loaded.clone(), target_format)
                .with_context(|| anyhow!("save attempt 2"))?;

            let jpeg_length = temp
                .metadata()
                .with_context(|| anyhow!("temp metadata 2"))?
                .len();
            println!(
                "lossless webp came out too big so we jpeg'd it: {} -> {}",
                webp_length, jpeg_length
            );
        }
    }
    let ext = match target_format {
        WebP => "webp",
        Jpeg => "jpg",
        _ => unreachable!(),
    };

    let saved = write_out(temp, ext)?;
    if target_format == Jpeg {
        let raw_path =
            std::env::current_dir()?.join(saved.trim_end_matches(".jpg").to_owned() + ".raw.webp");
        if let Some(raw) = raw {
            // The size decision already required encoding this WebP. Keep it
            // instead of encoding it again or overwriting it with the JPEG.
            persist_raw(raw, &raw_path)?;
        } else {
            // JPEG uploads can be served as soon as their primary file is ready.
            // Own both the decoded pixels and an absolute path in the worker.
            rayon::spawn(move || {
                let result = (|| -> Result<()> {
                    let mut temp = PersistableTempFile::new_in(raw_path.parent().unwrap())?;
                    write_image(temp.as_mut(), loaded, WebP)?;
                    persist_raw(temp, &raw_path)
                })();
                if let Err(error) = result {
                    eprintln!(
                        "couldn't save lossless image {}: {error:?}",
                        raw_path.display()
                    );
                }
            });
        }
    }
    Ok(saved)
}

fn persist_raw(temp: PersistableTempFile, path: &std::path::Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    temp.set_permissions(fs::Permissions::from_mode(0o0644))?;
    temp.persist_noclobber(path)
        .map_err(|error| anyhow!("couldn't save lossless image {}: {error:?}", path.display()))?;
    Ok(())
}

fn write_image(
    dest: &mut (impl io::Write + Seek),
    im: DynamicImage,
    target_format: ImageFormat,
) -> Result<()> {
    let im = match target_format {
        Jpeg => DynamicImage::from(im.into_rgb8()),
        ImageFormat::WebP if has_only_opaque_alpha(&im) => DynamicImage::from(im.into_rgb8()),
        _ => im,
    };

    im.write_to(dest, target_format)
        .with_context(|| anyhow!("save"))?;

    Ok(())
}

fn has_only_opaque_alpha(im: &DynamicImage) -> bool {
    match im {
        DynamicImage::ImageRgba8(buffer) => buffer.pixels().all(|pixel| pixel[3] == u8::MAX),
        DynamicImage::ImageLumaA8(buffer) => buffer.pixels().all(|pixel| pixel[1] == u8::MAX),
        DynamicImage::ImageRgba16(buffer) => buffer.pixels().all(|pixel| pixel[3] == u16::MAX),
        DynamicImage::ImageLumaA16(buffer) => buffer.pixels().all(|pixel| pixel[1] == u16::MAX),
        DynamicImage::ImageRgba32F(buffer) => buffer.pixels().all(|pixel| pixel[3] == 1.0),
        _ => false,
    }
}

fn write_out(mut temp: PersistableTempFile, ext: &str) -> Result<SavedImage> {
    let mut rand = rand::rng();

    for _ in 0..32768 {
        let rand_bit: String = Alphanumeric
            .sample_iter(&mut rand)
            .map(char::from)
            .take(10)
            .collect();
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

fn exif_rotation(from: &[u8]) -> Result<u32> {
    exif::Reader::new()
        .read_from_container(&mut io::Cursor::new(from))?
        .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .ok_or_else(|| anyhow!("no such field"))?
        .value
        .get_uint(0)
        .ok_or_else(|| anyhow!("no uint in value"))
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
        *image = image::DynamicImage::ImageRgba8(imageops::rotate180(image));
    }

    if 0 != rotation & 0b001 {
        *image = image::DynamicImage::ImageRgba8(imageops::flip_horizontal(image));
    }
}

fn flip_diagonal(image: &image::DynamicImage) -> image::DynamicImage {
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
    use std::{fs, io};

    use image::ImageFormat;

    use super::write_image;

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
                        image::ImageFormat::Jpeg,
                    )
                    .unwrap();
            }

            assert_similar(&plain, &output, rot);
        }
    }

    #[test]
    fn sixteen() {
        let png = im(include_bytes!("../tests/16-bit.png"));
        write_image(&mut io::Cursor::new(vec![]), png, ImageFormat::Jpeg)
            .expect("able to write a loaded image, even if it was naughty");
    }

    #[test]
    fn webp_omits_opaque_alpha_and_preserves_transparency() {
        for alpha in [255, 128] {
            let pixels = image::RgbaImage::from_pixel(2, 2, image::Rgba([12, 34, 56, alpha]));
            let mut encoded = io::Cursor::new(Vec::new());
            write_image(
                &mut encoded,
                image::DynamicImage::ImageRgba8(pixels.clone()),
                ImageFormat::WebP,
            )
            .unwrap();
            let decoded = image::load_from_memory(encoded.get_ref()).unwrap();
            assert_eq!(decoded.color().has_alpha(), alpha != 255);
            assert_eq!(decoded.to_rgba8(), pixels);
        }
    }

    #[test]
    fn sixteen_natively_supported_since_0_25_7() {
        let png = image::load_from_memory_with_format(
            include_bytes!("../tests/16-bit.png"),
            ImageFormat::Png,
        )
        .unwrap();
        png.write_to(&mut io::Cursor::new(vec![]), ImageFormat::Jpeg)
            .expect("supported since image 0.25.7");
    }
}
