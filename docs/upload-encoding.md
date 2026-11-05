# Server upload encoding policy

Both `/api/upload` and `/api/upload-stream` use this policy for still images.
The [client encoding policy](client-encoding.md) optimizes upload transfers;
the server always detects the format from the bytes, decodes the image, applies
supported EXIF orientation, and encodes its own output. Filenames, MIME types, and browser encoder choices
do not determine persistence. Detected source codec and incoming byte count
only control whether an ordinary lossless candidate is worth attempting.

## Two passes

The first pass runs these encodes in parallel:

| Setting | Behavior                                            |
| ------- | --------------------------------------------------- |
| nl100   | Lossless WebP with preprocessing disabled           |
| q90     | Lossy WebP at quality 90                            |
| q80     | Lossy WebP at quality 80                            |
| q70     | Lossy WebP at quality 70                            |

For a **lossy WebP or JPEG strictly larger than 1,000,000 input bytes**, skip
`nl100` and run only q90, q80, and q70. WebP losslessness comes from
`image_webp::WebPDecoder::is_lossy()`; filenames and MIME types are not used. Exactly 1,000,000 bytes remains eligible. PNGs, lossless WebPs, and
other still formats retain the lossless attempt. All inputs still decode and
re-encode on the server. `nl40` is no longer attempted at any size.

Only if **every first-pass result is strictly larger than 2,000,000 bytes**,
run a second parallel pass: **q50, q35, q20, q5**. Exactly 2,000,000 bytes does
not trigger the second pass. There is no resizing or third pass.

Select across all attempted candidates:

1. Among outputs **strictly below 1,000,000 bytes**, prefer nl100, then the
   highest lossy quality (q90, q80, q70, then second-pass settings).
2. If no output fits, select the smallest actual output, regardless of setting.
   Ties use the configured candidate order.

These are decimal MB thresholds, not MiB. An output of exactly 1,000,000 bytes
does not fit the target. Results between 1 MB and 2 MB can be retained without
another pass, and even the second pass can exceed 2 MB. The target is soft.
Setting preference expresses the preservation policy; it does not use PSNR,
image classification, or the assumption that larger outputs look better.

The nl100 candidate uses `WebPEncodeRGBAWithNearLossless` from the checked-in full
WASM module. The wrapper sets lossless mode, preset quality 70 (compression
effort), default method 4, and RGBA/ARGB import. Lossy candidates use default
lossless alpha (quality 100). All inputs are normalized to 8-bit RGBA before primary encoding;
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

If any candidate fails, exhausts its memory budget, or times out, the worker
returns an error instead of silently changing the candidate set. Already started
work is joined and can still publish successful candidates. If no image reaches
readiness, the upload fails. After readiness, the last published image and its
gallery entry remain available. All sandbox memory is dropped on success,
failure, trap, and timeout. Outputs are copied out before native buffers are
freed. No original-byte passthrough or unsandboxed fallback is used.

Both endpoints run the same upload processing on blocking workers. They publish
a WebP thumbnail first, then primary images as candidates finish. A separate
readiness callback runs once the first primary has been atomically published;
it completes thumbnail generation and any requested gallery insertion. Only
after that callback succeeds are the primary and thumbnail retained on subsequent
failures. Thumbnail settings and storage remain independent of this policy.

`/api/upload` returns its existing plain text, JSON, or redirect response as soon
as readiness succeeds, using the image URL without `?work-in-progress`. Its
worker continues all remaining encodes and atomically replaces the primary with
each improvement at that same path. Later optimization failures are logged and
cannot revoke the successful response. A client that caches the early response
may continue to see that complete image until it fetches the URL again.

## Streamed provisional images

For both endpoints, the first completed candidate is published immediately
at the target image path. Each later candidate replaces it only if it wins under
the same selection rules used for the final result: prefer fidelity below the
target, otherwise prefer smaller output, breaking ties by configured order.
This includes improvements from the second pass. Every configured attempt still
runs; early publication does not change the final selection rules.

After each publication the server sends an SSE `status` event:

