# Server upload encoding policy

Both `/api/upload` and `/api/upload-stream` use this policy for still images.
The browser's transcoding is an upload optimization; the server always detects
the format from the bytes, decodes the image, applies supported EXIF orientation,
and encodes its own output. Filenames, MIME types, incoming file sizes, and
browser encoder choices do not determine persistence or candidate settings.

## Two passes

The first pass runs these four encodes in parallel:

| Setting | Behavior                                            |
| ------- | --------------------------------------------------- |
| nl100   | Lossless WebP with preprocessing disabled           |
| nl40    | Lossless WebP after near-lossless RGB preprocessing |
| q90     | Lossy WebP at quality 90                            |
| q70     | Lossy WebP at quality 70                            |

Only if **every first-pass result is strictly larger than 2,000,000 bytes**,
run a second parallel pass: **q50, q35, q20, q5**. Exactly 2,000,000 bytes does
not trigger the second pass. There is no resizing or third pass.

Select across all attempted candidates:

1. Among outputs **strictly below 1,000,000 bytes**, prefer nl100, then nl40,
   then the highest lossy quality.
2. If no output fits, select the smallest actual output, regardless of setting.
   Ties use the configured candidate order.

These are decimal MB thresholds, not MiB. An output of exactly 1,000,000 bytes
does not fit the target. Results between 1 MB and 2 MB can be retained without
another pass, and even the second pass can exceed 2 MB. The target is soft.
Setting preference expresses the preservation policy; it does not use PSNR,
image classification, or the assumption that larger outputs look better.

Near-lossless uses `WebPEncodeRGBAWithNearLossless` from the checked-in full
WASM module. The wrapper sets lossless mode, preset quality 70 (compression
effort), default method 4, and RGBA/ARGB import. Its integer strength buckets
make levels 40–59 equivalent. Lossy candidates use default lossless alpha
(quality 100). All inputs are normalized to 8-bit RGBA before primary encoding;
nl100 disables additional RGB preprocessing at that precision. As with libwebp's
convenience lossless encoder, invisible RGB under fully transparent pixels may
be normalized; alpha itself remains lossless.

## Execution and failures

`src/webp_policy.rs` owns a process-wide four-worker pool. Every first pass is
fully evaluated, even if a fitting candidate finishes early. The second pass
waits for all first-pass work to finish. Concurrent uploads share those four
workers; each candidate gets an independent disposable Wasmtime sandbox from
`src/webp_encoder.rs`, borrowing the same read-only decoded pixels.

Each full-resolution candidate has a **2 GiB WASM linear-memory limit** and
a **60-second guest timeout**, rounded to whole-second epoch ticks. Memory
grows on demand; this is not a reservation. Four concurrent candidates can
consume up to 8 GiB of guest linear memory in total, in addition to host decoded
pixels, output buffers, and runtime overhead. The limits deliberately differ
from the thumbnail encoder's 256 MiB and 10-second defaults. The timeout covers
guest initialization and encoding, not queued work, compilation, or decoding.

If any candidate fails, exhausts its memory budget, or times out, that upload
fails instead of silently changing the candidate set. Already started work is
joined before returning an error; all sandbox memory is dropped on success,
failure, trap, and timeout. Outputs are copied out before native buffers are
freed. No original-byte passthrough or unsandboxed fallback is used.

Both endpoints run upload processing on blocking workers. The streaming endpoint
can announce its WebP thumbnail while primary encoding runs. Thumbnail settings
and storage remain independent of this policy.

## Persistence and API behavior

Successful still uploads persist only the selected server-encoded WebP at a
server-selected `e/<id>.webp` path. The previous JPEG fallback and automatic
`.raw.webp` companion archive are removed for new uploads. Existing images and
raw companions are untouched. Primary images and thumbnails are published
without clobbering existing names. Failed primary encodes release any pending
thumbnail claim and do not publish a primary or gallery entry.

Animated GIFs remain on the existing GIF decode/re-encode path, preserving
frames. They do not run the still-image candidate policy or its size targets.
The existing GIF loop handling is unchanged.

Multipart fields, image resource JSON, streaming events, gallery IDs, and
`?variant=thumbnail` URLs keep the existing shared client contract. Web and
Android clients already accept `.webp` image IDs. The browser upload policy
itself is unchanged by this server implementation.

## Evidence and tests

Rust tests cover strict byte boundaries, preference versus encoded size,
parallel passes, second-pass sequencing, smallest-output fallback, candidate
failure/join behavior, near-lossless RGB and alpha behavior, sandbox isolation
and resource limits, malformed inputs, 16-bit normalization, GIF frame retention,
and persistence/thumbnail/gallery contracts through both upload endpoints.

Run `cargo test`, `cargo fmt --check`, and `cargo clippy --all-targets`.
