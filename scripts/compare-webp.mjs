#!/usr/bin/env node
// No npm dependencies: Node's WASM runtime encodes; ImageMagick decodes/previews.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import {
  readFile,
  readdir,
  mkdir,
  copyFile,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const options = {
  input: 'e',
  sizes: 'jpg-sizes.lst',
  output: 'garbage/webp-comparison',
  count: 16,
  seed: 20261014,
  qualities: [50, 65, 75, 80, 85, 90, 95],
  nearLossless: [],
  all: false,
};
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--help') {
    console.log(
      'Usage: node scripts/compare-webp.mjs [--all | --count 16] [--seed 20261014] [--qualities 50,65,75,80,85,90,95] [--near-lossless 0,20,40,60,80,100] [--ids id1,id2] [--input e] [--sizes jpg-sizes.lst] [--output garbage/webp-comparison]',
    );
    process.exit(0);
  }
  if (arg === '--all') {
    options.all = true;
    continue;
  }
  const key = arg === '--near-lossless' ? 'nearLossless' : arg.slice(2);
  if (
    !arg.startsWith('--') ||
    ![
      'input',
      'sizes',
      'output',
      'count',
      'seed',
      'qualities',
      'nearLossless',
      'ids',
    ].includes(key) ||
    process.argv[i + 1] === undefined
  )
    throw new Error(`Unknown or incomplete option: ${arg}`);
  const value = process.argv[++i];
  options[key] = ['count', 'seed'].includes(key)
    ? Number(value)
    : ['qualities', 'nearLossless'].includes(key)
      ? value.split(',').map(Number)
      : value;
}
if (
  !Number.isInteger(options.count) ||
  options.count < 1 ||
  !Number.isSafeInteger(options.seed) ||
  !options.qualities.length ||
  options.qualities.some((q) => !Number.isFinite(q) || q < 0 || q > 100)
)
  throw new Error(
    'Count must be positive, seed an integer, and qualities between 0 and 100.',
  );
options.qualities = [...new Set(options.qualities)].sort((a, b) => a - b);
if (options.nearLossless.some((n) => !Number.isInteger(n) || n < 0 || n > 100))
  throw new Error('Near-lossless levels must be integers between 0 and 100.');
options.nearLossless = [...new Set(options.nearLossless)].sort((a, b) => a - b);
const variants = [
  ...options.qualities.map((quality) => ({
    mode: 'lossy',
    quality,
    nearLossless: null,
    label: `q${quality}`,
    filename: `q${quality}.webp`,
  })),
  ...options.nearLossless.map((nearLossless) => ({
    mode: 'near-lossless',
    quality: null,
    nearLossless,
    label: `nl${nearLossless}`,
    filename: `nl${nearLossless}.webp`,
  })),
];
const input = path.resolve(root, options.input);
const output = path.resolve(root, options.output);
if (
  output === input ||
  input.startsWith(output + path.sep) ||
  output.startsWith(input + path.sep)
)
  throw new Error('Output and input directories must be separate.');
const jpegSizes = new Map();
for (const line of (
  await readFile(path.resolve(root, options.sizes), 'utf8')
).split('\n')) {
  const match = line.match(
    /^\S+\s+([\d,]+)\s+\d{4}\/\d{2}\/\d{2}\s+\S+\s+e\/([^/]+)\.(jpg|png)\s*$/,
  );
  if (match) {
    if (match[3] !== 'jpg') continue;
    if (jpegSizes.has(match[2]))
      throw new Error(`Duplicate JPEG ID: ${match[2]}`);
    jpegSizes.set(match[2], Number(match[1].replaceAll(',', '')));
  } else if (line.trim())
    throw new Error(`Unrecognized JPEG size entry: ${line}`);
}
let files = (await readdir(input))
  .filter((f) => f.endsWith('.raw.webp'))
  .sort();
