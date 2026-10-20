import { afterEach, describe, expect, test } from 'vitest';
import { createElement } from 'preact';
import { cleanup, render, screen } from '@testing-library/preact';
import { ThumbDone } from '../../web/components/thumb-list';
import type { UploadStats } from '../../web/upload';

afterEach(cleanup);

const renderStats = (stats: UploadStats) =>
  render(createElement(ThumbDone, { bare: 'e/abcdefghij.webp', stats }));

describe('upload details table', () => {
  test('shows the original and sent local encode', () => {
    renderStats({
      originalSize: 6_500_000,
      originalType: 'image/heic',
      resizedSize: 1_400_000,
      quality: 0.8,
      used: 'resized',
    });
    expect(
      screen.getByRole('row', { name: 'Original image/heic 6.2MB' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('row', { name: 'Local (sent) WebP q80 1.3MB' }),
    ).toBeTruthy();
  });

  test('marks an unused local encode and the original that was sent', () => {
    renderStats({
      originalSize: 1_100_000,
      originalType: 'image/jpeg',
      resizedSize: 1_050_000,
      quality: 0.5,
      used: 'original',
    });
    expect(
      screen.getByRole('row', { name: 'Original (sent) image/jpeg 1.0MB' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('row', { name: 'Local (not sent) WebP q50 1.0MB' }),
    ).toBeTruthy();
  });

  test('shows the original when no local encode was attempted', () => {
    renderStats({
      originalSize: 30_000,
      originalType: 'image/png',
      used: 'original',
    });
    expect(
      screen.getByRole('row', { name: 'Original (sent) image/png 29.3kB' }),
    ).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  test('labels a lossless local encode', () => {
    renderStats({
      originalSize: 30_000,
      originalType: 'image/png',
      resizedSize: 20_000,
      used: 'resized',
    });
    expect(
      screen.getByRole('row', { name: 'Local (sent) WebP lossless 19.5kB' }),
    ).toBeTruthy();
  });
});
