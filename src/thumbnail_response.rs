use std::collections::HashMap;

use axum::extract::{Query, Request};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use tower_http::services::ServeFile;

fn thumbnail_file(uri: &axum::http::Uri) -> Option<String> {
    let Query(query) = Query::<HashMap<String, String>>::try_from_uri(uri).ok()?;
    if query.get("variant").map(String::as_str) != Some("thumbnail") {
        return None;
    }
    let image = uri.path().strip_prefix('/')?;
    if !crate::is_image_id(image) {
        return None;
    }
    Some(format!(
        "e/.thumbs/{}.thumb.webp",
        image.strip_prefix("e/")?
    ))
}

pub async fn serve(request: Request, next: Next) -> Response {
    let Some(file) = thumbnail_file(request.uri()) else {
        return next.run(request).await;
    };
    serve_file(&file, request).await
}

async fn serve_file(file: &str, request: Request) -> Response {
    match ServeFile::new(file).try_call(request).await {
        Ok(response) => response.into_response(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            StatusCode::NOT_FOUND.into_response()
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};

    #[test]
    fn selects_only_thumbnail_variants_of_image_ids() {
        for uri in [
            "/e/abcdefghij.png?variant=thumbnail",
            "/e/abcdefghij.png?other=1&variant=thumbnail",
        ] {
            assert_eq!(
                thumbnail_file(&uri.parse().unwrap()).as_deref(),
                Some("e/.thumbs/abcdefghij.png.thumb.webp")
            );
        }
        for uri in [
            "/e/abcdefghij.png",
            "/e/abcdefghij.png?variant=original",
            "/e/abcdefghij.png.thumb.jpg?variant=thumbnail",
            "/e/../secret?variant=thumbnail",
            "/api/upload?variant=thumbnail",
        ] {
            assert_eq!(thumbnail_file(&uri.parse().unwrap()), None);
        }
    }

    #[tokio::test]
    async fn serves_webp_without_redirect_and_preserves_head_and_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("image.thumb.webp");
        let bytes = include_bytes!("../tests/orient.png");
        let image = image::load_from_memory(bytes).unwrap();
        image.save(&file).unwrap();
        let expected = std::fs::read(&file).unwrap();
        for method in ["GET", "HEAD"] {
            let request = Request::builder()
                .method(method)
                .uri("/e/abcdefghij.png?variant=thumbnail")
                .body(Body::empty())
                .unwrap();
            let response = serve_file(file.to_str().unwrap(), request).await;
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()["content-type"], "image/webp");
            assert!(!response.headers().contains_key("location"));
            let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            assert_eq!(
                body.as_ref(),
                if method == "GET" {
                    expected.as_slice()
                } else {
                    &[]
                }
            );
        }
        let response = serve_file(
            dir.path().join("missing.webp").to_str().unwrap(),
            Request::new(Body::empty()),
        )
        .await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
