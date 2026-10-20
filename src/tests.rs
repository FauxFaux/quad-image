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
    let gif = store(include_bytes!("../tests/parrot.gif"))?;
    assert!(gif.ends_with(".gif"));
    let gif_bytes = fs::read(gif)?;
    let mut decoder = gif::Decoder::new(std::io::Cursor::new(gif_bytes))?;
    let mut frames = 0;
    while decoder.read_next_frame()?.is_some() {
        frames += 1;
    }
    assert!(frames > 1, "animated GIF frames must be retained");

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
        .filter(|entry| entry.as_ref().unwrap().file_type().unwrap().is_file())
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

    // Primary encoding uses its own shared pool, including when called from
    // a single-worker thumbnail pool. Incoming JPEGs get validated WebP too.
    let pool = rayon::ThreadPoolBuilder::new().num_threads(1).build()?;
    let jpeg_data = include_bytes!("../tests/orient_1.jpg");
    let saved = pool.install(|| store(jpeg_data))?;
    assert!(saved.ends_with(".webp"));
    let saved_bytes = fs::read(&saved)?;
    assert_eq!(image::guess_format(&saved_bytes)?, image::ImageFormat::WebP);
    assert_eq!(
        image::load_from_memory(jpeg_data)?.to_rgba8(),
        image::load_from_memory(&saved_bytes)?.to_rgba8()
    );
    assert!(!std::path::Path::new(&raw_path(&saved)).exists());

    // Incompressible input cannot fit exact lossless. The selected lossy WebP
    // must match its extension and preserve dimensions, without a raw archive.
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
    assert!(jpeg.ends_with(".webp"));
    let selected = fs::read(&jpeg)?;
    assert_eq!(image::guess_format(&selected)?, image::ImageFormat::WebP);
    assert!(selected.len() < 1_000_000);
    assert_eq!(
        image::load_from_memory(&selected)?.to_rgb8().dimensions(),
        noisy.dimensions()
    );
    assert!(selected.windows(4).any(|chunk| chunk == b"VP8 "));
    assert!(!std::path::Path::new(&raw_path(&jpeg)).exists());

    tokio::runtime::Runtime::new()?.block_on(async {
        legacy_upload_roundtrip().await?;
        stream_upload_roundtrip().await
    })?;

    Ok(())
}

fn raw_path(saved: &str) -> String {
    format!("{}.raw.webp", saved.strip_suffix(".webp").unwrap())
}

fn stream_context() -> std::sync::Arc<crate::Ctx> {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::gallery::migrate_gallery(&conn).unwrap();
    std::sync::Arc::new(crate::Ctx {
        conn: std::sync::Arc::new(std::sync::Mutex::new(conn)),
        secret: [0; 32],
    })
}

async fn request_multipart(fields: &[(&str, &[u8])]) -> axum::extract::Multipart {
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
    axum::extract::Multipart::from_request(request, &())
        .await
        .unwrap()
}

async fn stream_request(
    fields: &[(&str, &[u8])],
    state: std::sync::Arc<crate::Ctx>,
) -> axum::response::Response {
    crate::upload_stream(
        axum::extract::ConnectInfo("127.0.0.1:1234".parse().unwrap()),
        axum::http::HeaderMap::new(),
        axum::extract::State(state),
        request_multipart(fields).await,
    )
    .await
}

