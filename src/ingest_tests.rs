use std::{fs, io};

use image::ImageFormat;

#[test]
fn guess_format_recognizes_upload_fixtures() -> anyhow::Result<()> {
    for (data, expected) in [
        (include_bytes!("test.png").as_slice(), ImageFormat::Png),
        (
            include_bytes!("../tests/orient.jpg").as_slice(),
            ImageFormat::Jpeg,
        ),
        (
            include_bytes!("../tests/parrot.gif").as_slice(),
            ImageFormat::Gif,
        ),
        (
            include_bytes!("../tests/orient.webp").as_slice(),
            ImageFormat::WebP,
        ),
    ] {
        assert_eq!(super::guess_format(data)?, expected);
    }
    Ok(())
}

#[test]
fn guess_format_rejects_non_image_riff_and_short_inputs() {
    for data in [
        b"".as_slice(),
        b"RIF",
        b"RIFF",
        b"RIFF\x04\0\0\0WEB",
        b"RIFF\x04\0\0\0WAVE",
        b"RIFF\x04\0\0\0AVI ",
    ] {
        let error = super::guess_format(data).unwrap_err();
        assert!(error
            .to_string()
            .starts_with(&format!("guess from {} bytes:", data.len())));
    }
}

#[test]
fn source_hints_distinguish_lossy_webp_from_lossless_and_png() -> anyhow::Result<()> {
    for alpha in [255, 128] {
        let pixels = image::RgbaImage::from_pixel(2, 2, image::Rgba([12, 34, 56, alpha]));
        let lossy = crate::webp_encoder::encode_rgba(
            pixels.as_raw(),
            2,
            2,
            80.0,
            crate::webp_encoder::Limits::default(),
        )?;
        let exact = crate::webp_encoder::encode_rgba_with_near_lossless(
            pixels.as_raw(),
            2,
            2,
            100,
            crate::webp_encoder::Limits::default(),
        )?;
        for (data, expected) in [(lossy.as_slice(), true), (exact.as_slice(), false)] {
            let source = super::encode_source(data, super::guess_format(data)?)?;
            assert_eq!(source.lossy, expected);
            assert_eq!(source.bytes, data.len());
        }
    }
    for (data, expected) in [
        (include_bytes!("../tests/orient.jpg").as_slice(), true),
        (include_bytes!("test.png").as_slice(), false),
    ] {
        let source = super::encode_source(data, super::guess_format(data)?)?;
        assert_eq!(source.lossy, expected);
        assert_eq!(source.bytes, data.len());
    }
    assert!(super::encode_source(b"RIFF", ImageFormat::WebP).is_err());
    Ok(())
}

fn pending_image(dir: &std::path::Path) -> super::PendingImage {
    let thumbnail = dir.join("thumbnail.webp");
    fs::write(&thumbnail, b"thumbnail").unwrap();
    super::PendingImage {
        id: dir.join("primary.webp").to_str().unwrap().to_owned(),
        thumbnail,
        persisted: false,
        published: false,
    }
}

fn completed(bytes: &[u8], improved: bool) -> crate::webp_policy::EncodeProgress<'_> {
    crate::webp_policy::EncodeProgress::Completed {
        name: "test".to_owned(),
        bytes,
        improved,
    }
}

#[test]
fn readiness_precedes_completion_and_later_improvements_keep_the_same_id() -> anyhow::Result<()> {
    use std::sync::mpsc;
    use std::time::Duration;

    let dir = tempfile::tempdir()?;
    let pending = pending_image(dir.path());
    let id = pending.id.clone();
    let (ready_tx, ready_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        super::store_candidates(
            pending,
            |_| Ok(()),
            |id| {
                assert_eq!(fs::read(id)?, b"first image");
                ready_tx.send(id.to_owned())?;
                Ok(())
            },
            |report| {
                report(completed(b"first image", true))?;
                release_rx.recv_timeout(Duration::from_secs(5))?;
                report(completed(b"worse image", false))?;
                report(completed(b"better image", true))?;
                Ok(b"better image".to_vec())
            },
        )
    });
    let ready = ready_rx.recv_timeout(Duration::from_secs(5));
    let first = fs::read(&id);
    let still_encoding = !worker.is_finished();
    // Release before asserting, so a regression cannot leave a blocked worker.
    release_tx.send(())?;
    let final_id = worker.join().unwrap()?;
    assert_eq!(ready?, id);
    assert_eq!(first?, b"first image");
    assert!(still_encoding);
    assert_eq!(final_id, id);
    assert_eq!(fs::read(id)?, b"better image");
    assert!(ready_rx.try_recv().is_err(), "readiness is signalled once");
    Ok(())
}

