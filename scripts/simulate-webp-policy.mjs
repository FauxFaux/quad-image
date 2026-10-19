#!/usr/bin/env node
// Run after compare-webp.mjs has produced the baseline and missing candidates.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const basePath = path.join(root, 'garbage/webp-near-lossless');
const extraPath = path.join(root, 'garbage/webp-policy-extra');
const output = path.join(root, 'garbage/webp-policy');
const baseline = JSON.parse(
  await readFile(path.join(basePath, 'results.json')),
);
const extra = JSON.parse(await readFile(path.join(extraPath, 'results.json')));
assert.equal(baseline.encoderSha256, extra.encoderSha256, 'Encoder mismatch');
assert.deepEqual(baseline.selected, extra.selected, 'Sample mismatch');
assert.equal(extra.errors.length, 0);
const target = 1_000_000;
const images = baseline.results.map((image) => {
  const addition = extra.results.find((x) => x.id === image.id);
  assert.equal(image.originalBytes, addition.originalBytes);
  return {
    ...image,
    variants: [
      ...image.variants.map((v) => ({ ...v, source: basePath })),
      ...addition.variants.map((v) => ({ ...v, source: extraPath })),
    ],
  };
});
const fidelity = (a, b) => {
  if (a.mode !== b.mode) return a.mode === 'near-lossless' ? -1 : 1;
  return a.mode === 'near-lossless'
    ? b.nearLossless - a.nearLossless
    : b.quality - a.quality;
};
const smallest = (candidates) =>
  [...candidates].sort((a, b) => a.bytes - b.bytes || fidelity(a, b))[0];
// Literal interpretation: biggest fitting candidate, except a smaller NL result
// displaces a lossy winner. Within equally eligible NL results prefer fidelity.
function literal(candidates) {
  const fitting = candidates.filter((v) => v.bytes < target);
  const winner = fitting.length
    ? [...fitting].sort((a, b) => b.bytes - a.bytes || fidelity(a, b))[0]
    : smallest(candidates);
  return winner.mode === 'lossy'
    ? (candidates
        .filter((v) => v.mode === 'near-lossless' && v.bytes <= winner.bytes)
        .sort(fidelity)[0] ?? winner)
    : winner;
}
function ranked(candidates) {
  const fitting = candidates.filter((v) => v.bytes < target);
  return fitting.sort(fidelity)[0] ?? smallest(candidates);
}
function proposedCandidates(bytes, lossy) {
  if (lossy)
    return bytes < target
      ? ['nl40', 'q85', 'q80', 'q60']
      : ['nl40', 'q80', 'q60', 'q50'];
  return bytes < target
    ? ['nl80', 'nl40', 'q90', 'q80']
    : ['nl50', 'q90', 'q80', 'q60'];
}
const policies = [
  { name: 'proposed-biggest', settings: proposedCandidates, select: literal },
  { name: 'proposed-fidelity', settings: proposedCandidates, select: ranked },
  {
    name: 'fixed-90-70-biggest',
    settings: () => ['nl100', 'nl40', 'q90', 'q70'],
    select: literal,
  },
  {
    name: 'fixed-90-80',
    settings: () => ['nl100', 'nl40', 'q90', 'q80'],
    select: ranked,
  },
  {
    name: 'fixed-90-70',
    settings: () => ['nl100', 'nl40', 'q90', 'q70'],
    select: ranked,
  },
  {
    name: 'fixed-80-60',
    settings: () => ['nl100', 'nl40', 'q80', 'q60'],
    select: ranked,
  },
];
const rows = [];
for (const scenario of ['raw-lossless', 'jpeg-size-proxy']) {
  for (const policy of policies) {
    for (const image of images) {
      const inputBytes =
        scenario === 'raw-lossless' ? image.originalBytes : image.jpegBytes;
      const labels = policy.settings(inputBytes, scenario !== 'raw-lossless');
      const candidates = labels.map((label) => {
        const found = image.variants.find((v) => v.label === label);
        assert(found, `Missing ${image.id}/${label}`);
        return found;
      });
      const selected = policy.select(candidates);
      rows.push({
        scenario,
        policy: policy.name,
        id: image.id,
        inputBytes,
        attempts: labels,
        ...selected,
        underTarget: selected.bytes < target,
        estimatedEncodeMs: candidates.reduce((sum, v) => sum + v.encodeMs, 0),
      });
    }
  }
  // Four-attempt maximum: stop as soon as a fidelity-ordered candidate fits.
  for (const image of images) {
    const attempts = [];
    let selected;
    for (const label of ['nl100', 'nl40', 'q90']) {
      const candidate = image.variants.find((v) => v.label === label);
      attempts.push(candidate);
      if (candidate.bytes < target) {
        selected = candidate;
        break;
      }
    }
    if (!selected) {
      const label = 'q80';
      attempts.push(image.variants.find((v) => v.label === label));
      selected = ranked(attempts);
    }
    rows.push({
      scenario,
      policy: 'adaptive-up-to-four',
      id: image.id,
      inputBytes:
        scenario === 'raw-lossless' ? image.originalBytes : image.jpegBytes,
      attempts: attempts.map((v) => v.label),
      ...selected,
      underTarget: selected.bytes < target,
      estimatedEncodeMs: attempts.reduce((sum, v) => sum + v.encodeMs, 0),
    });
  }
}
const summaries = [
  ...new Set(rows.map((r) => `${r.scenario}/${r.policy}`)),
].map((key) => {
  const group = rows.filter((r) => `${r.scenario}/${r.policy}` === key);
  const selections = {};
  for (const row of group)
    selections[row.label] = (selections[row.label] ?? 0) + 1;
  return {
    scenario: group[0].scenario,
    policy: group[0].policy,
    underTarget: group.filter((r) => r.underTarget).length,
    totalBytes: group.reduce((sum, r) => sum + r.bytes, 0),
    largestBytes: Math.max(...group.map((r) => r.bytes)),
    exact: group.filter((r) => r.nearLossless === 100).length,
    nearLossless: group.filter(
      (r) => r.mode === 'near-lossless' && r.nearLossless !== 100,
    ).length,
    lossy: group.filter((r) => r.mode === 'lossy').length,
    attempts: group.reduce((sum, r) => sum + r.attempts.length, 0),
    estimatedEncodeSeconds:
      group.reduce((sum, r) => sum + r.estimatedEncodeMs, 0) / 1000,
    selections,
  };
});
const settingsEquivalent = images.every(
  (image) =>
    image.variants.find((v) => v.label === 'nl50').bytes ===
    image.variants.find((v) => v.label === 'nl40').bytes,
);
await mkdir(output, { recursive: true });
await writeFile(
  path.join(output, 'results.json'),
  JSON.stringify(
    {
      target,
      assumptions: [
        'JPEG scenario uses listed JPEG byte sizes with the lossless reference pixels, not actual original JPEG uploads.',
        'The unspecified fourth large-lossless attempt is q60; the same branch is used above 5 MB.',
        'Fresh encoder timings from separate runs are estimates, not concurrent latency benchmarks.',
      ],
      settingsEquivalent,
      summaries,
      rows,
    },
    null,
    2,
  ),
);
const columns = [
  'scenario',
  'policy',
  'id',
  'inputBytes',
  'label',
  'bytes',
  'underTarget',
  'psnr',
  'rgbMaxError',
  'alphaMaxError',
  'estimatedEncodeMs',
];
await writeFile(
  path.join(output, 'results.csv'),
  [
    columns.join(','),
    ...rows.map((row) => columns.map((c) => row[c] ?? '').join(',')),
  ].join('\n') + '\n',
);
const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('"', '&quot;');
const href = (row) =>
  escape(path.relative(output, path.join(row.source, row.id, row.filename)));
