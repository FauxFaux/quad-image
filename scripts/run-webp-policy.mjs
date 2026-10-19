#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import {
  readFile,
  readdir,
  mkdir,
  copyFile,
  writeFile,
  stat,
} from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, metrics } from './webp-experiment-utils.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const options = {
  input: 'e',
  output: 'garbage/webp-policy-all',
  target: 1_000_000,
  secondPassThreshold: 2_000_000,
};
for (let i = 2; i < process.argv.length; i++) {
  const option = process.argv[i];
  if (option === '--help') {
    console.log(
      'node scripts/run-webp-policy.mjs [--input e] [--output garbage/webp-policy-all] [--target 1000000] [--second-pass-threshold 2000000]',
    );
    process.exit(0);
  }
  const key =
    option === '--second-pass-threshold'
      ? 'secondPassThreshold'
      : option.slice(2);
  if (!option.startsWith('--') || !(key in options) || !process.argv[i + 1])
    throw new Error(`Unknown/incomplete option ${option}`);
  options[key] = ['target', 'secondPassThreshold'].includes(key)
    ? Number(process.argv[++i])
    : process.argv[++i];
}
if (
  !Number.isSafeInteger(options.target) ||
  !Number.isSafeInteger(options.secondPassThreshold) ||
  options.target < 1 ||
  options.secondPassThreshold < options.target
)
  throw new Error('Invalid target or threshold');
const input = path.resolve(root, options.input),
  output = path.resolve(root, options.output);
if (
  output === input ||
  output.startsWith(input + path.sep) ||
  input.startsWith(output + path.sep)
)
  throw new Error('Input and output must be separate');
