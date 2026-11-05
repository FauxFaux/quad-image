//! Two-pass, size-targeted still-image encoding. See docs/upload-encoding.md.

use std::cmp::Reverse;
use std::sync::Mutex;
use std::time::Duration;

use anyhow::{Context, Result};
use once_cell::sync::OnceCell;
use rayon::prelude::*;

use crate::webp_encoder::{self, Limits};

const TARGET_BYTES: usize = 1_000_000;
const SECOND_PASS_THRESHOLD: usize = 2_000_000;
const LOSSY_INPUT_LOSSLESS_LIMIT: usize = 1_000_000;
// Full-resolution images need larger budgets than thumbnails. The shared pool
// bounds this to four live sandboxes across all primary-image uploads.
const LIMITS: Limits = Limits {
    memory_bytes: 2 * 1024 * 1024 * 1024,
    timeout: Duration::from_secs(60),
};
static POOL: OnceCell<rayon::ThreadPool> = OnceCell::new();

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Setting {
    Lossless,
    Lossy(u8),
}

impl Setting {
    fn name(self) -> String {
        match self {
            Self::Lossless => "nl100".to_owned(),
            Self::Lossy(quality) => format!("q{quality}"),
        }
    }

    fn fidelity_rank(self) -> (bool, Reverse<u8>) {
        match self {
            Self::Lossless => (false, Reverse(0)),
            Self::Lossy(quality) => (true, Reverse(quality)),
        }
    }
}

const LOSSY_FIRST_PASS: [Setting; 3] = [Setting::Lossy(90), Setting::Lossy(80), Setting::Lossy(70)];
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

/// Scheduling hints from validated input bytes, never permission to persist them.
pub struct Source {
    pub bytes: usize,
    pub lossy: bool,
}

impl Source {
    fn first_pass(&self) -> Vec<Setting> {
        let mut settings = Vec::new();
        if !self.lossy || self.bytes <= LOSSY_INPUT_LOSSLESS_LIMIT {
            settings.push(Setting::Lossless);
        }
        settings.extend_from_slice(&LOSSY_FIRST_PASS);
        settings
    }
}

pub enum EncodeProgress<'a> {
    Planned(Vec<String>),
    Completed {
        name: String,
        bytes: &'a [u8],
        improved: bool,
    },
}

/// Encode already decoded, tightly packed RGBA without source codec hints.
/// Alpha stays lossless even for lossy RGB encoding.
/// This blocks until every started sandbox has exited, including on failure.
pub fn encode_rgba(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>> {
    encode_rgba_with_progress(
        rgba,
        width,
        height,
        Source {
            bytes: 0,
            lossy: false,
        },
        |_| Ok(()),
    )
}

/// Announce each pass before scheduling it, then report every completed candidate.
/// Calls are serialized, and all work is joined before returning, even on error.
pub fn encode_rgba_with_progress(
    rgba: &[u8],
    width: u32,
    height: u32,
    source: Source,
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
        &source.first_pass(),
        &|setting| match setting {
            Setting::Lossless => {
                webp_encoder::encode_rgba_with_near_lossless(rgba, width, height, 100, LIMITS)
            }
            Setting::Lossy(quality) => {
                webp_encoder::encode_rgba(rgba, width, height, f32::from(quality), LIMITS)
            }
        },
        report,
    )?;
    Ok(selected.bytes)
}

fn encode_with_progress(
    pool: &rayon::ThreadPool,
    first_pass: &[Setting],
    encode: &(impl Fn(Setting) -> Result<Vec<u8>> + Sync),
    report: impl FnMut(EncodeProgress<'_>) -> Result<()> + Send,
) -> Result<Candidate> {
    let progress = Mutex::new((report, None, false));
    let pass = |settings: &[Setting]| {
        {
            // This runs on the caller, before pool.install can wait for workers.
            let (report, _, _) = &mut *progress.lock().unwrap();
            report(EncodeProgress::Planned(
                settings.iter().map(|setting| setting.name()).collect(),
            ))
            .context("reporting planned WebP encodes")?;
        }
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
                    let (report, best, reporting_failed) = &mut *progress.lock().unwrap();
                    if !*reporting_failed {
                        let key = selection_key(&candidate);
                        let improved = best.is_none_or(|best| key < best);
                        if let Err(error) = report(EncodeProgress::Completed {
                            name: setting.name(),
                            bytes: &candidate.bytes,
                            improved,
                        }) {
                            *reporting_failed = true;
                            return Err(error.context("reporting WebP candidate"));
                        }
                        if improved {
                            *best = Some(key);
                        }
                    }
                    Ok(candidate)
                })
                .collect()
        });
        outcomes.into_iter().collect::<Result<Vec<_>>>()
    };
    let mut candidates = pass(first_pass)?;
    if candidates
        .iter()
        .all(|candidate| candidate.bytes.len() > SECOND_PASS_THRESHOLD)
    {
        candidates.extend(pass(&SECOND_PASS)?);
    }
    Ok(candidates.swap_remove(select(&candidates)))
}

fn select(candidates: &[Candidate]) -> usize {
    // Within the target, prefer lossless, then the highest lossy quality.
    // Otherwise prefer the smallest output, using fidelity to break size ties.
    candidates
        .iter()
        .enumerate()
        .min_by_key(|(_, candidate)| selection_key(candidate))
        .expect("a successful pass produces candidates")
        .0
}

fn selection_key(candidate: &Candidate) -> (bool, usize, (bool, Reverse<u8>)) {
    let fits = candidate.bytes.len() < TARGET_BYTES;
    (
        !fits,
        if fits { 0 } else { candidate.bytes.len() },
        candidate.setting.fidelity_rank(),
    )
}

#[cfg(test)]
mod tests;
