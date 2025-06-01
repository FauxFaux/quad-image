use std::fs;
use std::io::{BufWriter, Read};
use std::path::Path;

use anyhow::anyhow;
use anyhow::Context;
use anyhow::Result;
use image::codecs::jpeg::JpegEncoder;
use rayon::prelude::*;

fn thumb_name(image_id: &str) -> String {
    format!("{}.thumb.jpg", image_id)
}

pub fn generate_all_thumbs() -> Result<()> {
    let mut needed = Vec::with_capacity(100);

    for path in Path::new("e").read_dir()? {
        let path = path?;

        if let Some(s) = path.path().to_str() {
            if !crate::is_image_id(s) {
                continue;
            }

            if Path::new(&thumb_name(s)).is_file() {
                continue;
            }

            needed.push(s.to_string());
        }
    }

    println!("thumbnailing {} image(s)", needed.len());

    needed
        .par_iter()
        .map(|path| thumbnail(path).with_context(|| anyhow!("thumbnailing {:?}", path)))
        .collect::<Result<Vec<_>, _>>()?;

    println!("thumbnailing complete");

    Ok(())
}

pub fn thumbnail(image_id: &str) -> Result<String> {
    let thumb_name = thumb_name(image_id);

    let mut bytes = Vec::with_capacity(1_000_000);
    fs::File::open(image_id)?.read_to_end(&mut bytes)?;

    let image = image::load_from_memory(&bytes)?;
    let shrunk = image.thumbnail(320, 160);
    let shrunk = shrunk.into_rgb8();

    let temp = tempfile_fast::PersistableTempFile::new_in("e")?;
    let mut buf = BufWriter::new(temp);

    let encoder = JpegEncoder::new_with_quality(&mut buf, 40);
    shrunk.write_with_encoder(encoder)?;

    // into_inner() is documented to flush
    let temp = buf.into_inner()?;

    temp.persist_noclobber(&thumb_name).map_err(|e| e.error)?;
    crate::ingest::make_readable(&thumb_name)?;

    Ok(thumb_name)
}
