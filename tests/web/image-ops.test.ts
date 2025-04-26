import { describe, expect, it } from 'vitest';
import { readMagic } from '../../web/locket/resize';

// jsdom's Blob is missing features that work fine in browsers,
// but node's is fine; work around it here?
import { Blob } from 'node:buffer';
import { readFileSync } from 'node:fs';

describe('image-ops', () => {
  it.each([
    ['tests/16-bit.png', 'image/png'],
    ['tests/parrot.gif', 'image/gif'],
    ['tests/orient.jpg', 'image/jpeg'],
    ['tests/orient.webp', 'image/webp'],
    ['tests/orient.heic', 'image/heic'],
    ['tests/prefix-only-invalid-weird-magic.heic', 'image/heic'],
  ])('%s recognised as %s', async (path, expected) => {
    expect(await readMagic(new Blob([assetToBlob(path)]))).toBe(expected);
  });
});

const assetToBlob = (asset: string) => {
  return new Blob([readFileSync(asset)]);
};
