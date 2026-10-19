use std::fs;
use std::io;
use std::io::Write;

use anyhow::anyhow;
use anyhow::bail;
use anyhow::Context;
use anyhow::Result;
use image::ImageFormat;
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
    store_with_thumbnail(data, |_| Ok(()))
}

pub fn store_with_thumbnail(
    data: &[u8],
    mut emit_thumbnail: impl FnMut(&str) -> Result<()> + Send,
) -> Result<SavedImage> {
    let guessed_format = guess_format(data)?;

    use image::ImageFormat::*;
    if Gif == guessed_format {
        return handle_gif(data);
    }

    let loaded = load_image(data, guessed_format)?;
    // Scoped Rayon work borrows the decoded pixels and the callback. Neither
    // needs an Arc or a 'static lifetime, and thumbnailing needs no pixel copy.
    let (pending, encoded) = rayon::join(
        || {
            let pending = PendingImage::thumbnail(&loaded)?;
            emit_thumbnail(&pending.id)?;
            Ok::<_, anyhow::Error>(pending)
        },
        || encode_image(&loaded),
    );
    // Both branches have finished, including thumbnail persistence and emit,
    // before publishing the primary image or starting gallery writes.
    let mut pending = pending?;
    let temp = encoded?;
    temp.persist_noclobber(&pending.id)
        .map_err(|error| anyhow!("couldn't save image {}: {error:?}", pending.id))?;
    pending.persisted = true;
    make_readable(&pending.id)?;
    let saved = pending.id.clone();
    Ok(saved)
}

/// The atomically published thumbnail claims the name for still-image uploads.
/// Until the primary is committed, failure (including a disconnected receiver)
/// releases that claim. The primary is also persisted without clobbering.
struct PendingImage {
    id: String,
    thumbnail: std::path::PathBuf,
    persisted: bool,
}

impl PendingImage {
    fn thumbnail(image: &DynamicImage) -> Result<Self> {
        let encoded = crate::thumbs::encode_webp(image)?;
        for _ in 0..32768 {
            let id = format!("e/{}.webp", random_name());
            if std::path::Path::new(&id).try_exists()? {
                continue;
            }
            if let Some(thumbnail) = crate::thumbs::claim_webp(&id, &encoded)? {
                return Ok(Self {
                    id,
                    thumbnail,
                    persisted: false,
                });
            }
        }
        bail!("couldn't find a viable file name")
    }
}

impl Drop for PendingImage {
    fn drop(&mut self) {
        if !self.persisted {
            if let Err(error) = fs::remove_file(&self.thumbnail) {
                eprintln!(
                    "couldn't remove abandoned thumbnail {}: {error}",
                    self.thumbnail.display()
                );
            }
        }
    }
}

fn encode_image(loaded: &DynamicImage) -> Result<PersistableTempFile> {
    let rgba = loaded.to_rgba8();
    let bytes = crate::webp_policy::encode_rgba(rgba.as_raw(), rgba.width(), rgba.height())?;
    let mut temp = temp_file()?;
    temp.write_all(&bytes).context("writing selected WebP")?;
    Ok(temp)
}

fn write_out(mut temp: PersistableTempFile, ext: &str) -> Result<SavedImage> {
    for _ in 0..32768 {
        let rand_bit = random_name();
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

fn random_name() -> String {
    Alphanumeric
        .sample_iter(&mut rand::rng())
        .map(char::from)
        .take(10)
        .collect()
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
        let rgba = png.to_rgba8();
        let encoded = crate::webp_policy::encode_rgba(rgba.as_raw(), rgba.width(), rgba.height())
            .expect("able to encode a 16-bit input as 8-bit WebP");
        assert_eq!(image::load_from_memory(&encoded).unwrap().to_rgba8(), rgba);
    }

    #[test]
    fn selected_webp_preserves_pixels_and_alpha() {
        for alpha in [255, 128] {
            let pixels = image::RgbaImage::from_pixel(2, 2, image::Rgba([12, 34, 56, alpha]));
            let encoded = crate::webp_policy::encode_rgba(pixels.as_raw(), 2, 2).unwrap();
            let decoded = image::load_from_memory(&encoded).unwrap();
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
