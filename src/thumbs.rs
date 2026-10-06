use std::fs;
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use anyhow::anyhow;
use anyhow::Context;
use anyhow::Result;
use image::codecs::jpeg::JpegEncoder;
use rayon::prelude::*;

fn thumb_names(image: &Path) -> Result<(PathBuf, PathBuf)> {
    let name = image.file_name().context("image has no filename")?;
    let parent = image.parent().context("image has no parent directory")?;
    let name = name.to_str().context("image filename is not UTF-8")?;
    Ok((
        parent.join(format!("{name}.thumb.jpg")),
        parent.join(".thumbs").join(format!("{name}.thumb.webp")),
    ))
}

pub fn generate_all_thumbs() -> Result<()> {
    generate_all_thumbs_in(Path::new("e"))
}

fn generate_all_thumbs_in(directory: &Path) -> Result<()> {
    fs::create_dir_all(directory.join(".thumbs"))?;
    let mut needed = Vec::with_capacity(100);

    for entry in directory.read_dir()? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !crate::is_image_id(&format!("e/{name}")) || !entry.file_type()?.is_file() {
            continue;
        }

        let path = entry.path();
        let (jpeg, webp) = thumb_names(&path)?;
        if !jpeg.is_file() || !webp.is_file() {
            needed.push(path);
        }
    }

    println!("thumbnailing {} image(s)", needed.len());

    needed
        .par_iter()
        .map(|path| thumbnail_path(path).with_context(|| anyhow!("thumbnailing {:?}", path)))
        .collect::<Result<Vec<_>, _>>()?;

    println!("thumbnailing complete");

    Ok(())
}

pub fn thumbnail(image_id: &str) -> Result<String> {
    thumbnail_path(Path::new(image_id))?;
    Ok(format!("{image_id}.thumb.jpg"))
}

fn thumbnail_path(path: &Path) -> Result<()> {
    let (jpeg, webp) = thumb_names(path)?;
    let need_jpeg = !jpeg.is_file();
    let need_webp = !webp.is_file();
    if !need_jpeg && !need_webp {
        return Ok(());
    }

    let mut bytes = Vec::with_capacity(1_000_000);
    fs::File::open(path)?.read_to_end(&mut bytes)?;
    let image = image::load_from_memory(&bytes)?;

    if need_jpeg {
        let shrunk = image.thumbnail(320, 160).into_rgb8();
        persist_thumb(&jpeg, |buf| {
            shrunk.write_with_encoder(JpegEncoder::new_with_quality(buf, 40))?;
            Ok(())
        })?;
    }

    if need_webp {
        // Double the JPEG dimensions for denser displays, with a low lossy
        // quality to keep the additional pixels affordable to lazy-load.
        let shrunk = image.thumbnail(640, 320).into_rgba8();
        let encoded = crate::webp_encoder::encode_rgba_with_alpha_quality(
            shrunk.as_raw(),
            shrunk.width(),
            shrunk.height(),
            30.0,
            // Eight alpha levels, instead of libwebp's lossless default.
            30,
            crate::webp_encoder::Limits::default(),
        )?;
        persist_thumb(&webp, |buf| {
            buf.write_all(&encoded)?;
            Ok(())
        })?;
    }

    Ok(())
}

fn persist_thumb(
    path: &Path,
    write: impl FnOnce(&mut BufWriter<tempfile_fast::PersistableTempFile>) -> Result<()>,
) -> Result<()> {
    let parent = path.parent().context("thumbnail has no parent directory")?;
    fs::create_dir_all(parent)?;
    let temp = tempfile_fast::PersistableTempFile::new_in(parent)?;
    let mut buf = BufWriter::new(temp);
    write(&mut buf)?;

    // into_inner() is documented to flush. Publish only complete files.
    let temp = buf.into_inner()?;
    match temp.persist_noclobber(path) {
        Ok(()) => {}
        Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => return Ok(()),
        Err(e) => return Err(e.error.into()),
    }
    crate::ingest::make_readable(path.to_str().context("thumbnail path is not UTF-8")?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn writes_both_formats_and_repairs_either_missing_thumb() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("abcdefghij.png");
        image::load_from_memory(include_bytes!("../tests/orient.png"))?
            .resize_exact(1280, 640, image::imageops::FilterType::Nearest)
            .save(&path)?;
        let (jpeg, webp) = thumb_names(&path)?;
        thumbnail_path(&path)?;

        let jpeg_bytes = fs::read(&jpeg)?;
        let webp_bytes = fs::read(&webp)?;
        assert_eq!(image::guess_format(&jpeg_bytes)?, image::ImageFormat::Jpeg);
        assert_eq!(image::guess_format(&webp_bytes)?, image::ImageFormat::WebP);
        let jpeg_image = image::open(&jpeg)?;
        let webp_image = image::open(&webp)?;
        use image::GenericImageView;
        assert_eq!(jpeg_image.dimensions(), (320, 160));
        assert_eq!(webp_image.dimensions(), (640, 320));
        assert_eq!(jpeg.file_name().unwrap(), "abcdefghij.png.thumb.jpg");
        assert_eq!(webp, dir.path().join(".thumbs/abcdefghij.png.thumb.webp"));
        for path in [&jpeg, &webp] {
            assert_eq!(fs::metadata(path)?.permissions().mode() & 0o777, 0o644);
        }

        // Startup must backfill WebP even when the JPEG already exists.
        fs::remove_file(&webp)?;
        fs::write(&jpeg, b"preserve existing JPEG")?;
        fs::write(dir.path().join("ignored.png"), b"not an image")?;
        fs::write(dir.path().join("abcdefghij.raw.webp"), b"not an image")?;
        fs::create_dir(dir.path().join("0123456789.jpg"))?;
        generate_all_thumbs_in(dir.path())?;
        assert_eq!(fs::read(&jpeg)?, b"preserve existing JPEG");
        assert_eq!(fs::read(&webp)?, webp_bytes);

        // And repairing JPEG must leave the existing WebP alone.
        fs::remove_file(&jpeg)?;
        fs::write(&webp, b"preserve existing WebP")?;
        generate_all_thumbs_in(dir.path())?;
        assert_eq!(fs::read(&jpeg)?, jpeg_bytes);
        assert_eq!(fs::read(&webp)?, b"preserve existing WebP");

        // A completed pair needs no decode, including on the upload path.
        fs::write(&path, b"no longer decodable")?;
        assert_eq!(
            thumbnail(path.to_str().unwrap())?,
            format!("{}.thumb.jpg", path.display())
        );
        generate_all_thumbs_in(dir.path())?;
        Ok(())
    }

    #[test]
    fn malformed_image_leaves_no_thumbnails() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("abcdefghij.jpg");
        fs::write(&path, b"not an image")?;
        assert!(thumbnail_path(&path).is_err());
        assert!(generate_all_thumbs_in(dir.path()).is_err());
        let (jpeg, webp) = thumb_names(&path)?;
        assert!(!jpeg.exists());
        assert!(!webp.exists());
        Ok(())
    }

    #[test]
    fn gif_thumb_is_a_still_image() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("abcdefghij.gif");
        fs::write(&path, include_bytes!("../tests/parrot.gif"))?;
        thumbnail_path(&path)?;
        let (_, webp) = thumb_names(&path)?;
        let bytes = fs::read(webp)?;
        assert!(!bytes.windows(4).any(|bytes| bytes == b"ANIM"));
        image::load_from_memory(&bytes)?;
        Ok(())
    }
}