```json
{"kind":"image","id":"e/abcdefghij.webp","url":"e/abcdefghij.webp?work-in-progress"}
```

Before submitting a pass to the worker pool, the server sends an SSE `status`
event listing its planned settings:

```json
{"kind":"planned","names":["nl100","q90","q80","q70"]}
```

For large lossy sources the first plan contains only `q90`, `q80`, and `q70`.
This event is emitted even while all encoder workers are busy. A second plan
listing `q50`, `q35`, `q20`, and `q5` is emitted only if the first-pass results
trigger that pass, before its work is submitted.

Every completed primary encode also sends an SSE `status` event, including
candidates that do not improve the currently published image:

```json
{"kind":"encoded","name":"q90","bytes":848030,"improved":true}
```

Names use `q<quality>` for lossy encodes and `nl<level>` for near-lossless
encodes, with `nl100` representing ordinary lossless. Byte sizes are positive
integers measured from the completed output. Results arrive in completion order
for both passes; an `encoded` event precedes any corresponding `image` event.
`improved` marks candidates that win over all earlier completed candidates;
the last such candidate is the final winner when the upload succeeds.
The client keeps rows in planned order and fills each pending row in place as
its result arrives. Repeated plans do not duplicate or reset existing rows.

The first publication cannot clobber an existing primary. Replacements use
atomic rename of complete, readable files, so active readers retain their
previous complete image. Only the upload's own provisional primary is replaced.
The query string separates the provisional URL from the final URL in caches;
it requires no special serving or proxy behavior.

The web client validates the image ID and matching provisional URL and shows the
server thumbnail when available. A copy button is present from the start but
disabled until a primary image is available; it then reads “copy intermediate”.
The details expander uses the current queued, preparation, transfer, server
processing, or error status as its label. Once an intermediate image is ready,
it reads “Encode details” with a spinner until completion.
The initially collapsed fold contains the browser's upload statistics and each
server encode's name and size to one decimal place, with the currently winning
server row highlighted. Rows show “Pending…” until an encode completes, or
“Not completed” if the upload ends without that result. Results remain available
for this session after completion or an encoding failure.
Stable card identities and a shared component preserve the expanded fold and
table as uploads progress, complete, and change position in the list.
Both endpoints insert the image into its requested gallery at first readiness,
before reporting a primary image to the client, and do not repeat the insertion
as improved images arrive. After all encoding succeeds, the existing `done`
event carries the final image ID without a query string, and the copy button
uses that URL.
Non-streamed uploads, including Android's `/api/upload` requests, retain their
existing response contract and return at first readiness. GIF uploads
continue to finish through the existing `done` event.

## Persistence and API behavior

Still uploads persist a server-encoded WebP at a server-selected `e/<id>.webp`
path. The previous JPEG fallback and automatic
`.raw.webp` companion archive are removed for new uploads. Existing images and
raw companions are untouched. New primary names and thumbnails are claimed
without clobbering existing names. Before readiness, failures release any pending
thumbnail claim and remove any provisional primary owned by that upload; no
gallery entry is added. Once the first image and gallery write succeed, later
failures retain the latest successfully published primary and its thumbnails.
Streaming clients still receive an `error` event if optimization fails, while
the retained gallery image remains usable.

Animated GIFs remain on the existing GIF decode/re-encode path, preserving
frames. They do not run the still-image candidate policy or its size targets.
The existing GIF loop handling is unchanged.

Multipart fields, image resource JSON, existing streaming events, gallery IDs,
and `?variant=thumbnail` URLs keep their existing shapes. The streaming endpoint
adds the `image`, `planned`, and `encoded` statuses described above. Web and Android clients already accept
`.webp` image IDs. Client transfer thresholds and qualities are documented in
[the client encoding policy](client-encoding.md).

## Upload logging

Upload lifecycle records are single-line JSON on stdout with `component: "upload"`.
Every record includes a random `request_id`, `timestamp_ms` (Unix milliseconds),
`elapsed_ms`, the socket `peer`, the reported `forwarded_for` header, `endpoint`,
and a `legacy` boolean. The owned caller information follows the background
worker after the HTTP handler returns. Gallery passwords are not logged.