const available = files.length;
if (options.ids) {
  const ids = options.ids.split(',');
  const known = new Set(files);
  files = [...new Set(ids)].map((id) => `${id}.raw.webp`);
  for (const file of files)
    if (!known.has(file)) throw new Error(`Unknown source: ${file}`);
} else if (!options.all) {
  let state = options.seed >>> 0;
  // Seeded Fisher-Yates selection, stable across filesystem enumeration orders.
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = files.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [files[i], files[j]] = [files[j], files[i]];
  }
  files = files.slice(0, options.count);
}
if (!files.length) throw new Error('No .raw.webp inputs found.');
const wasm = await readFile(path.join(root, 'web/assets/webp-encode.wasm'));
const { instance } = await WebAssembly.instantiate(wasm, {
  env: { emscripten_notify_memory_growth() {} },
});
const encoder = instance.exports;
encoder.emscripten_stack_init();
encoder.__set_stack_limits(
  encoder.emscripten_stack_get_base(),
  encoder.emscripten_stack_get_end(),
);
encoder._initialize();
if (
  options.nearLossless.length &&
  typeof encoder.WebPEncodeRGBAWithNearLossless !== 'function'
)
  throw new Error('WASM does not expose near-lossless encoding');
function encode(rgba, width, height, variant) {
  const pointer = encoder.malloc(rgba.length);
  const slot = encoder.malloc(4);
  let encoded = 0;
  try {
    if (!pointer || !slot) throw new Error('WASM allocation failed');
    new Uint8Array(encoder.memory.buffer, pointer, rgba.length).set(rgba);
    new DataView(encoder.memory.buffer).setUint32(slot, 0, true);
    const entryPoint =
      variant.mode === 'lossy'
        ? encoder.WebPEncodeRGBA
        : encoder.WebPEncodeRGBAWithNearLossless;
    const size = entryPoint(
      pointer,
      width,
      height,
      width * 4,
      variant.quality ?? variant.nearLossless,
      slot,
    );
    encoded = new DataView(encoder.memory.buffer).getUint32(slot, true);
    if (!size || !encoded) throw new Error('WASM encode failed');
    return Buffer.from(new Uint8Array(encoder.memory.buffer, encoded, size));
  } finally {
    if (encoded) encoder.WebPFree(encoded);
    if (pointer) encoder.free(pointer);
    if (slot) encoder.free(slot);
  }
}
async function decode(file, width, height) {
  const { stdout } = await run(
    'magick',
    [file, '-colorspace', 'sRGB', '-depth', '8', 'rgba:-'],
    { encoding: 'buffer', maxBuffer: width * height * 4 + 1024 * 1024 },
  );
  if (stdout.length !== width * height * 4)
    throw new Error('Unexpected decoded pixel count');
  return stdout;
}
function metrics(original, decoded) {
  let squared = 0,
    alphaMaxError = 0,
    rgbMaxError = 0,
    rgbChangedPixels = 0;
  // Composite RGB over white so fully transparent hidden RGB does not affect PSNR.
  for (let i = 0; i < original.length; i += 4) {
    alphaMaxError = Math.max(
      alphaMaxError,
      Math.abs(original[i + 3] - decoded[i + 3]),
    );
    let changed = false;
    for (let c = 0; c < 3; c++) {
      const error = Math.abs(original[i + c] - decoded[i + c]);
      rgbMaxError = Math.max(rgbMaxError, error);
      changed ||= error !== 0;
      const a =
        (original[i + c] * original[i + 3]) / 255 + 255 - original[i + 3];
      const b = (decoded[i + c] * decoded[i + 3]) / 255 + 255 - decoded[i + 3];
      squared += (a - b) ** 2;
    }
    if (changed) rgbChangedPixels++;
  }
  const mse = squared / ((original.length / 4) * 3);
  return {
    psnr: mse === 0 ? null : 10 * Math.log10(255 ** 2 / mse),
    alphaMaxError,
    rgbMaxError,
    rgbChangedPixels,
  };
}
await mkdir(output, { recursive: true });
const results = [],
  errors = [];
