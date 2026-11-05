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

fn guess_format(data: &[u8]) -> Result<ImageFormat> {
    image::guess_format(data).with_context(|| {
        anyhow!(
            "guess from {} bytes: {:?}",
            data.len(),
            &data[..30.min(data.len())]
        )
    })
}

fn encode_source(data: &[u8], format: ImageFormat) -> Result<crate::webp_policy::Source> {
    let lossy = match format {
        ImageFormat::Jpeg => true,
        ImageFormat::WebP => image_webp::WebPDecoder::new(io::Cursor::new(data))
            .context("reading WebP encoding mode")?
            .is_lossy(),
        _ => false,
    };
    Ok(crate::webp_policy::Source {
        bytes: data.len(),
        lossy,
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

fn handle_gif(data: &[u8], assigned: impl FnMut(&str) -> Result<()>) -> Result<SavedImage> {
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

    write_out(temp, "gif", assigned)
}

pub fn store(data: &[u8]) -> Result<SavedImage> {
    store_with_thumbnail(data, |_| Ok(()))
}

pub enum StoreUpdate<'a> {
    Detected(ImageFormat),
    Decoded {
        width: u32,
        height: u32,
    },
    Assigned(&'a str),
    Published {
        name: &'a str,
        bytes: usize,
    },
    Thumbnail(&'a str),
    Image(&'a str),
    Planned(&'a [String]),
    Encoded {
        name: &'a str,
        bytes: usize,
        improved: bool,
    },
}

/// Publish complete images while all candidates run.
pub fn store_with_progress(
    data: &[u8],
    emit: impl FnMut(StoreUpdate<'_>) -> Result<()> + Send,
) -> Result<SavedImage> {
    store_with_ready(data, emit, |_| Ok(()))
}

/// Call `ready` once the first primary and thumbnail are readable. Once it
/// succeeds, retain them even if a later encode or progress notification fails.
/// This still blocks until encoding finishes; callers can acknowledge readiness
/// separately while keeping this work on a background worker.
pub fn store_with_ready(
    data: &[u8],
    mut emit: impl FnMut(StoreUpdate<'_>) -> Result<()> + Send,
    ready: impl FnOnce(&str) -> Result<()> + Send,
) -> Result<SavedImage> {
    let format = guess_format(data)?;
    emit(StoreUpdate::Detected(format))?;
    if format == ImageFormat::Gif {
        let id = handle_gif(data, |id| emit(StoreUpdate::Assigned(id)))?;
        emit(StoreUpdate::Published {
            name: "gif",
            bytes: fs::metadata(&id)?.len().try_into()?,
        })?;
        ready(&id)?;
        return Ok(id);
    }
    let loaded = load_image(data, format)?;
    let source = encode_source(data, format)?;
    emit(StoreUpdate::Decoded {
        width: loaded.width(),
        height: loaded.height(),
    })?;
    let pending = PendingImage::thumbnail(&loaded)?;
    emit(StoreUpdate::Assigned(&pending.id))?;
    emit(StoreUpdate::Thumbnail(&pending.id))?;
    let rgba = loaded.to_rgba8();
    store_candidates(pending, emit, ready, |report| {
        crate::webp_policy::encode_rgba_with_progress(
            rgba.as_raw(),
            rgba.width(),
            rgba.height(),
            source,
            report,
        )
    })
}

fn store_candidates(
    mut pending: PendingImage,
    mut emit: impl FnMut(StoreUpdate<'_>) -> Result<()> + Send,
    ready: impl FnOnce(&str) -> Result<()> + Send,
    encode: impl FnOnce(
        &mut (dyn FnMut(crate::webp_policy::EncodeProgress<'_>) -> Result<()> + Send),
    ) -> Result<Vec<u8>>,
) -> Result<SavedImage> {
    let mut ready = Some(ready);
    encode(&mut |update| match update {
        crate::webp_policy::EncodeProgress::Planned(names) => emit(StoreUpdate::Planned(&names)),
        crate::webp_policy::EncodeProgress::Completed {
            name,
            bytes,
            improved,
        } => {
            if improved {
                pending
                    .publish(bytes)
                    .with_context(|| format!("publishing {name} ({} bytes)", bytes.len()))?;
                emit(StoreUpdate::Published {
                    name: &name,
                    bytes: bytes.len(),
                })?;
                if let Some(ready) = ready.take() {
                    ready(&pending.id)?;
                    pending.persisted = true;
                }
            }
            emit(StoreUpdate::Encoded {
                name: &name,
                bytes: bytes.len(),
                improved,
            })?;
            if improved {
                emit(StoreUpdate::Image(&pending.id))?;
            }
            Ok(())
        }
    })?;
    // The last published improvement is also the final policy winner.
    Ok(pending.id.clone())
}

pub fn store_with_thumbnail(
    data: &[u8],
    mut emit_thumbnail: impl FnMut(&str) -> Result<()> + Send,
) -> Result<SavedImage> {
    store_with_progress(data, |update| {
        if let StoreUpdate::Thumbnail(id) = update {
            emit_thumbnail(id)?;
        }
        Ok(())
    })
}

/// The atomically published thumbnail claims the name for still-image uploads.
/// Until readiness is acknowledged, failure releases that claim. The first
/// primary is also persisted without clobbering; later improvements replace it.
struct PendingImage {
    id: String,
    thumbnail: std::path::PathBuf,
    persisted: bool,
    published: bool,
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
                    published: false,
                });
            }
        }
        bail!("couldn't find a viable file name")
    }

    fn publish(&mut self, bytes: &[u8]) -> Result<()> {
        use std::os::unix::fs::PermissionsExt;

        let parent = std::path::Path::new(&self.id)
            .parent()
            .context("image has no parent directory")?;
        let mut temp = PersistableTempFile::new_in(parent)?;
        temp.write_all(bytes).context("writing provisional WebP")?;
        temp.set_permissions(fs::Permissions::from_mode(0o0644))?;
        // Only replace our own published primary. The first write still must
        // respect any primary that appeared after the thumbnail claimed its ID.
        let result = if self.published {
            temp.persist_by_rename(&self.id)
        } else {
            temp.persist_noclobber(&self.id)
        };
        result.map_err(|error| anyhow!("couldn't publish image {}: {error:?}", self.id))?;
        self.published = true;
        Ok(())
    }
}

impl Drop for PendingImage {
    fn drop(&mut self) {
        if !self.persisted {
            if self.published {
                if let Err(error) = fs::remove_file(&self.id) {
                    eprintln!("couldn't remove abandoned image {}: {error}", self.id);
                }
            }
            if let Err(error) = fs::remove_file(&self.thumbnail) {
                eprintln!(
                    "couldn't remove abandoned thumbnail {}: {error}",
                    self.thumbnail.display()
                );
            }
        }
    }
}

fn write_out(
    mut temp: PersistableTempFile,
    ext: &str,
    mut assigned: impl FnMut(&str) -> Result<()>,
) -> Result<SavedImage> {
    for _ in 0..32768 {
        let rand_bit = random_name();
        let cand = format!("e/{}.{}", rand_bit, ext);
        temp = match temp.persist_noclobber(&cand) {
            Ok(_) => {
                assigned(&cand)?;
                make_readable(&cand)?;
                return Ok(cand);
            }
            Err(e) => match e.error.kind() {
                io::ErrorKind::AlreadyExists => e.file,
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
#[path = "ingest_tests.rs"]
mod tests;
