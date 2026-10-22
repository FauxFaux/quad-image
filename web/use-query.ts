import { useEffect, useRef, useState } from 'preact/hooks';

type QueryResult<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'success'; data: T; error?: undefined }
  | { status: 'error'; data?: undefined; error: Error };

// Each consumer owns its request. Ignore results after unmount or a key change.
export function useQuery<T>(
  key: string | undefined,
  fetcher: () => Promise<T>,
) {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [result, setResult] = useState<{
    key: string;
    value: QueryResult<T>;
  }>();

  useEffect(() => {
    if (key === undefined) return;
    let active = true;
    void (async () => {
      try {
        const data = await fetcherRef.current();
        if (active) setResult({ key, value: { status: 'success', data } });
      } catch (error) {
        if (active) {
          setResult({
            key,
            value: {
              status: 'error',
              error: error instanceof Error ? error : new Error(String(error)),
            },
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [key]);

  const value: QueryResult<T> =
    result?.key === key && result !== undefined
      ? result.value
      : { status: 'loading' };
  return {
    ...value,
    isLoading: value.status === 'loading',
    isError: value.status === 'error',
  };
}