const wasm = await readFile(path.join(root, 'web/assets/webp-encode.wasm'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const encoderSha256 = hash(wasm);
const variant = (label) =>
  label.startsWith('nl')
    ? {
        label,
        mode: 'near-lossless',
        nearLossless: Number(label.slice(2)),
        quality: null,
        filename: `${label}.webp`,
      }
    : {
        label,
        mode: 'lossy',
        quality: Number(label.slice(1)),
        nearLossless: null,
        filename: `${label}.webp`,
      };
const firstPass = ['nl100', 'nl40', 'q90', 'q70'].map(variant);
const secondPass = ['q50', 'q35', 'q20', 'q5'].map(variant);
const policy = {
  target: options.target,
  secondPassThreshold: options.secondPassThreshold,
  firstPass,
  secondPass,
  workers: 4,
};
const fingerprint = hash(JSON.stringify({ encoderSha256, policy }));
const workers = Array.from(
  { length: 4 },
  () =>
    new Worker(new URL('./webp-policy-worker.mjs', import.meta.url), {
      workerData: { wasm },
    }),
);
const workerFailures = new Map();
for (const worker of workers)
  worker.on('error', (error) => workerFailures.set(worker, error));
function encodeOnWorker(worker, task) {
  if (workerFailures.has(worker))
    return Promise.reject(workerFailures.get(worker));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    const onMessage = (result) => {
      cleanup();
      result.error ? reject(new Error(result.error)) : resolve(result);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Encoder worker exited (${code})`));
    };
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    worker.postMessage(task);
  });
}
function select(candidates) {
  const fitting = candidates.filter((v) => v.bytes < options.target);
  return (
    fitting.sort((a, b) =>
      a.mode !== b.mode
        ? a.mode === 'near-lossless'
          ? -1
          : 1
        : a.mode === 'near-lossless'
          ? b.nearLossless - a.nearLossless
          : b.quality - a.quality,
    )[0] ?? [...candidates].sort((a, b) => a.bytes - b.bytes)[0]
  );
}
const jpegSizes = new Map();
for (const line of (
  await readFile(path.join(root, 'jpg-sizes.lst'), 'utf8')
).split('\n')) {
  const match = line.match(
    /^\S+\s+([\d,]+)\s+\d{4}\/\d{2}\/\d{2}\s+\S+\s+e\/([^/]+)\.jpg\s*$/,
  );
  if (match) jpegSizes.set(match[2], Number(match[1].replaceAll(',', '')));
}
const files = (await readdir(input))
  .filter((f) => /\.(webp|jpe?g|png)$/i.test(f) && !/\.thumb\./i.test(f))
  .sort();
await mkdir(output, { recursive: true });
const results = [],
  errors = [];
const started = performance.now();
const imageMagick = (await run('magick', ['-version'])).stdout.split('\n')[0];
async function checkpoint() {
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(
      {
        options,
        policy,
        encoderSha256,
        imageMagick,
        node: process.version,
        files,
        elapsedMs: performance.now() - started,
        results,
        errors,
      },
      null,
      2,
    ) + '\n',
  );
}
try {
  for (const [index, filename] of files.entries()) {
    console.log(`[${index + 1}/${files.length}] ${filename}`);
    const id = filename.endsWith('.raw.webp')
      ? filename.slice(0, -9)
      : filename;
    const directory = path.join(output, id);
    try {
      const source = path.join(input, filename);
      const sourceBytes = await readFile(source),
        sourceSha256 = hash(sourceBytes);
      try {
        const saved = JSON.parse(
          await readFile(path.join(directory, 'result.json')),
        );
        if (
          saved.sourceSha256 === sourceSha256 &&
          saved.fingerprint === fingerprint &&
          saved.filename === filename
        ) {
          const sizes = await Promise.all(
            saved.variants.map(
              async (v) => (await stat(path.join(directory, v.filename))).size,
            ),
          );
          if (
            sizes.every((size, i) => size === saved.variants[i].bytes) &&
            (await stat(path.join(directory, 'selected.webp'))).size ===
              saved.selected.bytes
          ) {
            results.push({ ...saved, reused: true });
            console.log(
              `  reused ${saved.selected.label}: ${saved.selected.bytes} bytes`,
            );
            await checkpoint();
            continue;
          }
        }
      } catch {
        /* Missing/incomplete checkpoint: recompute this image. */
      }
      const { stdout } = await run('magick', [
        'identify',
        '-format',
        '%w %h %n %m',
        source,
      ]);
      const [w, h, n, format] = stdout.trim().split(/\s+/);
      const width = Number(w),
        height = Number(h);
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1 ||
        Number(n) !== 1
      )
        throw new Error('Invalid dimensions or animated source');
      const rgba = await decode(source, width, height);
      const shared = new SharedArrayBuffer(rgba.length);
      new Uint8Array(shared).set(rgba);
      await mkdir(directory, { recursive: true });
      const originalFilename = `original.${format.toLowerCase() === 'jpeg' ? 'jpg' : format.toLowerCase()}`;
      await copyFile(source, path.join(directory, originalFilename));
      await run('magick', [
        source,
        '-thumbnail',
        '320x200>',
        path.join(directory, 'preview.png'),
      ]);
      const candidates = [];
      async function pass(settings) {
        const passStarted = performance.now();
        const encoded = await Promise.allSettled(
          settings.map((variant, i) =>
            encodeOnWorker(workers[i], {
              rgba: shared,
              width,
              height,
              variant,
            }),
          ),
        );
        const failed = encoded.find((result) => result.status === 'rejected');
        if (failed) throw failed.reason;
        const wallMs = performance.now() - passStarted;
        for (const [i, outcome] of encoded.entries()) {
          const { bytes, encodeMs } = outcome.value;
          const target = path.join(directory, settings[i].filename);
          await writeFile(target, bytes);
          const comparison = metrics(rgba, await decode(target, width, height));
          candidates.push({
            ...settings[i],
            bytes: bytes.length,
            encodeMs,
            ...comparison,
          });
        }
        return wallMs;
      }
      const firstPassMs = await pass(firstPass);
      const firstPassMinimum = Math.min(...candidates.map((v) => v.bytes));
      const secondPassRan = firstPassMinimum > options.secondPassThreshold;
      const secondPassMs = secondPassRan ? await pass(secondPass) : 0;
      const selected = select(candidates);
      await copyFile(
        path.join(directory, selected.filename),
        path.join(directory, 'selected.webp'),
      );
      const baseId = filename.replace(/\.raw\.webp$|\.(jpe?g|png|webp)$/i, '');
      const result = {
        id,
        filename,
        sourceSha256,
        fingerprint,
        width,
        height,
        format,
        originalFilename,
        originalBytes: sourceBytes.length,
        jpegBytes: jpegSizes.get(baseId) ?? null,
        variants: candidates,
        firstPassMinimum,
        firstPassMs,
        secondPassRan,
        secondPassMs,
        selected,
      };
      await writeFile(
        path.join(directory, 'result.json'),
        JSON.stringify(result, null, 2) + '\n',
      );
      results.push(result);
      console.log(
        `  ${selected.label}: ${selected.bytes.toLocaleString()} bytes; first minimum ${firstPassMinimum.toLocaleString()}; second pass ${secondPassRan}; PSNR ${selected.psnr?.toFixed(2) ?? 'infinite'}`,
      );
    } catch (error) {
      errors.push({ filename, error: String(error) });
      console.error(`${filename}: ${error}`);
    }
    await checkpoint();
  }
} finally {
  await Promise.all(workers.map((worker) => worker.terminate()));
}
await checkpoint();
// Rendering is separated so the report can also be refreshed from checkpoints.
const { renderPolicyReport } = await import('./webp-policy-report.mjs');
await renderPolicyReport(output);
if (errors.length) process.exitCode = 1;
