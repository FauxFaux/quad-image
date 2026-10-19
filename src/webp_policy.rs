//! Two-pass, size-targeted still-image encoding. See docs/upload-encoding.md.

use std::time::Duration;

use anyhow::{Context, Result};
use once_cell::sync::OnceCell;
use rayon::prelude::*;

use crate::webp_encoder::{self, Limits};

const TARGET_BYTES: usize = 1_000_000;
const SECOND_PASS_THRESHOLD: usize = 2_000_000;
// Full-resolution images need larger budgets than thumbnails. The shared pool
// bounds this to four live sandboxes across all primary-image uploads.
const LIMITS: Limits = Limits {
    memory_bytes: 2 * 1024 * 1024 * 1024,
    timeout: Duration::from_secs(60),
};
static POOL: OnceCell<rayon::ThreadPool> = OnceCell::new();

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Setting {
    NearLossless(u8),
    Lossy(u8),
}

const FIRST_PASS: [Setting; 4] = [
    Setting::NearLossless(100),
    Setting::NearLossless(40),
    Setting::Lossy(90),
    Setting::Lossy(70),
];
const SECOND_PASS: [Setting; 4] = [
    Setting::Lossy(50),
    Setting::Lossy(35),
    Setting::Lossy(20),
    Setting::Lossy(5),
];

struct Candidate {
    setting: Setting,
    bytes: Vec<u8>,
}

/// Encode already decoded, tightly packed RGBA. Input codec and byte size do
/// not affect the candidates; alpha stays lossless even for lossy RGB encoding.
/// This blocks until every started sandbox has exited, including on failure.
pub fn encode_rgba(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>> {
    let pool = POOL.get_or_try_init(|| {
        rayon::ThreadPoolBuilder::new()
            .num_threads(4)
            .thread_name(|i| format!("upload-encoder-{i}"))
            .build()
    })?;
    let selected = encode_with(pool, &|setting| match setting {
        Setting::NearLossless(quality) => {
            webp_encoder::encode_rgba_with_near_lossless(rgba, width, height, quality, LIMITS)
        }
        Setting::Lossy(quality) => {
            webp_encoder::encode_rgba(rgba, width, height, f32::from(quality), LIMITS)
        }
    })?;
    println!(
        "upload WebP: {:?}, {} bytes ({}x{})",
        selected.setting,
        selected.bytes.len(),
        width,
        height
    );
    Ok(selected.bytes)
}

fn encode_with(
    pool: &rayon::ThreadPool,
    encode: &(impl Fn(Setting) -> Result<Vec<u8>> + Sync),
) -> Result<Candidate> {
    let pass = |settings: &[Setting]| {
        // Collect every outcome before propagating errors: no candidate remains
        // running after the upload returns or starts the next pass.
        let outcomes: Vec<Result<Candidate>> = pool.install(|| {
            settings
                .par_iter()
                .map(|&setting| {
                    Ok(Candidate {
                        setting,
                        bytes: encode(setting).with_context(|| format!("encoding {setting:?}"))?,
                    })
                })
                .collect()
        });
        outcomes.into_iter().collect::<Result<Vec<_>>>()
    };
    let mut candidates = pass(&FIRST_PASS)?;
    if candidates
        .iter()
        .all(|candidate| candidate.bytes.len() > SECOND_PASS_THRESHOLD)
    {
        candidates.extend(pass(&SECOND_PASS)?);
    }
    Ok(candidates.swap_remove(select(&candidates)))
}

fn select(candidates: &[Candidate]) -> usize {
    // Fidelity is a setting preference, not a comparison of output byte sizes
    // or perceptual metrics. Input order breaks equally ranked ties.
    candidates
        .iter()
        .enumerate()
        .filter(|(_, candidate)| candidate.bytes.len() < TARGET_BYTES)
        .min_by_key(|(_, candidate)| match candidate.setting {
            Setting::NearLossless(quality) => (0, 100 - quality),
            Setting::Lossy(quality) => (1, 100 - quality),
        })
        .or_else(|| {
            candidates
                .iter()
                .enumerate()
                .min_by_key(|(_, candidate)| candidate.bytes.len())
        })
        .expect("a successful pass produces four candidates")
        .0
}

#[cfg(test)]
mod tests;
