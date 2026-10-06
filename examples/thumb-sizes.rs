//! Compare thumbnail settings with the same resizer and encoder as the server.
//! Usage: cargo run --release --example thumb-sizes -- INPUT_DIR [OUTPUT_DIR]
use std::{env, fs, path::PathBuf, time::Instant};

use anyhow::{Context, Result};
use quad_image::webp_encoder::{encode_rgba, encode_rgba_with_alpha_quality, Limits};

fn main() -> Result<()> {
    let input = PathBuf::from(env::args().nth(1).context("expected INPUT_DIR")?);
    let output = env::args().nth(2).map(PathBuf::from);
    if let Some(output) = &output {
        fs::create_dir_all(output)?;
    }
    // Exclude the one-time module compilation from per-image encoding times.
    encode_rgba(&[0, 0, 0, 255], 1, 1, 30.0, Limits::default())?;
    let mut paths = fs::read_dir(input)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<std::io::Result<Vec<_>>>()?;
    paths.sort();
    println!("image,max_width,max_height,quality,alpha_quality,bytes,encode_ms");
    for path in paths {
        let name = path
            .file_name()
            .context("missing filename")?
            .to_string_lossy();
        if !path.is_file()
            || path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .map(str::len)
                != Some(10)
            || !matches!(
                path.extension().and_then(|ext| ext.to_str()),
                Some("jpg" | "png" | "webp" | "gif")
            )
        {
            continue;
        }
        let image = image::open(&path).with_context(|| format!("decoding {}", path.display()))?;
        for (width, height, quality, alpha_quality) in [
            (480, 240, 25.0, 100),
            (640, 320, 20.0, 100),
            (640, 320, 30.0, 100),
            (640, 320, 40.0, 100),
            (640, 320, 30.0, 30),
            (640, 320, 30.0, 10),
            (640, 320, 30.0, 0),
        ] {
            let shrunk = image.thumbnail(width, height).into_rgba8();
            let start = Instant::now();
            let encoded = encode_rgba_with_alpha_quality(
                shrunk.as_raw(),
                shrunk.width(),
                shrunk.height(),
                quality,
                alpha_quality,
                Limits::default(),
            )?;
            println!(
                "{name},{width},{height},{quality},{alpha_quality},{},{:.2}",
                encoded.len(),
                start.elapsed().as_secs_f64() * 1000.0
            );
            if let Some(output) = &output {
                fs::write(
                    output.join(format!("{name}-{width}-q{quality}-a{alpha_quality}.webp")),
                    encoded,
                )?;
            }
        }
    }
    Ok(())
}