for (const [index, file] of files.entries()) {
  const id = file.slice(0, -'.raw.webp'.length);
  console.log(`[${index + 1}/${files.length}] ${id}`);
  try {
    const source = path.join(input, file);
    const bytes = await readFile(source);
    // Require a still, lossless WebP; do not silently benchmark one animation frame.
    if (
      bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WEBP'
    )
      throw new Error('Not a WebP');
    let lossless = false;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const tag = bytes.toString('ascii', offset, offset + 4);
      if (tag === 'ANIM' || tag === 'ANMF')
        throw new Error('Animated source unsupported');
      if (tag === 'VP8L') lossless = true;
      const size = bytes.readUInt32LE(offset + 4);
      offset += 8 + size + (size % 2);
    }
    if (!lossless) throw new Error('Source is not lossless');
    const { stdout } = await run('magick', [
      'identify',
      '-format',
      '%w %h %n',
      source,
    ]);
    const [width, height, frames] = stdout.trim().split(/\s+/).map(Number);
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      frames !== 1
    )
      throw new Error('Invalid dimensions or multiple frames');
    const rgba = await decode(source, width, height);
    const directory = path.join(output, id);
    await mkdir(directory, { recursive: true });
    await copyFile(source, path.join(directory, 'original.webp'));
    await run('magick', [
      source,
      '-thumbnail',
      '320x200>',
      path.join(directory, 'preview.png'),
    ]);
    const result = {
      id,
      width,
      height,
      originalBytes: bytes.length,
      jpegBytes: jpegSizes.get(id) ?? null,
      variants: [],
    };
    for (const variant of variants) {
      const started = performance.now();
      const encoded = encode(rgba, width, height, variant);
      const encodeMs = performance.now() - started;
      const { filename } = variant;
      const target = path.join(directory, filename);
      await writeFile(target, encoded);
      const comparison = metrics(rgba, await decode(target, width, height));
      result.variants.push({
        ...variant,
        bytes: encoded.length,
        encodeMs,
        jpegRatio: result.jpegBytes ? encoded.length / result.jpegBytes : null,
        originalRatio: encoded.length / bytes.length,
        ...comparison,
      });
      console.log(
        `  ${variant.label}: ${encoded.length.toLocaleString()} bytes; ${result.jpegBytes ? ((encoded.length / result.jpegBytes) * 100).toFixed(1) + '% of JPEG' : 'JPEG size missing'}; PSNR ${comparison.psnr?.toFixed(2) ?? 'infinite'} dB`,
      );
    }
    results.push(result);
  } catch (error) {
    errors.push({ id, error: String(error) });
    console.error(`${id}: ${error}`);
  }
}
const summaries = variants.map((variant) => {
  const matched = results.filter((r) => r.jpegBytes !== null);
  const measured = matched.map((r) =>
    r.variants.find((v) => v.label === variant.label),
  );
  const ratios = measured.map((v) => v.jpegRatio).sort((a, b) => a - b);
  return {
    ...variant,
    matched: matched.length,
    jpegBytes: matched.reduce((sum, r) => sum + r.jpegBytes, 0),
    webpBytes: measured.reduce((sum, v) => sum + v.bytes, 0),
    medianJpegRatio: ratios.length
      ? (ratios[Math.floor((ratios.length - 1) / 2)] +
          ratios[Math.floor(ratios.length / 2)]) /
        2
      : null,
    smallerThanJpeg: measured.filter((v) => v.jpegRatio < 1).length,
  };
});
const metadata = {
  options,
  available,
  selected: files,
  encoderSha256: createHash('sha256').update(wasm).digest('hex'),
  node: process.version,
  imageMagick: (await run('magick', ['-version'])).stdout.split('\n')[0],
  results,
  summaries,
  errors,
};
await writeFile(
  path.join(output, 'results.json'),
  JSON.stringify(metadata, null, 2) + '\n',
);
const columns = [
  'id',
  'width',
  'height',
  'originalBytes',
  'jpegBytes',
  'mode',
  'label',
  'quality',
  'nearLossless',
  'bytes',
  'jpegRatio',
  'originalRatio',
  'psnr',
  'alphaMaxError',
  'rgbMaxError',
  'rgbChangedPixels',
  'encodeMs',
];
await writeFile(
  path.join(output, 'results.csv'),
  [
    columns.join(','),
    ...results.flatMap((r) =>
      r.variants.map((v) => columns.map((k) => v[k] ?? r[k] ?? '').join(',')),
    ),
  ].join('\n') + '\n',
);
const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const size = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const ratio = (value) =>
  value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
