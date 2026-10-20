# Client upload encoding policy

Client encoding reduces transfer time. The server still detects, decodes, and
re-encodes every upload, and its [storage selection policy](upload-encoding.md)
continues to choose the final image independently of the client.

## Browser policy

Small JPEG and WebP inputs at or below **1 MiB** are sent unchanged. PNG inputs,
larger still images, and HEIC inputs enter the preparation path:

1. For PNG, try ordinary lossless WebP. Retain that candidate if it is at or
   below **1 MiB**; otherwise proceed to lossy encoding.
2. Encode lossy WebP at **q90**.
3. If q90 is **strictly larger than 5 MiB**, retry at **q50**.
4. If q50 is **strictly larger than 9 MiB**, retry at **q20**. There are no
   further attempts or automatic dimension reductions in the browser.

Every attempt uses the same decoded source pixels. Each ImageBitmap is closed
on success or failure. Canvas and WASM implementations use the same nominal
quality settings: 0.9/0.5/0.2 for canvas, 90/50/20 for WASM.

A pasted photograph often arrives from the browser as PNG, even if its source
was already lossy. The PNG container is a reason to try lossless compression,
not a reason to retain a large lossless transfer. The 1 MiB test preserves
screenshots and graphics that compress well while allowing pasted photographs
to proceed to q90.

The **5 MiB threshold is a transfer-performance decision**, not the proxy limit.
A q90 result that large is likely to need much stronger server compression to
approach the server's 1 MB target. Sending a smaller q50 candidate avoids
spending upload time on detail unlikely to survive final selection. A q50
result between 5 and 9 MiB is allowed without another attempt.

The initial q90 matches the server's highest lossy candidate. The policy accepts
another q90 generation on the server. It does not pre-emptively lower ordinary
uploads to q80 or try to reproduce every server candidate on the client.

## Selecting upload bytes

The client image budget is **9 MiB** (9 × 1,048,576 bytes), leaving space for
multipart overhead below the API's 10 MiB request limit. These are binary MiB
thresholds; the server's 1 MB and 2 MB storage thresholds are decimal bytes.

- Use a fitting encoded candidate when it saves **at least 10%** of the original
  byte size. Otherwise keep the original, provided it fits the image budget.
- If the original exceeds the budget, accept a fitting candidate even when
  savings are below 10%. Never fall back to an oversized original.
- HEIC requires conversion to a server-supported format, so a fitting encode
  is used even without savings.
- If no permitted version fits, report an error rather than send an upload
  that exceeds the client budget.
- GIFs bypass still-image encoding and are sent byte-for-byte when they fit.
  Oversized GIFs are rejected, preserving animation instead of flattening it.

The browser applies the budget again immediately before starting a request.
Preparation failures become per-image errors in the upload list.

## Android

Android uses the same **q90 → q50 above 5 MiB → q20 above 9 MiB** transfer
sequence, the 9 MiB image budget, and the original-versus-encode savings rule.
Its existing platform behavior remains: API 30+ tries lossless WebP for PNG;
older versions can retain small PNGs directly, and API 25–27 retains JPEG/WebP
inputs to preserve orientation metadata. Android also retains its existing
4096-pixel decoding bound. Animated GIFs pass through unchanged within budget.

## Validation

Vitest covers strict retry thresholds, the savings boundary, mandatory format
conversion, oversized-original fallback, and rejection before sending a request.
Cypress covers real browser decoding/encoding, small lossless PNG preservation,
pasted-photo PNG fallback to q90, large transfers falling back to q50, original
retention, GIF passthrough, malformed inputs, and ImageBitmap cleanup.

Run `npm test -- --run`, `npm run test:component`, `npm run lint`, and
`npm run build`. For Android, run `./gradlew testDebugUnitTest` from `android/`.