const table = summaries
  .map(
    (s) =>
      `<tr><td>${s.scenario}</td><td>${s.policy}</td><td>${s.underTarget}/16</td><td>${(s.totalBytes / 1e6).toFixed(3)}</td><td>${s.exact}/${s.nearLossless}/${s.lossy}</td><td>${s.attempts}</td></tr>`,
  )
  .join('');
const cards = images
  .map(
    (image) =>
      `<article><h2>${image.id}</h2><img loading="lazy" src="${escape(path.relative(output, path.join(basePath, image.id, 'preview.png')))}"><p>Stored lossless ${(image.originalBytes / 1e6).toFixed(3)} MB; JPEG size proxy ${(image.jpegBytes / 1e6).toFixed(3)} MB</p><table><tr><th>Scenario</th><th>Policy</th><th>Attempts</th><th>Selected</th><th>Bytes</th><th>PSNR</th></tr>${rows
        .filter((r) => r.id === image.id)
        .map(
          (r) =>
            `<tr><td>${r.scenario}</td><td>${r.policy}</td><td>${r.attempts.join(', ')}</td><td><a href="${href(r)}">${r.label}</a></td><td>${r.bytes.toLocaleString()}</td><td>${r.psnr?.toFixed(2) ?? '∞'}</td></tr>`,
        )
        .join('')}</table></article>`,
  )
  .join('');
await writeFile(
  path.join(output, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>WebP selection policies</title><style>body{font:16px system-ui;margin:24px;background:#17191d;color:#eee}a{color:#9cf}td,th{padding:6px 12px;text-align:right;border-bottom:1px solid #555}table{border-collapse:collapse}article{margin:32px 0}img{max-width:320px}</style><h1>WebP selection policies</h1><p>Target: strictly below 1,000,000 bytes. Same 16-image sample. JPEG size proxies affect branch selection only; JPEG input pixels are unavailable. Proposed large-lossless branch uses q60 as the fourth setting, including files above 5 MB. Fidelity order prefers higher near-lossless levels, then higher lossy quality. No fit: smallest candidate. These rankings express a policy, not a guarantee of perceptual quality.</p><p>fixed-90-80: nl100, nl40, q90, q80. fixed-90-70: nl100, nl40, q90, q70. fixed-80-60: nl100, nl40, q80, q60. Adaptive: nl100 → nl40 → q90, stopping when one fits; fourth setting q80. If no candidate fits, choose the smallest. <a href="results.json">JSON</a> · <a href="results.csv">CSV</a> · <a href="../webp-near-lossless/index.html">Visual comparison</a></p><table><tr><th>Scenario</th><th>Policy</th><th>Under cap</th><th>Total MB</th><th>Exact/NL/lossy</th><th>Attempts</th></tr>${table}</table>${cards}`,
);
console.table(
  summaries.map((s) => ({
    scenario: s.scenario,
    policy: s.policy,
    under: s.underTarget,
    MB: (s.totalBytes / 1e6).toFixed(3),
    exact: s.exact,
    near: s.nearLossless,
    lossy: s.lossy,
    attempts: s.attempts,
  })),
);
console.log(
  `nl50 and nl40 sizes identical on all images: ${settingsEquivalent}`,
);
console.log(path.join(output, 'index.html'));
