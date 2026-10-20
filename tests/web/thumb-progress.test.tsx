import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/preact';
import { ThumbList } from '../../web/components/thumb-list';
import type { PendingItem } from '../../web/upload';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('copies the available image while optimizing, then copies the final URL', async () => {
  const writeText = vi
    .fn<(text: string) => Promise<void>>()
    .mockResolvedValue();
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const id = 'e/abcdefghij.webp';
  const item: PendingItem = {
    ctx: 'picked',
    state: 'processing',
    file: new File(['image'], 'picture.png'),
    message: 'Image ready, optimizing…',
    available: { id, url: `${id}?work-in-progress` },
    stats: {
      originalSize: 6_500_000,
      originalType: 'image/png',
      resizedSize: 1_400_000,
      quality: 0.8,
      used: 'resized',
    },
    encodes: [
      { name: 'q90', bytes: 248000, improved: true },
      { name: 'nl40', bytes: 402500, improved: true },
    ],
  };
  const { rerender, container } = render(
    <ThumbList items={[{ ...item, encodes: item.encodes?.slice(0, 1) }]} />,
  );
  expect(
    screen.getByText('q90').closest('tr')?.getAttribute('aria-current'),
  ).toBe('true');
  rerender(<ThumbList items={[item]} />);
  const temporary = new URL(`${id}?work-in-progress`, document.location.href)
    .href;
  expect(screen.getByRole('link').getAttribute('href')).toBe(
    `${id}?work-in-progress`,
  );
  expect(screen.getByRole('img').getAttribute('src')).toBe(
    `${id}?variant=thumbnail`,
  );
  screen.getByText('Image ready, optimizing…');
  const details = container.querySelector('details');
  expect(details?.open).toBe(false);
  expect(screen.getByText('image/png').closest('details')).toBe(details);
  fireEvent.click(screen.getByText('Upload details'));
  expect(details?.open).toBe(true);
  screen.getByRole('cell', { name: 'Original' });
  screen.getByRole('cell', { name: '6.2MB' });
  screen.getByRole('cell', { name: 'Local (sent)' });
  screen.getByRole('cell', { name: 'WebP q80' });
  screen.getByRole('cell', { name: '1.3MB' });
  screen.getByRole('cell', { name: 'q90' });
  screen.getByRole('cell', { name: '242.2kB' });
  screen.getByRole('cell', { name: 'nl40' });
  screen.getByRole('cell', { name: '393.1kB' });
  expect(
    screen.getByText('nl40').closest('tr')?.getAttribute('aria-current'),
  ).toBe('true');
  expect(
    screen.getByText('q90').closest('tr')?.hasAttribute('aria-current'),
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'copy intermediate' }));
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(temporary));
  await screen.findByRole('button', { name: 'copied!' });

  rerender(
    <ThumbList
      items={[
        {
          state: 'done',
          ctx: 'picked',
          base: id,
          stats: item.stats,
          encodes: item.encodes,
        },
      ]}
    />,
  );
  expect(screen.getByRole('link').getAttribute('href')).toBe(id);
  expect(screen.queryByText('Image ready, optimizing…')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'copy intermediate' }),
  ).toBeNull();
  expect(screen.getByText('q90').closest('details')).not.toBeNull();
  expect(
    screen
      .getByText('nl40')
      .closest('tr')
      ?.classList.contains('thumb--encode-winner'),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'copy' }));
  await waitFor(() =>
    expect(writeText).toHaveBeenLastCalledWith(
      new URL(id, document.location.href).href,
    ),
  );
});

test('releases the local preview when a server image becomes available', async () => {
  const createObjectURL = vi.fn(() => 'blob:preview');
  const revokeObjectURL = vi.fn();
  class PreviewURL extends URL {
    static override createObjectURL = createObjectURL;
    static override revokeObjectURL = revokeObjectURL;
  }
  vi.stubGlobal('URL', PreviewURL);
  const item: PendingItem = {
    ctx: 'picked',
    state: 'processing',
    file: new File(['image'], 'picture.png'),
    message: 'Upload accepted, server transcoding…',
  };
  const { rerender } = render(<ThumbList items={[item]} />);
  await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
  rerender(
    <ThumbList
      items={[
        {
          ...item,
          available: {
            id: 'e/abcdefghij.webp',
            url: 'e/abcdefghij.webp?work-in-progress',
          },
        },
      ]}
    />,
  );
  await waitFor(() =>
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview'),
  );
});
