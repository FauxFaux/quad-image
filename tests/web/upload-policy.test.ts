import { describe, expect, test } from 'vitest';
import { nextLossyQuality, selectUpload } from '../../web/upload-policy';

const MiB = 1024 * 1024;

describe('client transfer policy', () => {
  test.each([
    [0.9, 5 * MiB, undefined],
    [0.9, 5 * MiB + 1, 0.5],
    [0.5, 9 * MiB, undefined],
    [0.5, 9 * MiB + 1, 0.2],
    [0.2, 10 * MiB, undefined],
  ])('quality %s after %s bytes retries at %s', (quality, bytes, expected) => {
    expect(nextLossyQuality(quality, bytes)).toBe(expected);
  });

  test('requires at least 10% savings for optional transcoding', () => {
    expect(selectUpload(10000, 9000)).toBe('resized');
    expect(selectUpload(10000, 9001)).toBe('original');
    expect(selectUpload(10000, 12000)).toBe('original');
  });

  test('uses a fitting encode even if it saves less than 10% against an oversized original', () => {
    expect(selectUpload(9 * MiB + 1, 9 * MiB)).toBe('resized');
  });

  test('never chooses an oversized transcode or original', () => {
    expect(selectUpload(MiB, 9 * MiB + 1)).toBe('original');
    expect(() => selectUpload(10 * MiB, 9 * MiB + 1)).toThrow(
      '9 MiB upload limit',
    );
  });

  test('converts unsupported formats even without savings', () => {
    expect(selectUpload(10000, 12000, true)).toBe('resized');
    expect(() => selectUpload(10000, 9 * MiB + 1, true)).toThrow(
      '9 MiB upload limit',
    );
  });
});
