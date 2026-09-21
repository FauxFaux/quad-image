use std::env;
use std::fs;

use anyhow::Result;

use crate::ingest::store;

#[test]
fn write_an_image() -> Result<()> {
    // TODO: race central
    let d = tempfile::Builder::new().prefix("quad-image").tempdir()?;
    env::set_current_dir(d.path())?;

    let mut e = d.path().to_path_buf();
    e.push("e");
    fs::create_dir(&e)?;

    let mut input = d.path().to_path_buf();
    input.push("test.png");

    let source =
        image::load_from_memory_with_format(include_bytes!("test.png"), image::ImageFormat::Png)?;
    let saved = store(include_bytes!("test.png"))?;
    store(include_bytes!("../tests/parrot.gif"))?;

    let saved_bytes = fs::read(saved)?;
    let saved_webp = image::load_from_memory_with_format(&saved_bytes, image::ImageFormat::WebP)?;
    assert_eq!(source.to_rgba8(), saved_webp.to_rgba8());

    let resaved = store(&saved_bytes)?;
    assert_eq!(
        Some("webp"),
        std::path::Path::new(&resaved)
            .extension()
            .and_then(|e| e.to_str())
    );

    let mut now_extensions = fs::read_dir(&e)?
        .map(|e| {
            e.unwrap()
                .path()
                .extension()
                .unwrap()
                .to_string_lossy()
                .to_string()
        })
        .collect::<Vec<String>>();

    now_extensions.sort();

    assert_eq!(
        &["gif", "webp", "webp"],
        now_extensions.as_slice(),
        "created one of each"
    );

    Ok(())
}
