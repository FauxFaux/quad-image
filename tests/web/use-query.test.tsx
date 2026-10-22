import { act, cleanup, renderHook, waitFor } from '@testing-library/preact';
import { afterEach, expect, test, vi } from 'vitest';
import { useQuery } from '../../web/use-query';

afterEach(cleanup);

test('does not request until enabled and does not refetch on ordinary renders', async () => {
  const fetcher = vi.fn(async () => await Promise.resolve('gallery'));
  const { result, rerender } = renderHook(
    ({ queryKey }) => useQuery(queryKey, fetcher),
    { initialProps: { queryKey: undefined as string | undefined } },
  );
  expect(fetcher).not.toHaveBeenCalled();
  rerender({ queryKey: 'gallery' });
  await waitFor(() => expect(result.current.data).toBe('gallery'));
  rerender({ queryKey: 'gallery' });
  expect(fetcher).toHaveBeenCalledOnce();
});

test('ignores an old request after changing keys', async () => {
  let resolveOld!: (value: string) => void;
  const oldRequest = new Promise<string>((resolve) => {
    resolveOld = resolve;
  });
  const { result, rerender } = renderHook(
    ({ queryKey }) =>
      useQuery(queryKey, async () =>
        queryKey === 'old' ? oldRequest : 'new result',
      ),
    { initialProps: { queryKey: 'old' } },
  );
  rerender({ queryKey: 'new' });
  await waitFor(() => expect(result.current.data).toBe('new result'));
  await act(async () => {
    resolveOld('old result');
    await oldRequest;
  });
  expect(result.current.data).toBe('new result');
});

test('surfaces request failures', async () => {
  const { result } = renderHook(() =>
    useQuery('gallery', async () => {
      await Promise.reject(new Error('offline'));
      return 'unreachable';
    }),
  );
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error?.message).toBe('offline');
});
