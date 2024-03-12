import { describe, expect, it } from '@jest/globals';
import { readMagic, supportsWebP } from '../../web/locket/resize';

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
  ])('%s recognised as %s', async (path, expected) => {
    expect(await readMagic(new Blob([assetToBlob(path)]))).toBe(expected);
  });

  it('jsdom supports webp', () => {
    expect(supportsWebP()).toBe(false);
  });
});

const assetToBlob = (asset: string) => {
  return new Blob([readFileSync(asset)]);
};
