# WebP WASM encoder builds

Run `npm run build:webp-wasm` to regenerate `web/assets/webp-encode.wasm`.
The full encoder uses WebAssembly SIMD128, with libwebp's SSE2 and SSE4.1
intrinsics translated by Emscripten. The final link also needs `-msimd128`.
It requires a WASM SIMD-capable runtime.

Run `npm run build:webp-wasm:lossless` to regenerate the separate, scalar,
size-optimized lossless encoder. Both commands use libwebp v1.6.0 and
Emscripten 6.0.10, and apply `simd.patch` before building either library.

## Independent alpha quality

The full module additionally exports `WebPEncodeRGBAWithAlphaQuality(rgba,
width, height, stride, quality, alpha_quality, output)`, implemented by
`alpha-quality.c`. It uses libwebp's default lossy preset and RGBA importer,
but sets `WebPConfig.alpha_quality` separately. The return value is the byte
length, and the output pointer must be released with `WebPFree`, just like
`WebPEncodeRGBA`. All failure paths free the picture and memory writer;
the output pointer is cleared before validation.

Alpha quality 100 preserves alpha losslessly. Lower qualities quantize alpha:
30 gives eight levels and 10 gives four. Server thumbnails use 30 for both
colour and alpha; existing browser upload and lossless entry points keep their
original behavior. Rust and TypeScript declarations include the new export.
The full module is now 438,116 bytes; the lossless-only module is unchanged.
Alpha quality 100 preserves the original encoder's output byte for byte.
See `docs/thumbnail-webp.md` for quality tradeoffs and benchmarking instructions.

## Why simply enabling SIMD failed

There are two separate problems in the pinned libwebp version:

1. `cmake/cpu.cmake` stops its Emscripten feature loop at index 2. After AVX2
   was added to the feature list, that means it checks AVX2 and SSE4.1 but
   skips SSE2. Enabling `WEBP_ENABLE_SIMD` reproduces a compile error in
   `enc_sse41.c`: `VP8Transpose_2_4x4_16b` is undeclared because its SSE2
   helper code is disabled.
2. `src/dsp/cpu.c` checks `EMSCRIPTEN` to select the SIMD routines.
   Emscripten removed that legacy macro in 5.0.4; the supported macro is
   `__EMSCRIPTEN__`. Fixing only CMake produces a valid SIMD-containing
   binary that still selects scalar routines, with essentially unchanged
   encoding times.

Upstream fixed these in
[453a18c4](https://github.com/webmproject/libwebp/commit/453a18c42f396dd803345443fb5f70a0b8291d65)
and
[53394835](https://github.com/webmproject/libwebp/commit/5339483509d998936c3f184ec5a95e8c1bb4a5d9).
Our patch adapts the feature-loop fix to allow only SSE2 and SSE4.1, and
backports the macro fix. AVX2 is omitted because v1.6.0's WASM CPU dispatcher
does not select it. No encoder algorithm changes are needed.

## Validation and tradeoffs

The rebuilt full module is 437,447 bytes, versus 267,289 bytes previously.
With Python's default gzip compression, that is 140,711 versus 110,308 bytes.
The separate lossless module remains scalar (57,475 bytes).

Local Node 24/V8 comparisons against the previously committed full encoder
produced byte-identical outputs for 70 combinations of small/odd dimensions,
opaque/translucent pixels, qualities 0/50/75/100, and lossless encoding.
Larger synthetic inputs also matched exactly, including 5120 × 1440 RGBA
buffers requiring memory growth. Timings below are median encoding times from
three runs after warmup, excluding pixel generation and module instantiation:

| Synthetic input | Lossy quality | Scalar | SIMD | Speedup |
| --- | --- | --- | --- | --- |
| 1024 × 768 gradient | 75 | 86.6 ms | 50.2 ms | 1.72× |
| 1024 × 768 patterned pixels | 75 | 151.9 ms | 92.2 ms | 1.65× |
| 1024 × 768 translucent gradient | 75 | 141.8 ms | 88.0 ms | 1.61× |
| 5120 × 1440 patterned pixels | 75 | 1433 ms | 860 ms | 1.67× |

These measurements describe synthetic inputs on one machine. Full-module
lossless timings ranged from 0.90× to 1.11× speedup, so SIMD did not provide a
consistent lossless benefit in these measurements.

`npm run test:component -- --browser chrome --spec tests/web/cypress/image-ops.cy.tsx`
checks browser encoding and decoding, narrow/odd dimensions around SIMD block
boundaries, exact lossless pixel preservation, and large-image allocation with
both lossless entry points. `npm test -- --run`, `npm run lint`, and
`npm run build` also pass (lint reports existing warnings).
