import { describe, expect, test } from 'vitest';

import {
  addImagesToGallery,
  removeSelectedImages,
} from '../../web/gallery-actions';

describe('removeSelectedImages', () => {
  test('removes selected images while preserving order', () => {
    expect(
      removeSelectedImages(
        ['e/first.webp', 'e/second.webp', 'e/third.webp'],
        new Set(['e/first.webp', 'e/third.webp']),
      ),
    ).toEqual(['e/second.webp']);
  });

  test('can remove every image', () => {
    expect(
      removeSelectedImages(['e/first.webp'], new Set(['e/first.webp'])),
    ).toEqual([]);
  });
});

describe('addImagesToGallery', () => {
  test('adds each image separately and tracks partial failures', async () => {
    const calls: string[][] = [];
    const result = await addImagesToGallery(
      'album!secret',
      ['e/first.webp', 'e/second.webp'],
      async (_gallery, images) => {
        await Promise.resolve();
        calls.push(images);
        if (images[0] === 'e/second.webp') {
          throw new Error('nope');
        }
        return { id: 'album:public-id', type: 'gallery' };
      },
    );

    expect(calls).toEqual([['e/first.webp'], ['e/second.webp']]);
    expect(result).toEqual({
      added: 1,
      publicGallery: 'album:public-id',
      failures: [{ image: 'e/second.webp', error: 'nope' }],
    });
  });
});
