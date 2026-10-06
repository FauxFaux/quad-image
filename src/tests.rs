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

    // A single-worker pool cannot run the queued WebP encode until store
    // returns, so this also checks that JPEG storage does not join the worker.
    let pool = rayon::ThreadPoolBuilder::new().num_threads(1).build()?;
    let jpeg_data = include_bytes!("../tests/orient_1.jpg");
    let jpeg = pool.install(|| -> Result<String> {
        let saved = store(jpeg_data)?;
        assert!(saved.ends_with(".jpg"));
        assert!(!std::path::Path::new(&raw_path(&saved)).exists());
        Ok(saved)
    })?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !std::path::Path::new(&raw_path(&jpeg)).exists() {
        anyhow::ensure!(
            std::time::Instant::now() < deadline,
            "raw WebP was not saved"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    let source = image::load_from_memory(jpeg_data)?;
    let raw = image::open(raw_path(&jpeg))?;
    assert_eq!(source.to_rgba8(), raw.to_rgba8());

    // Incompressible pixels force the existing >1 MiB JPEG fallback. Its
    // companion must preserve the pixels from before the lossy conversion.
    let mut state = 1_u32;
    let noisy = image::RgbImage::from_fn(768, 768, |_, _| {
        image::Rgb(std::array::from_fn(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state as u8
        }))
    });
    let mut png = std::io::Cursor::new(Vec::new());
    noisy.write_to(&mut png, image::ImageFormat::Png)?;
    let jpeg = store(png.get_ref())?;
    assert!(jpeg.ends_with(".jpg"));
    assert_eq!(
        image::ImageFormat::Jpeg,
        image::guess_format(&fs::read(&jpeg)?)?
    );
    let raw_bytes = fs::read(raw_path(&jpeg))?;
    assert!(raw_bytes.len() > 1024 * 1024);
    assert_eq!(
        noisy,
        image::load_from_memory_with_format(&raw_bytes, image::ImageFormat::WebP)?.to_rgb8()
    );

    Ok(())
}

fn raw_path(saved: &str) -> String {
    format!("{}.raw.webp", saved.strip_suffix(".jpg").unwrap())
}
