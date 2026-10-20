//! Two-pass, size-targeted still-image encoding. See docs/upload-encoding.md.

use std::sync::Mutex;
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

pub struct EncodeProgress<'a> {
    pub name: String,
    pub bytes: &'a [u8],
    pub improved: bool,
}

/// Encode already decoded, tightly packed RGBA. Input codec and byte size do
/// not affect the candidates; alpha stays lossless even for lossy RGB encoding.
/// This blocks until every started sandbox has exited, including on failure.
pub fn encode_rgba(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>> {
    encode_rgba_with_progress(rgba, width, height, |_| Ok(()))
}

/// Report every completed candidate, marking the first and later improvements.
/// Calls are serialized, and all work is joined before returning, even on error.
pub fn encode_rgba_with_progress(
    rgba: &[u8],
    width: u32,
    height: u32,
    report: impl FnMut(EncodeProgress<'_>) -> Result<()> + Send,
) -> Result<Vec<u8>> {
    let pool = POOL.get_or_try_init(|| {
        rayon::ThreadPoolBuilder::new()
            .num_threads(4)
            .thread_name(|i| format!("upload-encoder-{i}"))
            .build()
    })?;
    let selected = encode_with_progress(
        pool,
        &|setting| match setting {
            Setting::NearLossless(quality) => {
                webp_encoder::encode_rgba_with_near_lossless(rgba, width, height, quality, LIMITS)
            }
            Setting::Lossy(quality) => {
                webp_encoder::encode_rgba(rgba, width, height, f32::from(quality), LIMITS)
            }
        },
        report,
    )?;
    println!(
        "upload WebP: {:?}, {} bytes ({}x{})",
        selected.setting,
        selected.bytes.len(),
        width,
        height
    );
    Ok(selected.bytes)
}

#[cfg(test)]
fn encode_with(
    pool: &rayon::ThreadPool,
    encode: &(impl Fn(Setting) -> Result<Vec<u8>> + Sync),
) -> Result<Candidate> {
    encode_with_progress(pool, encode, |_| Ok(()))
}

fn encode_with_progress(
    pool: &rayon::ThreadPool,
    encode: &(impl Fn(Setting) -> Result<Vec<u8>> + Sync),
    mut report: impl FnMut(EncodeProgress<'_>) -> Result<()> + Send,
) -> Result<Candidate> {
    let mut best = None;
    let mut reporting_failed = false;
    let progress = Mutex::new(|candidate: &Candidate| -> Result<()> {
        let key = selection_key(candidate);
        if !reporting_failed {
            let improved = best.is_none_or(|best| key < best);
            let name = match candidate.setting {
                Setting::NearLossless(quality) => format!("nl{quality}"),
                Setting::Lossy(quality) => format!("q{quality}"),
            };
            if let Err(error) = report(EncodeProgress {
                name,
                bytes: &candidate.bytes,
                improved,
            }) {
                reporting_failed = true;
                return Err(error.context("reporting WebP candidate"));
            }
            if improved {
                best = Some(key);
            }
        }
        Ok(())
    });
    let pass = |settings: &[Setting]| {
        // Collect every outcome before propagating errors: no candidate remains
        // running after the upload returns or starts the next pass.
        let outcomes: Vec<Result<Candidate>> = pool.install(|| {
            settings
                .par_iter()
                .map(|&setting| {
                    let candidate = Candidate {
                        setting,
                        bytes: encode(setting).with_context(|| format!("encoding {setting:?}"))?,
                    };
                    progress.lock().unwrap()(&candidate)?;
                    Ok(candidate)
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
    // or perceptual metrics. Configured order breaks equally ranked ties.
    candidates
        .iter()
        .enumerate()
        .min_by_key(|(_, candidate)| selection_key(candidate))
        .expect("a successful pass produces four candidates")
        .0
}

fn selection_key(candidate: &Candidate) -> (bool, usize, usize) {
    let order = FIRST_PASS
        .iter()
        .chain(&SECOND_PASS)
        .position(|setting| *setting == candidate.setting)
        .expect("configured candidate");
    let fits = candidate.bytes.len() < TARGET_BYTES;
    (!fits, if fits { 0 } else { candidate.bytes.len() }, order)
}

#[cfg(test)]
mod tests;
