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

    tokio::runtime::Runtime::new()?.block_on(stream_upload_roundtrip())?;

    Ok(())
}

fn raw_path(saved: &str) -> String {
    format!("{}.raw.webp", saved.strip_suffix(".jpg").unwrap())
}

fn stream_context() -> std::sync::Arc<crate::Ctx> {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::gallery::migrate_gallery(&conn).unwrap();
    std::sync::Arc::new(crate::Ctx {
        conn: std::sync::Arc::new(std::sync::Mutex::new(conn)),
        secret: [0; 32],
    })
}

async fn stream_request(
    fields: &[(&str, &[u8])],
    state: std::sync::Arc<crate::Ctx>,
) -> axum::response::Response {
    use axum::extract::FromRequest as _;
    let mut body = Vec::new();
    for (name, value) in fields {
        body.extend_from_slice(
            format!("--test-boundary\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n")
                .as_bytes(),
        );
        body.extend_from_slice(value);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(b"--test-boundary--\r\n");
    let request = axum::http::Request::builder()
        .method("POST")
        .uri("/api/upload-stream")
        .header(
            "Content-Type",
            "multipart/form-data; boundary=test-boundary",
        )
        .body(axum::body::Body::from(body))
        .unwrap();
    let multipart = axum::extract::Multipart::from_request(request, &())
        .await
        .unwrap();
    crate::upload_stream(
        axum::extract::ConnectInfo("127.0.0.1:1234".parse().unwrap()),
        axum::http::HeaderMap::new(),
        axum::extract::State(state),
        multipart,
    )
    .await
}

// Runs within write_an_image's temporary working directory, since storage is
// relative to cwd and changing cwd in a separate test would race that test.
async fn stream_upload_roundtrip() -> Result<()> {
    use futures_util::StreamExt as _;
    let state = stream_context();
    let response = stream_request(
        &[
            ("image", include_bytes!("test.png")),
            ("gallery", b"album!secret"),
        ],
        state.clone(),
    )
    .await;
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "text/event-stream");
    assert_eq!(response.headers()["x-accel-buffering"], "no");
    let mut stream = response.into_body().into_data_stream();
    let accepted = stream.next().await.unwrap()?;
    assert!(std::str::from_utf8(&accepted)?.starts_with("event: status\n"));
    let status: serde_json::Value = serde_json::from_str(
        std::str::from_utf8(&accepted)?
            .lines()
            .find_map(|line| line.strip_prefix("data: "))
            .unwrap(),
    )?;
    assert_eq!(status["kind"], "accepted");
    assert!(status["message"].is_string());
    let complete = stream.next().await.unwrap()?;
    let complete = std::str::from_utf8(&complete)?;
    assert!(complete.starts_with("event: done\n"));
    let data = complete
        .lines()
        .find_map(|line| line.strip_prefix("data: "))
        .unwrap();
    let data: serde_json::Value = serde_json::from_str(data)?;
    assert_eq!(data.as_object().unwrap().len(), 1);
    let id = data["data"]["id"].as_str().unwrap();
    assert!(crate::is_image_id(id));
    assert_eq!(data["data"]["type"], "image");
    assert!(std::path::Path::new(id).exists());
    assert!(std::path::Path::new(&format!(
        "e/.thumbs/{}.thumb.webp",
        id.strip_prefix("e/").unwrap()
    ))
    .exists());
    let conn = state.conn.lock().unwrap();
    let saved: String = conn.query_row("select image from gallery_images", [], |row| row.get(0))?;
    assert_eq!(id, saved);
    assert!(stream.next().await.is_none());

    // Callback errors propagate after the image and thumbnail have been stored.
    let mut emitted = 0;
    let result = crate::process_upload(include_bytes!("test.png"), None, &state, |_| {
        emitted += 1;
        anyhow::bail!("event receiver disconnected")
    });
    assert_eq!(emitted, 1);
    assert_eq!(
        result.unwrap_err().to_string(),
        "event receiver disconnected"
    );
    Ok(())
}

#[tokio::test]
async fn stream_upload_rejects_invalid_forms_before_acceptance() {
    for fields in [
        vec![],
        vec![("image", b"x".as_slice()), ("image", b"y".as_slice())],
        vec![("image", b"x".as_slice()), ("gallery", b"bad".as_slice())],
    ] {
        let response = stream_request(&fields, stream_context()).await;
        assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
        assert_eq!(response.headers()["content-type"], "application/json");
    }
}

#[tokio::test]
async fn stream_upload_reports_processing_errors_after_acceptance() {
    use futures_util::StreamExt as _;
    let response = stream_request(&[("image", b"not an image")], stream_context()).await;
    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let mut stream = response.into_body().into_data_stream();
    let accepted = stream.next().await.unwrap().unwrap();
    assert!(std::str::from_utf8(&accepted)
        .unwrap()
        .starts_with("event: status\n"));
    let error = stream.next().await.unwrap().unwrap();
    assert!(std::str::from_utf8(&error)
        .unwrap()
        .starts_with("event: error\n"));
    let status: serde_json::Value = serde_json::from_str(
        std::str::from_utf8(&error)
            .unwrap()
            .lines()
            .find_map(|line| line.strip_prefix("data: "))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(status["message"], "Image processing failed");
    assert!(stream.next().await.is_none());
}
