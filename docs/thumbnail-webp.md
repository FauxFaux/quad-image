# WebP thumbnail settings

`src/thumbs.rs` keeps the existing 320×160, quality-40 JPEG and additionally
writes a still WebP with a 640×320 bounding box at colour quality 30 and alpha
quality 30 (eight alpha levels). For the fictional original
`e/abcdefghij.jpg`, the new path is `e/.thumbs/abcdefghij.jpg.thumb.webp`.
Both outputs preserve aspect ratio and are generated directly from the original.
The upload response still returns the JPEG path; adopting WebP in clients is a
separate change. Startup repairs either missing output without replacing the
other. Its backfill completes before the HTTP listener starts, so the first
startup after this change will take longer.

## Quality tradeoffs

The larger bounding box gives twice the JPEG width and height. Low colour
quality controls the cost of the additional pixels; lower qualities reduce
bytes further at the expense of texture and detail.

Libwebp's convenience encoder defaults to lossless alpha independently of
colour quality. The added WASM entry point exposes `WebPConfig.alpha_quality`.
See the pinned [alpha encoder source](https://github.com/webmproject/libwebp/blob/v1.6.0/src/enc/alpha_enc.c)
for its quality-to-level mapping.

| Alpha quality | Maximum alpha levels |
| ---: | ---: |
| 100 | 256 |
| **30** | **8** |
| 10 | 4 |
| 0 | 2 |

Alpha quality 30 reduces the cost of complex transparency while keeping
smoother edges than more aggressive settings. Lower alpha qualities can
produce visible outlines or jagged edges. Opaque images are unaffected, so
reducing alpha quality will only lower high-percentile sizes when transparent
images contribute to that part of the distribution. Colour quality remains 30.

The new export at alpha quality 100 preserves the original encoder's output.
Existing browser upload and lossless entry points retain their behavior.

## Measuring your own sample

Use a representative sample of images you have permission to process. For
example, sample evenly across existing JPEG thumbnail size deciles. Keep asset
names, source locations, manifests, generated previews, and deployment-specific
measurements outside the repository.

From the repository root, run the benchmark against your local sample:

```sh
cargo run --release --example thumb-sizes -- \
  /tmp/thumbnail-sample/images /tmp/thumbnail-sample/previews \
  > /tmp/thumbnail-sample/results.csv
```

The benchmark uses the application's `image::thumbnail` resizer and checked-in
Wasmtime/libwebp encoder, including its RGBA and alpha handling. It compares
480×240 at colour quality 25 and 640×320 at colour qualities 20, 30, and 40,
with lossless alpha. It also compares alpha qualities 30, 10, and 0 at 640×320,
colour quality 30. The optional second argument saves WebPs for visual
inspection; the CSV includes input filenames, so keep it private.

Compare the output sizes with the existing JPEG thumbnails rather than
re-encoding the JPEG baseline. Inspect transparency against multiple background
colours as well as photographs, charts, and screenshots. Encoding timings
exclude one-time module compilation, decoding, and resizing; startup backfill
also decodes originals and runs concurrently through Rayon.
