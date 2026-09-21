import { describe, expect, test } from 'vitest';

import { generateGallerySecret, plausibleGallerySecret } from '../../web/types';

describe('generateGallerySecret', () => {
  test('makes pronounceable ten-letter passwords with one or two capitals', () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const gallery = generateGallerySecret();
      expect(plausibleGallerySecret(gallery)).toBe(true);
      expect(gallery).toMatch(/^anon![a-zA-Z]{10}$/);

      const password = gallery.slice('anon!'.length);
      expect(password.match(/[A-Z]/g)?.length).toBeGreaterThanOrEqual(1);
      expect(password.match(/[A-Z]/g)?.length).toBeLessThanOrEqual(2);

      const classes = password
        .toLowerCase()
        .split('')
        .map((letter) => ('aeiouhy'.includes(letter) ? 'v' : 'c'))
        .join('');
      expect(classes).not.toContain('cc');
      expect(classes).not.toContain('vvvv');
    }
  });
});