async fn legacy_upload_roundtrip() -> Result<()> {
    let state = stream_context();
    let mut headers = axum::http::HeaderMap::new();
    headers.insert("host", "uploads.example".parse()?);
    let (status, headers, response) = crate::upload(
        axum::extract::ConnectInfo("127.0.0.1:1234".parse().unwrap()),
        headers,
        axum::extract::State(state.clone()),
        request_multipart(&[
            ("image", include_bytes!("../tests/orient_1.jpg")),
            ("gallery", b"album!secret"),
            ("return_json", b"true"),
            ("return_full_url", b"true"),
        ])
        .await,
    )
    .await;
    assert_eq!(status, axum::http::StatusCode::OK);
    assert_eq!(
        headers["content-type"],
        "application/vnd.api+json; charset=utf-8"
    );
    let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024).await?;
    let data: serde_json::Value = serde_json::from_slice(&bytes)?;
    assert_eq!(data["data"]["type"], "image");
    let id = data["data"]["id"]
        .as_str()
        .unwrap()
        .strip_prefix("https://uploads.example/")
        .unwrap();
    assert!(crate::is_image_id(id) && id.ends_with(".webp"));
    assert_eq!(
        image::guess_format(&fs::read(id)?)?,
        image::ImageFormat::WebP
    );
    let thumb = format!("e/.thumbs/{}.thumb.webp", id.strip_prefix("e/").unwrap());
    image::open(thumb)?;
    let conn = state.conn.lock().unwrap();
    let stored: String =
        conn.query_row("select image from gallery_images", [], |row| row.get(0))?;
    assert_eq!(stored, id);
    Ok(())
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
    let thumbnail = stream.next().await.unwrap()?;
    let thumbnail = std::str::from_utf8(&thumbnail)?;
    assert!(thumbnail.starts_with("event: status\n"));
    let thumbnail: serde_json::Value = serde_json::from_str(
        thumbnail
            .lines()
            .find_map(|line| line.strip_prefix("data: "))
            .unwrap(),
    )?;
    assert_eq!(thumbnail["kind"], "thumbnail");
    let mut updates = 0;
    let mut encodes = Vec::new();
    let mut planned: Vec<String> = Vec::new();
    let complete = loop {
        let event = stream.next().await.unwrap()?;
        let event = std::str::from_utf8(&event)?.to_owned();
        if event.starts_with("event: done\n") {
            break event;
        }
        assert!(event.starts_with("event: status\n"));
        let update: serde_json::Value = serde_json::from_str(
            event
                .lines()
                .find_map(|line| line.strip_prefix("data: "))
                .unwrap(),
        )?;
        if update["kind"] == "planned" {
            assert!(encodes.is_empty());
            planned = serde_json::from_value(update["names"].clone())?;
            assert_eq!(planned, ["nl100", "nl40", "q90", "q70"]);
            continue;
        }
        if update["kind"] == "encoded" {
            assert!(planned
                .iter()
                .any(|name| name == update["name"].as_str().unwrap()));
            assert!(update["bytes"].as_u64().unwrap() > 0);
            assert!(update["improved"].is_boolean());
            encodes.push(update["name"].as_str().unwrap().to_owned());
            continue;
        }
        assert_eq!(update["kind"], "image");
        assert_eq!(update["id"], thumbnail["id"]);
        let id = update["id"].as_str().unwrap();
        assert_eq!(update["url"], format!("{id}?work-in-progress"));
        // Every advertised URL already has a complete, readable server encode.
        let served = tower_http::services::ServeDir::new(".")
            .try_call(
                axum::http::Request::builder()
                    .uri(format!("/{}", update["url"].as_str().unwrap()))
                    .body(axum::body::Body::empty())?,
            )
            .await?;
        assert_eq!(served.status(), axum::http::StatusCode::OK);
        let bytes =
            axum::body::to_bytes(axum::body::Body::new(served.into_body()), usize::MAX).await?;
        image::load_from_memory(&bytes)?;
        updates += 1;
    };
    assert!(updates > 0);
    encodes.sort();
    assert_eq!(encodes, ["nl100", "nl40", "q70", "q90"]);
    assert!(complete.starts_with("event: done\n"));
    let data = complete
        .lines()
        .find_map(|line| line.strip_prefix("data: "))
        .unwrap();
    let data: serde_json::Value = serde_json::from_str(data)?;
    assert_eq!(data.as_object().unwrap().len(), 1);
    let id = data["data"]["id"].as_str().unwrap();
    assert!(crate::is_image_id(id));
    assert_eq!(thumbnail["id"], id);
    assert_eq!(data["data"]["type"], "image");
    assert!(std::path::Path::new(id).exists());
    assert!(std::path::Path::new(&format!(
        "e/.thumbs/{}.thumb.webp",
        id.strip_prefix("e/").unwrap()
    ))
    .exists());
    {
        let conn = state.conn.lock().unwrap();
        let saved: String =
            conn.query_row("select image from gallery_images", [], |row| row.get(0))?;
        assert_eq!(id, saved);
    }
    assert_eq!(
        image::open(id)?.to_rgba8(),
        image::load_from_memory(include_bytes!("test.png"))?.to_rgba8()
    );
    assert!(stream.next().await.is_none());

    // Early notification sees a complete, readable thumbnail before the primary
    // exists. A disconnected receiver releases the thumbnail's name claim.
    let mut emitted = 0;
    let mut early_id = String::new();
    let result = crate::ingest::store_with_thumbnail(include_bytes!("test.png"), |id| {
        emitted += 1;
        early_id = id.to_owned();
        assert!(!std::path::Path::new(id).exists());
        let thumb = format!("e/.thumbs/{}.thumb.webp", id.strip_prefix("e/").unwrap());
        image::open(thumb)?;
        anyhow::bail!("event receiver disconnected")
    });
    assert_eq!(emitted, 1);
    assert!(!std::path::Path::new(&early_id).exists());
    assert!(!std::path::Path::new(&format!(
        "e/.thumbs/{}.thumb.webp",
        early_id.strip_prefix("e/").unwrap()
    ))
    .exists());
    assert_eq!(
        result.unwrap_err().to_string(),
        "event receiver disconnected"
    );

    // A valid decoded image outside WebP's dimension range can announce a
    // thumbnail, but a failed primary encode must release that claim too.
    let wide = image::RgbaImage::from_pixel(16_384, 1, image::Rgba([10, 20, 30, 255]));
    let mut png = std::io::Cursor::new(Vec::new());
    wide.write_to(&mut png, image::ImageFormat::Png)?;
    let mut failed_id = String::new();
    let result = crate::ingest::store_with_thumbnail(png.get_ref(), |id| {
        failed_id = id.to_owned();
        assert!(!std::path::Path::new(id).exists());
        Ok(())
    });
    assert!(format!("{:#}", result.unwrap_err()).contains("invalid WebP width"));
    assert!(!failed_id.is_empty());
    assert!(!std::path::Path::new(&failed_id).exists());
    assert!(!std::path::Path::new(&format!(
        "e/.thumbs/{}.thumb.webp",
        failed_id.strip_prefix("e/").unwrap()
    ))
    .exists());

    // Even a primary appearing after the thumbnail claim cannot be overwritten.
    let mut collided = String::new();
    let result = crate::ingest::store_with_thumbnail(include_bytes!("test.png"), |id| {
        collided = id.to_owned();
        fs::write(id, b"existing primary")?;
        Ok(())
    });
    assert!(result.is_err());
    assert_eq!(fs::read(&collided)?, b"existing primary");
    assert!(!std::path::Path::new(&format!(
        "e/.thumbs/{}.thumb.webp",
        collided.strip_prefix("e/").unwrap()
    ))
    .exists());

    // An event receiver failing after publication removes both provisional
    // files, and cannot accidentally add a gallery entry or report success.
    let mut provisional = String::new();
    let result = crate::ingest::store_with_progress(include_bytes!("test.png"), |update| {
        if let crate::ingest::StoreUpdate::Image(id) = update {
            provisional = id.to_owned();
            image::open(id)?;
            anyhow::bail!("receiver disconnected after image")
        }
        Ok(())
    });
    assert!(format!("{:#}", result.unwrap_err()).contains("receiver disconnected after image"));
    assert!(!provisional.is_empty());
    assert!(!std::path::Path::new(&provisional).exists());
    assert!(!std::path::Path::new(&format!(
        "e/.thumbs/{}.thumb.webp",
        provisional.strip_prefix("e/").unwrap()
    ))
    .exists());
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
