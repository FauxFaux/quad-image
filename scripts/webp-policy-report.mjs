import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function renderPolicyReport(output) {
  const report = JSON.parse(await readFile(path.join(output, 'results.json')));
  const { results, errors, options } = report;
  const sum = (items, fn) => items.reduce((total, item) => total + fn(item), 0);
  const selections = {};
  for (const image of results)
    selections[image.selected.label] =
      (selections[image.selected.label] ?? 0) + 1;
  const matched = results.filter((image) => image.jpegBytes !== null);
  const summary = {
    completed: results.length,
    failed: errors.length,
    sourceBytes: sum(results, (image) => image.originalBytes),
    selectedBytes: sum(results, (image) => image.selected.bytes),
    belowTarget: results.filter(
      (image) => image.selected.bytes < options.target,
    ).length,
    atOrAboveTarget: results.filter(
      (image) => image.selected.bytes >= options.target,
    ).length,
    aboveSecondPassThreshold: results.filter(
      (image) => image.selected.bytes > options.secondPassThreshold,
    ).length,
    secondPassImages: results.filter((image) => image.secondPassRan).length,
    encodes: sum(results, (image) => image.variants.length),
    exact: results.filter((image) => image.selected.label === 'nl100').length,
    nearLossless: results.filter((image) => image.selected.label === 'nl40')
      .length,
    lossy: results.filter((image) => image.selected.mode === 'lossy').length,
    largestBytes: results.length
      ? Math.max(...results.map((image) => image.selected.bytes))
      : null,
    nonzeroAlphaError: results
      .filter((image) => image.variants.some((v) => v.alphaMaxError !== 0))
      .map((image) => image.filename),
    losslessRgbError: results
      .filter(
        (image) =>
          image.variants.find((v) => v.label === 'nl100').rgbMaxError !== 0,
      )
      .map((image) => image.filename),
    jpegMatched: matched.length,
    matchedJpegBytes: sum(matched, (image) => image.jpegBytes),
    matchedSelectedBytes: sum(matched, (image) => image.selected.bytes),
    selections,
  };
  await writeFile(
    path.join(output, 'summary.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );
  const columns = [
    'filename',
    'width',
    'height',
    'format',
    'originalBytes',
    'jpegBytes',
    'firstPassMinimum',
    'secondPassRan',
    'label',
    'bytes',
    'psnr',
    'rgbMaxError',
    'rgbChangedPixels',
    'alphaMaxError',
    'firstPassMs',
    'secondPassMs',
  ];
  await writeFile(
    path.join(output, 'selected.csv'),
    [
      columns.join(','),
      ...results.map((image) =>
        columns.map((key) => image.selected[key] ?? image[key] ?? '').join(','),
      ),
    ].join('\n') + '\n',
  );
  const variantColumns = [
    'filename',
    'label',
    'mode',
    'quality',
    'nearLossless',
    'bytes',
    'encodeMs',
    'psnr',
    'rgbMaxError',
    'rgbChangedPixels',
    'alphaMaxError',
  ];
  await writeFile(
    path.join(output, 'variants.csv'),
    [
      variantColumns.join(','),
      ...results.flatMap((image) =>
        image.variants.map((v) =>
          variantColumns
            .map((key) =>
              key === 'filename' ? image.filename : (v[key] ?? ''),
            )
            .join(','),
        ),
      ),
    ].join('\n') + '\n',
  );
  const escape = (value) =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  const size = (bytes) => `${(bytes / 1e6).toFixed(3)} MB`;
  const href = (image, file) =>
    `${encodeURIComponent(image.id)}/${encodeURIComponent(file)}`;
  const biggest = [...results]
    .sort((a, b) => b.selected.bytes - a.selected.bytes)
    .slice(0, 10);
  const highlightIds = new Set(
    [...biggest, ...results.filter((image) => image.secondPassRan)].map(
      (image) => image.id,
    ),
  );
  const settingTable = Object.entries(selections)
    .map(
      ([label, count]) =>
        `<tr><td>${label}</td><td>${count}</td><td>${size(
          sum(
            results.filter((image) => image.selected.label === label),
            (image) => image.selected.bytes,
          ),
        )}</td></tr>`,
    )
    .join('');
  const highlights = results.filter((image) => highlightIds.has(image.id));
  const contacts = (images) =>
    images
      .map(
        (image) =>
          `<a href="#${escape(image.id)}"><img loading="lazy" src="${href(image, 'preview.png')}"><br>${escape(image.filename)}<br>${image.selected.label} · ${size(image.selected.bytes)}${image.secondPassRan ? ' · second pass' : ''}</a>`,
      )
      .join('');
  const cards = results
    .map(
      (image) =>
        `<article id="${escape(image.id)}"><h2>${escape(image.filename)}</h2><p>${image.width} × ${image.height} · ${image.format} input ${size(image.originalBytes)} · listed JPEG ${image.jpegBytes === null ? 'unavailable' : size(image.jpegBytes)} · second pass ${image.secondPassRan ? 'yes' : 'no'} · first-pass minimum ${size(image.firstPassMinimum)}</p><p><strong>Selected: ${image.selected.label}, ${size(image.selected.bytes)}</strong> · <a href="${href(image, 'selected.webp')}">Open selected</a> · <a href="${href(image, image.originalFilename)}">Open reference</a></p><table><tr><th>Setting</th><th>Size</th><th>PSNR</th><th>Max RGB error</th><th>Alpha error</th><th>Encode time</th></tr>${image.variants.map((v) => `<tr class="${v.label === image.selected.label ? 'selected' : ''}"><td><a href="${href(image, v.filename)}">${v.label}</a></td><td>${size(v.bytes)}</td><td>${v.psnr?.toFixed(2) ?? '∞'} dB</td><td>${v.rgbMaxError}</td><td>${v.alphaMaxError}</td><td>${(v.encodeMs / 1000).toFixed(2)} s</td></tr>`).join('')}</table><p><label>Compare reference against <select class="variant">${image.variants.map((v) => `<option value="${href(image, v.filename)}" ${v.label === image.selected.label ? 'selected' : ''}>${v.label} · ${size(v.bytes)}</option>`).join('')}</select></label> <label><input type="checkbox" class="native"> Actual pixels</label></p><div class="viewport"><div class="comparison" style="aspect-ratio:${image.width}/${image.height}" data-width="${image.width}" data-height="${image.height}"><img class="encoded" loading="lazy" src="${href(image, 'selected.webp')}"><div class="overlay"><img loading="lazy" src="${href(image, image.originalFilename)}"></div><div class="divider"></div><span class="left">Reference</span><span class="right">Candidate</span></div></div><label>Split <input class="split" type="range" min="0" max="100" value="50"></label></article>`,
    )
    .join('');
  await writeFile(
    path.join(output, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Two-pass WebP policy — all examples</title><style>
body{font:16px system-ui;margin:24px;background:#17191d;color:#eee}a{color:#9cf}table{border-collapse:collapse}td,th{padding:6px 12px;text-align:right;border-bottom:1px solid #555}article{margin:32px 0;padding:20px;background:#23262c}.selected{background:#345}.contacts{display:flex;flex-wrap:wrap;gap:16px}.contacts a{width:240px}.contacts img{width:240px;height:150px;object-fit:contain}.viewport{max-height:80vh;overflow:auto;background:repeating-conic-gradient(#ddd 0% 25%,#fff 0% 50%) 0/20px 20px}.comparison{position:relative;width:100%;--split:50%}.comparison img{position:absolute;inset:0;width:100%;height:100%}.overlay{position:absolute;inset:0;clip-path:inset(0 calc(100% - var(--split)) 0 0)}.divider{position:absolute;left:var(--split);height:100%;border-left:2px solid #f90}.left,.right{position:absolute;top:8px;background:#000a;padding:6px}.left{left:8px}.right{right:8px}.split{width:65%}select{font:inherit}.error{color:#faa}
</style><h1>Two-pass WebP policy — all examples</h1><p>${results.length}/${report.files.length} completed; ${errors.length} failures. First pass: nl100, nl40, q90, q70. Second pass: q50, q35, q20, q5, only when the smallest first-pass output is strictly greater than ${size(options.secondPassThreshold)}. Four WASM workers execute each pass in parallel. No resizing. Prefer nl100, then nl40, then the highest lossy quality strictly below ${size(options.target)}; otherwise choose the smallest output across all attempted settings.</p><p><strong>${summary.belowTarget}/${results.length} below target; ${summary.secondPassImages} second passes; ${summary.aboveSecondPassThreshold} still above the second-pass threshold.</strong> Selected total ${size(summary.selectedBytes)}, reference total ${size(summary.sourceBytes)}. ${summary.exact} exact, ${summary.nearLossless} near-lossless, ${summary.lossy} lossy. ${summary.encodes} encodes.</p><p>Reference files are the actual available example bytes. The raw WebPs do not establish their original upload format or browser preprocessing history. JPEG counterparts in the size list are byte baselines only. Any actual JPEG input in the folder is a separate test from its raw counterpart; thumbnails are excluded. ImageMagick decodes to sRGB RGBA; the checked-in WASM module performs all measured encodes. PSNR is RGB composited over white, and uncomposited channel errors include hidden transparent RGB. Metrics aid inspection; selection uses setting preference and size. Per-encode times are measured under four-way contention and are not comparable to previous sequential benchmarks.</p><p><a href="selected.csv">Selected CSV</a> · <a href="variants.csv">All variants CSV</a> · <a href="summary.json">Summary JSON</a> · <a href="results.json">Results and provenance</a></p><table><tr><th>Selected setting</th><th>Images</th><th>Total size</th></tr>${settingTable}</table><h2>Largest outputs and second-pass cases</h2><div class="contacts">${contacts(highlights)}</div><h2>All examples</h2><div class="contacts">${contacts(results)}</div>${errors.map((error) => `<p class="error">${escape(error.filename)}: ${escape(error.error)}</p>`).join('')}${cards}<script>
for(const article of document.querySelectorAll('article')){const comparison=article.querySelector('.comparison');article.querySelector('.variant').addEventListener('change',event=>article.querySelector('.encoded').src=event.target.value);article.querySelector('.split').addEventListener('input',event=>comparison.style.setProperty('--split',event.target.value+'%'));article.querySelector('.native').addEventListener('change',event=>{comparison.style.width=event.target.checked?comparison.dataset.width+'px':'100%';comparison.style.height=event.target.checked?comparison.dataset.height+'px':''})}
</script>`,
  );
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Report: ${path.join(output, 'index.html')}`);
  return summary;
}
