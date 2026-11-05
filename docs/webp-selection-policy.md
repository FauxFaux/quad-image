# Selecting encodes for a 1 MB target

The [server upload encoding policy](upload-encoding.md) defines the production
candidate settings, parallel passes, thresholds, and failure behavior. The
principles below explain the selection tradeoffs.

## Prefer fidelity within a soft target

The target is strictly less than **1,000,000 bytes**. Among candidates that fit,
prefer ordinary lossless (nl100) when attempted, then the highest lossy quality
(q90, q80, q70, followed by second-pass settings). If none fits, select the
smallest actual output.

This expresses a preservation preference under a size target. It does not
minimize average storage below that target or guarantee a hard cap. A hard cap
would require further encoding attempts, resizing, or an explicit rejection rule.

## Compare actual candidates

- **Keep ordinary lossless for eligible sources.** Lossy encoding can produce
  larger files than ordinary lossless. Compare actual outputs. Skip the lossless
  attempt for lossy WebP and JPEG inputs above 1,000,000 bytes to avoid expensive
  attempts unlikely to fit the target.
- **Rank fidelity explicitly.** Output size does not establish visual quality.
  Prefer settings according to the preservation policy, rather than selecting
  the largest fitting output. Quality settings do not guarantee monotonic RGB
  PSNR or perceived quality.
- **Account for latency.** The upload policy drops nl40 in favor of q80. The
  production log sample showed occasional nl40 wins, but substantially longer
  completion times than lossy encoding; see the upload policy for measurements.
- **Decode and re-encode uploads.** Incoming size does not bound the size of a
  valid server-encoded output. The server contract requires validation and
  re-encoding before persistence.
- **Distinguish a target from minimum storage.** Preferring fidelity can retain
  an ordinary lossless result even when a lossy candidate is substantially
  smaller.
  Any additional storage-versus-fidelity tradeoff needs an explicit policy.

## Evaluate changes

Use representative images you have permission to process. Keep source images,
identifiers, descriptions, manifests, previews, and per-image measurements
outside the public repository. Inspect visual quality as well as encoded size;
aggregate savings alone do not establish visual equivalence.

Measure CPU cost and latency separately from the number of attempts. Encoding
settings have different costs, and concurrent timings depend on contention.
Use end-to-end measurements when evaluating production concurrency changes.
