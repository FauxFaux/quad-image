use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Barrier, Mutex};

fn pool() -> rayon::ThreadPool {
    rayon::ThreadPoolBuilder::new()
        .num_threads(4)
        .build()
        .unwrap()
}

fn candidate(setting: Setting, size: usize) -> Candidate {
    Candidate {
        setting,
        bytes: vec![0; size],
    }
}

#[test]
fn selection_prefers_fidelity_instead_of_size_and_excludes_exact_target() {
    let mut candidates = vec![
        candidate(Setting::Lossy(70), 50),
        candidate(Setting::NearLossless(40), 200),
        candidate(Setting::Lossy(90), 100),
        candidate(Setting::NearLossless(100), TARGET_BYTES - 1),
    ];
    assert_eq!(select(&candidates), 3);
    candidates[3].bytes.push(0); // Exactly one million bytes does not fit.
    assert_eq!(select(&candidates), 1);
    candidates[1].bytes.resize(TARGET_BYTES, 0);
    assert_eq!(select(&candidates), 2);
}

#[test]
fn parallel_first_pass_does_not_stop_at_a_fitting_candidate() -> Result<()> {
    let barrier = Barrier::new(4);
    let completed = AtomicUsize::new(0);
    let selected = encode_with(&pool(), &|setting| {
        assert!(FIRST_PASS.contains(&setting));
        // All four closures must be running concurrently to get past this.
        barrier.wait();
        completed.fetch_add(1, Ordering::SeqCst);
        Ok(vec![0; 10])
    })?;
    assert_eq!(completed.load(Ordering::SeqCst), 4);
    assert_eq!(selected.setting, Setting::NearLossless(100));
    Ok(())
}

#[test]
fn exact_second_pass_threshold_is_not_a_trigger() -> Result<()> {
    let calls = AtomicUsize::new(0);
    let selected = encode_with(&pool(), &|setting| {
        assert!(FIRST_PASS.contains(&setting));
        calls.fetch_add(1, Ordering::SeqCst);
        Ok(vec![0; SECOND_PASS_THRESHOLD])
    })?;
    assert_eq!(calls.load(Ordering::SeqCst), 4);
    assert_eq!(selected.bytes.len(), SECOND_PASS_THRESHOLD);
    Ok(())
}

#[test]
fn second_pass_waits_for_first_and_selects_highest_fitting_quality() -> Result<()> {
    let first_completed = AtomicUsize::new(0);
    let second_barrier = Barrier::new(4);
    let calls = Mutex::new(Vec::new());
    let selected = encode_with(&pool(), &|setting| {
        calls.lock().unwrap().push(setting);
        if FIRST_PASS.contains(&setting) {
            first_completed.fetch_add(1, Ordering::SeqCst);
            return Ok(vec![0; SECOND_PASS_THRESHOLD + 1]);
        }
        assert_eq!(first_completed.load(Ordering::SeqCst), 4);
        second_barrier.wait();
        Ok(vec![
            0;
            match setting {
                Setting::Lossy(50) => TARGET_BYTES + 1,
                Setting::Lossy(35) => TARGET_BYTES,
                Setting::Lossy(20) => TARGET_BYTES - 1,
                Setting::Lossy(5) => 100,
                _ => unreachable!(),
            }
        ])
    })?;
    assert_eq!(calls.lock().unwrap().len(), 8);
    assert_eq!(selected.setting, Setting::Lossy(20));
    Ok(())
}

#[test]
fn no_fit_selects_smallest_actual_output_not_lowest_quality() -> Result<()> {
    let selected = encode_with(&pool(), &|setting| {
        Ok(vec![
            0;
            match setting {
                Setting::Lossy(20) => TARGET_BYTES + 1,
                Setting::Lossy(5) => TARGET_BYTES + 2,
                _ => SECOND_PASS_THRESHOLD + 1,
            }
        ])
    })?;
    assert_eq!(selected.setting, Setting::Lossy(20));
    Ok(())
}

#[test]
fn one_to_two_mb_band_keeps_smallest_first_pass_without_retry() -> Result<()> {
    let selected = encode_with(&pool(), &|setting| {
        assert!(FIRST_PASS.contains(&setting));
        Ok(vec![
            0;
            if setting == Setting::Lossy(70) {
                TARGET_BYTES + 1
            } else {
                SECOND_PASS_THRESHOLD + 1
            }
        ])
    })?;
    assert_eq!(selected.setting, Setting::Lossy(70));
    assert_eq!(selected.bytes.len(), TARGET_BYTES + 1);
    Ok(())
}

#[test]
fn error_joins_all_candidates_and_never_starts_second_pass() {
    let barrier = Barrier::new(4);
    let completed = AtomicUsize::new(0);
    let error = encode_with(&pool(), &|setting| {
        assert!(FIRST_PASS.contains(&setting));
        barrier.wait();
        completed.fetch_add(1, Ordering::SeqCst);
        if setting == Setting::NearLossless(100) {
            anyhow::bail!("encoder failed");
        }
        Ok(vec![0; SECOND_PASS_THRESHOLD + 1])
    });
    assert_eq!(completed.load(Ordering::SeqCst), 4);
    assert!(format!("{:#}", error.err().unwrap()).contains("encoder failed"));
}

#[test]
fn actual_encoder_preserves_small_lossless_pixels_and_alpha() -> Result<()> {
    let pixels = image::RgbaImage::from_fn(17, 13, |x, y| {
        image::Rgba([
            (x * 13) as u8,
            (y * 17) as u8,
            (x * y) as u8,
            (x + y + 1) as u8,
        ])
    });
    let bytes = encode_rgba(pixels.as_raw(), 17, 13)?;
    assert_eq!(image::guess_format(&bytes)?, image::ImageFormat::WebP);
    assert_eq!(image::load_from_memory(&bytes)?.to_rgba8(), pixels);
    assert!(encode_rgba(&[0; 3], 1, 1).is_err());
    Ok(())
}
