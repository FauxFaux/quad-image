import { describe, expect, test } from 'vitest';
import { describeStats } from '../../web/components/thumb-list';

describe('describeStats', () => {
  test('describes an image we shrank', () => {
    expect(
      describeStats({
        originalSize: 6_500_000,
        originalType: 'image/heic',
        resizedSize: 1_400_000,
        quality: 0.8,
        used: 'resized',
      }),
    ).toBe('sent webp q0.8 1.3MB, from 6.2MB image/heic');
  });

  test('describes an encode which was not worth it', () => {
    expect(
      describeStats({
        originalSize: 1_100_000,
        originalType: 'image/jpeg',
        resizedSize: 1_050_000,
        quality: 0.5,
        used: 'original',
      }),
    ).toBe("sent 1.0MB image/jpeg unchanged, webp q0.5 1.0MB wasn't worth it");
  });

  test('describes an image we never tried to encode', () => {
    expect(
      describeStats({
        originalSize: 30_000,
        originalType: 'image/png',
        used: 'original',
      }),
    ).toBe('sent 29kB image/png unchanged');
  });
});