#[test]
fn failures_after_readiness_retain_the_last_image_and_thumbnail() -> anyhow::Result<()> {
    // Both a later encoder failure and a disconnected progress receiver
    // must leave acknowledged images (and their gallery targets) usable.
    for notification_fails in [false, true] {
        let dir = tempfile::tempdir()?;
        let pending = pending_image(dir.path());
        let id = pending.id.clone();
        let thumbnail = pending.thumbnail.clone();
        let mut ready = 0;
        let result = super::store_candidates(
            pending,
            |update| {
                if notification_fails && matches!(update, super::StoreUpdate::Encoded { .. }) {
                    anyhow::bail!("receiver disconnected");
                }
                Ok(())
            },
            |_| {
                ready += 1;
                Ok(())
            },
            |report| {
                report(completed(b"first image", true))?;
                report(completed(b"better image", true))?;
                anyhow::bail!("later encoder timed out")
            },
        );
        assert!(result.is_err());
        assert_eq!(ready, 1);
        assert_eq!(
            fs::read(id)?,
            if notification_fails {
                b"first image".as_slice()
            } else {
                b"better image".as_slice()
            }
        );
        assert!(thumbnail.exists());
    }
    Ok(())
}

#[test]
fn failures_before_readiness_roll_back_the_image_and_thumbnail() -> anyhow::Result<()> {
    for readiness_fails in [false, true] {
        let dir = tempfile::tempdir()?;
        let pending = pending_image(dir.path());
        let id = pending.id.clone();
        let thumbnail = pending.thumbnail.clone();
        let mut ready = 0;
        let result = super::store_candidates(
            pending,
            |_| Ok(()),
            |_| {
                ready += 1;
                anyhow::bail!("gallery write failed")
            },
            |report| {
                if readiness_fails {
                    report(completed(b"first image", true))?;
                }
                anyhow::bail!("encoder failed")
            },
        );
        assert!(result.is_err());
        assert_eq!(ready, usize::from(readiness_fails));
        assert!(!std::path::Path::new(&id).exists());
        assert!(!thumbnail.exists());
    }
    Ok(())
}

#[test]
fn provisional_images_are_readable_atomic_and_removed_on_failure() -> anyhow::Result<()> {
    use std::io::Read;
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir()?;
    let mut pending = pending_image(dir.path());
    pending.publish(b"first complete image")?;
    assert_eq!(
        fs::metadata(&pending.id)?.permissions().mode() & 0o777,
        0o644
    );
    let mut reader = fs::File::open(&pending.id)?;
    pending.publish(b"better complete image")?;
    assert_eq!(fs::read(&pending.id)?, b"better complete image");
    let mut original = Vec::new();
    reader.read_to_end(&mut original)?;
    assert_eq!(
        original, b"first complete image",
        "replacement leaves active readers intact"
    );
    let id = pending.id.clone();
    let thumbnail = pending.thumbnail.clone();
    drop(pending);
    assert!(!std::path::Path::new(&id).exists());
    assert!(!thumbnail.exists());
    Ok(())
}

#[test]
fn provisional_first_write_never_clobbers_an_existing_primary() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    let mut pending = pending_image(dir.path());
    fs::write(&pending.id, b"someone else's image")?;
    assert!(pending.publish(b"candidate").is_err());
    let id = pending.id.clone();
    drop(pending);
    assert_eq!(fs::read(id)?, b"someone else's image");
    Ok(())
}

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
