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

test('keeps the card, open details, and copy button through every upload stage and reordering', async () => {
  const createObjectURL = vi.fn(() => 'blob:preview');
  class PreviewURL extends URL {
    static override createObjectURL = createObjectURL;
    static override revokeObjectURL = vi.fn();
  }
  vi.stubGlobal('URL', PreviewURL);
  const writeText = vi.fn();
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const original = new File(['original'], 'picture.png');
  const prepared = new File(['prepared'], 'picture.webp');
  const common = { uploadId: 0, ctx: 'picked' };
  const other: PendingItem = {
    uploadId: 1,
    ctx: 'picked',
    state: 'queued',
    file: new File(['other'], 'other.png'),
  };
  const { container, rerender } = render(
    <ThumbList
      items={[{ ...common, state: 'queued', file: original }, other]}
    />,
  );
  const button = screen.getAllByRole<HTMLButtonElement>('button', {
    name: 'copy',
  })[0];
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(writeText).not.toHaveBeenCalled();
  const card = button.closest('li');
  const details = card?.querySelector('details');
  const table = details?.querySelector('table');
  fireEvent.click(screen.getAllByText('Queued')[0]);
  expect(details?.open).toBe(true);
  const stats = {
    originalSize: 2000000,
    originalType: 'image/png',
    resizedSize: 1000000,
    quality: 0.8,
    used: 'resized' as const,
  };
  const stages: PendingItem[] = [
    { ...common, state: 'resizing', file: original },
    { ...common, state: 'ready', file: prepared, stats },
    { ...common, state: 'starting', file: prepared, stats },
    { ...common, state: 'uploading', file: prepared, stats, progress: 0.25 },
    { ...common, state: 'uploading', file: prepared, stats, progress: 1 },
    {
      ...common,
      state: 'processing',
      file: prepared,
      stats,
      message: 'Upload accepted, server transcoding…',
    },
    {
      ...common,
      state: 'processing',
      file: prepared,
      stats,
      message: 'Upload accepted, server transcoding…',
      thumbnail: 'e/abcdefghij.webp',
    },
  ];
  for (const stage of stages) {
    rerender(<ThumbList items={[stage, other]} />);
    expect(card?.querySelector('details')).toBe(details);
    expect(details?.querySelector('table')).toBe(table);
    expect(details?.open).toBe(true);
    expect(card?.querySelector('button')).toBe(button);
    expect(button.disabled).toBe(true);
    expect(card?.querySelector('.thumb--spinner')).not.toBeNull();
  }
  const processing: PendingItem = {
    ...common,
    state: 'processing',
    file: prepared,
    stats,
    message: 'Image ready, optimizing…',
    available: {
      id: 'e/abcdefghij.webp',
      url: 'e/abcdefghij.webp?work-in-progress',
    },
    encodes: [{ name: 'q90', bytes: 200000, improved: true }],
  };
  rerender(<ThumbList items={[processing, other]} />);
  expect(card?.querySelector('button')).toBe(button);
  expect(button.disabled).toBe(false);
  expect(button.textContent).toBe('copy intermediate');
  expect(card?.querySelector('summary')?.textContent).toBe('Upload details');
  expect(card?.querySelector('details')).toBe(details);
  expect(details?.open).toBe(true);

  rerender(
    <ThumbList
      items={[
        other,
        {
          ...common,
          state: 'done',
          base: 'e/abcdefghij.webp',
          stats,
          encodes: processing.encodes,
        },
      ]}
    />,
  );
  expect(container.querySelectorAll('li')[1]).toBe(card);
  expect(card?.querySelector('details')).toBe(details);
  expect(details?.querySelector('table')).toBe(table);
  expect(details?.open).toBe(true);
  expect(card?.querySelector('button')).toBe(button);
  expect(button.textContent).toBe('copy');
  expect(button.disabled).toBe(false);
  expect(card?.querySelector('.thumb--spinner')).toBeNull();
  await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
});

test('copies the available image while optimizing, then copies the final URL', async () => {
  const writeText = vi
    .fn<(text: string) => Promise<void>>()
    .mockResolvedValue();
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const id = 'e/abcdefghij.webp';
  const item: PendingItem = {
    uploadId: 0,
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
  expect(screen.queryByText('Image ready, optimizing…')).toBeNull();
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
          uploadId: item.uploadId,
          ctx: 'picked',
          base: id,
          stats: item.stats,
          encodes: item.encodes,
        },
      ]}
    />,
  );
  expect(screen.getByRole('link').getAttribute('href')).toBe(id);
  expect(container.querySelector('details')).toBe(details);
  expect(details?.open).toBe(true);
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
