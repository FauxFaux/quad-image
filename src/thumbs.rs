use std::fs;
use std::io::Read;
use std::path::Path;

use failure::Error;
use failure::ResultExt;
use image;
use rayon::prelude::*;

fn thumb_name(image_id: &str) -> String {
    format!("{}.thumb.jpg", image_id)
}

pub fn generate_all_thumbs() -> Result<(), Error> {
    let mut needed = Vec::with_capacity(100);

    for path in Path::new("e").read_dir()? {
        let path = path?;

        if let Some(s) = path.path().to_str() {
            if !crate::IMAGE_ID.is_match(s) {
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
        .map(|path| thumbnail(path).with_context(|_| format_err!("thumbnailing {:?}", path)))
        .collect::<Result<Vec<_>, _>>()?;

    println!("thumbnailing complete");

    Ok(())
}

pub fn thumbnail(image_id: &str) -> Result<String, Error> {
    let thumb_name = thumb_name(image_id);

    let mut bytes = Vec::with_capacity(1_000_000);
    fs::File::open(image_id)?.read_to_end(&mut bytes)?;

    let image = image::load_from_memory(&bytes)?;
    let shrunk = image.thumbnail(320, 160);

    let mut temp = tempfile_fast::PersistableTempFile::new_in("e")?;

    shrunk.write_to(&mut temp, image::ImageOutputFormat::JPEG(40))?;

    temp.persist_noclobber(&thumb_name).map_err(|e| e.error)?;

    Ok(thumb_name)
}