The `received` record is written before multipart parsing. `accepted` records
the uploaded byte count after form and gallery validation. `image_id` is null
until the `assigned` record, which is written as soon as a still image's name is
claimed, before any client progress delivery or primary encoding. GIF assignment
is recorded immediately after its re-encoded file is persisted, before permission
updates and readiness work. Failures before a name is assigned remain searchable
by `request_id` and caller.

| Event | Meaning |
| --- | --- |
| `transcode` | Detected input format and WebP candidate or GIF re-encode policy. |
| `decoded` | Decoded still-image dimensions after supported EXIF orientation. |
| `planned` | Candidate names scheduled for each pass. |
| `encoded` | Completed candidate name, byte count, and `improved` decision. |
| `published` | Successfully published candidate name and byte count, before gallery work. |
| `ready` | Thumbnail and gallery work succeeded; includes the first selected image. |
| `response` | HTTP response status, including the early legacy response. |
| `finished` | Final processing outcome after the worker finishes, including failure or panic. |

Every record after assignment carries the image ID, including failures during
primary encoding, gallery work, or client delivery. `finished.success` means all
processing and progress delivery completed. `ready` records whether the upload
reached readiness, `retained` reports whether the primary file still exists, and
`selected` gives the last successfully published name and byte count. `error`
contains the full error chain on failure. A legacy HTTP success can therefore
be followed by `finished.success: false` with `retained: true` if a later encode
fails. GIF persistence before readiness follows its existing policy. Candidate
errors include the failing setting in the terminal error chain; progress stops
after a publication or delivery failure, while already started encodes are joined.

## Latency goals and evidence

The interactivity goal is a first encode result within one second and a final
result within a few seconds. These are best-effort goals, not hard deadlines:
large decoded images, compilation, and contention in the shared pool can exceed
them. Skipping expensive candidates reduces both completion latency and the
queueing imposed on other uploads; it does not resize images or preempt work.

The local `quad.journal` sample contained 357 complete four-candidate comparisons.
`nl40` was selected 21 times (5.9%), so it did sometimes provide a fitting result
when nl100 did not. In all 21 cases q90 also fit, with a smaller output. Logs do
not establish visual equivalence. Removing nl40 trades that preservation
preference for lower latency; q80 adds a middle quality between q90 and q70.
There are no q80 measurements in those logs.

Measured from pass planning, median completion was 1,239 ms for nl100, 1,684 ms
for nl40, 260 ms for q90, and 258 ms for q70. These measurements include queueing
and contention. Across those requests, the first result arrived within one
second in 267/357 cases (74.8%); final completion was within three seconds in
229/357 cases (64.1%) and five seconds in 265/357 (74.2%). The 95th percentiles
were 3.532 seconds to first result and 25.029 seconds to final completion, measured
from request receipt. None of the 45 inputs larger than 1,000,000 bytes produced
an nl100 output below the target. The logs identify WebP containers, not their
lossy/lossless bitstreams; the runtime guard distinguishes those bitstreams to
retain lossless attempts for lossless sources.

These are observations of the previous policy, not measured speedups for the
new one. Source images, identifiers, and raw logs remain outside version control.

## Evidence and tests

Rust tests cover the source-size cutoff, lossy/lossless WebP classification,
three- and four-candidate plans, strict output byte boundaries, preference versus
encoded size,
parallel passes, second-pass sequencing, smallest-output fallback, candidate
failure/join behavior, near-lossless RGB and alpha behavior, sandbox isolation
and resource limits, malformed inputs, 16-bit normalization, GIF frame retention,
and persistence/thumbnail/gallery contracts through both upload endpoints.
Additional tests cover readiness before slower candidates finish, improvements
at the same URL, gallery insertion before stream completion, retention after
readiness, publication failure, atomic replacement and rollback, provisional SSE URLs,
runtime URL and encode-result validation, temporary/final clipboard behavior,
folded encode details, all-candidate completion events, and preview cleanup.

Run `cargo test`, `cargo fmt --check`, and `cargo clippy --all-targets`.