const representativeQuality = options.qualities.reduce((a, b) =>
  Math.abs(b - 75) < Math.abs(a - 75) ? b : a,
);
const ranked = results
  .filter((r) => r.jpegBytes)
  .sort(
    (a, b) =>
      a.variants.find((v) => v.quality === representativeQuality).jpegRatio -
      b.variants.find((v) => v.quality === representativeQuality).jpegRatio,
  );
const highlights = [...new Set([...ranked.slice(0, 3), ...ranked.slice(-3)])];
const summaryRows = summaries
  .map(
    (s) =>
      `<tr><td>${s.label}</td><td>${s.matched}</td><td>${size(s.webpBytes)}</td><td>${s.jpegBytes ? ratio(s.webpBytes / s.jpegBytes) : 'n/a'}</td><td>${ratio(s.medianJpegRatio)}</td><td>${s.smallerThanJpeg}/${s.matched}</td></tr>`,
  )
  .join('');
const cards = results
  .map(
    (r) =>
      `<article id="${escape(r.id)}"><h2>${escape(r.id)} ${highlights.includes(r) ? '★' : ''}</h2><p>${r.width} × ${r.height} · Lossless ${size(r.originalBytes)} · JPEG ${r.jpegBytes === null ? 'unlisted' : size(r.jpegBytes)}</p><table><thead><tr><th>Mode / setting</th><th>WebP</th><th>% JPEG</th><th>% lossless</th><th>RGB PSNR</th><th>Max RGB error</th><th>RGB pixels changed</th><th>Encode time</th></tr></thead><tbody>${r.variants.map((v) => `<tr><td><a href="${escape(r.id)}/${v.filename}">${v.label}</a></td><td>${size(v.bytes)}</td><td>${ratio(v.jpegRatio)}</td><td>${ratio(v.originalRatio)}</td><td>${v.psnr?.toFixed(2) ?? '∞'} dB</td><td>${v.rgbMaxError}</td><td>${((v.rgbChangedPixels / (r.width * r.height)) * 100).toFixed(2)}%</td><td>${(v.encodeMs / 1000).toFixed(2)} s</td></tr>`).join('')}</tbody></table><p><label>Encoding <select class="quality">${r.variants.map((v) => `<option value="${escape(r.id)}/${v.filename}" ${v.quality === representativeQuality ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label> <label><input type="checkbox" class="native"> Actual pixels (scroll to inspect)</label> <a href="${escape(r.id)}/original.webp">Open original</a></p><div class="viewport"><div class="comparison" style="aspect-ratio:${r.width}/${r.height}" data-width="${r.width}" data-height="${r.height}"><img loading="lazy" class="encoded" src="${escape(r.id)}/q${representativeQuality}.webp"><div class="overlay"><img loading="lazy" src="${escape(r.id)}/original.webp"></div><div class="divider"></div><span class="left">Lossless</span><span class="right">Encoded</span></div></div><label>Comparison split <input class="split" type="range" min="0" max="100" value="50"></label></article>`,
  )
  .join('');
await writeFile(
  path.join(output, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>WASM WebP comparison</title><style>
body{font:16px system-ui;margin:24px;background:#17191d;color:#eee}a{color:#9cf}table{border-collapse:collapse}td,th{padding:6px 14px;text-align:right;border-bottom:1px solid #555}article{margin:32px 0;padding:20px;background:#23262c}select,input{font:inherit}input.split{width:65%;vertical-align:middle}.viewport{max-height:80vh;overflow:auto;background:repeating-conic-gradient(#ddd 0% 25%,#fff 0% 50%) 0/20px 20px}.comparison{position:relative;width:100%;--split:50%}.comparison img{position:absolute;inset:0;width:100%;height:100%}.overlay{position:absolute;inset:0;clip-path:inset(0 calc(100% - var(--split)) 0 0)}.divider{position:absolute;left:var(--split);height:100%;border-left:2px solid #f90}.left,.right{position:absolute;top:8px;background:#000a;padding:6px}.left{left:8px}.right{right:8px}.contacts{display:flex;flex-wrap:wrap;gap:16px}.contacts img{width:240px;height:150px;object-fit:contain}.contacts a{width:240px}.error{color:#faa}
</style><h1>Lossy and near-lossless WebP from the checked-in WASM encoder</h1><p>${results.length}/${files.length} completed, ${available} inputs available. Lossy qualities ${options.qualities.join(', ')}; near-lossless levels ${options.nearLossless.join(', ') || 'none'} (100 = no preprocessing, 0 = strongest). Near-lossless uses the lossless codec after preprocessing, with preset quality 70 and default method 4; its scale is independent of lossy quality. RGB error counts use uncomposited channels, including hidden transparent RGB; seed ${options.seed}. No resizing. JPEG comparisons use listed byte sizes only; JPEG pixels are unavailable. RGB PSNR is measured against the decoded lossless original, composited over white, and is a numerical aid rather than a visual quality verdict. Alpha remains lossless. ImageMagick decodes to sRGB RGBA; this does not reproduce browser color management exactly.</p><p><a href="results.csv">CSV</a> · <a href="results.json">JSON and provenance</a></p><table><thead><tr><th>Mode / setting</th><th>Matched</th><th>Total WebP</th><th>% total JPEG</th><th>Median % JPEG</th><th>Smaller</th></tr></thead><tbody>${summaryRows}</tbody></table><h2>Size extremes at q${representativeQuality}</h2><p>Three smallest and three largest WebP/JPEG ratios. These are size outliers, not automated visual recommendations.</p><div class="contacts">${highlights.map((r) => `<a href="#${escape(r.id)}"><img src="${escape(r.id)}/preview.png"><br>${escape(r.id)} · ${ratio(r.variants.find((v) => v.quality === representativeQuality).jpegRatio)} of JPEG</a>`).join('')}</div><h2>Sample contact sheet</h2><div class="contacts">${results.map((r) => `<a href="#${escape(r.id)}"><img loading="lazy" src="${escape(r.id)}/preview.png"><br>${escape(r.id)}</a>`).join('')}</div>${errors.map((e) => `<p class="error">${escape(e.id)}: ${escape(e.error)}</p>`).join('')}${cards}<script>
for(const article of document.querySelectorAll('article')){const comparison=article.querySelector('.comparison');article.querySelector('.quality').addEventListener('change',event=>{article.querySelector('.encoded').src=event.target.value});article.querySelector('.split').addEventListener('input',event=>{comparison.style.setProperty('--split',event.target.value+'%')});article.querySelector('.native').addEventListener('change',event=>{comparison.style.width=event.target.checked?comparison.dataset.width+'px':'100%';comparison.style.height=event.target.checked?comparison.dataset.height+'px':''})}
</script>`,
);
console.table(
  summaries.map((s) => ({
    setting: s.label,
    matched: s.matched,
    'total % JPEG': s.jpegBytes ? ratio(s.webpBytes / s.jpegBytes) : 'n/a',
    'median % JPEG': ratio(s.medianJpegRatio),
    smaller: s.smallerThanJpeg,
  })),
);
console.log(`Report: ${path.join(output, 'index.html')}`);
if (errors.length) process.exitCode = 1;
