import { useEffect, useState } from 'preact/hooks';
import { useQuery } from './use-query';
import { getGallery } from './locket/client';
import { ThumbList } from './components/thumb-list';

export function Gallery() {
  const [hash, setHash] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    const listener = () => {
      setHash(
        window.location.hash
          .slice(1)
          .split('/')
          .map((part) => decodeURIComponent(part)),
      );
    };
    window.addEventListener('hashchange', listener);
    listener();
    return () => window.removeEventListener('hashchange', listener);
  }, []);

  const pub = hash?.[0];
  const valid = !!pub?.includes(':');
  const { status, error, data } = useQuery(
    valid ? `gallery-${pub}-data` : undefined,
    async () => getGallery(pub!),
  );
  if (!valid) {
    return <div class={'alert alert-warning'}>no valid gallery specified</div>;
  }

  if (status === 'loading') {
    return <div>fetching gallery details...</div>;
  }
  if (status === 'error') {
    return (
      <div class={'alert alert-danger'}>loading failed: {error?.message}</div>
    );
  }
  if (status !== 'success' || !Array.isArray(data)) {
    return <div class={'alert alert-danger'}>loading failed: invalid data</div>;
  }

  return (
    <div class={'container-fluid'}>
      <div class={'row gallery--header'}>
        <div class={'col'}>
          Gallery: <a href={`/gallery/#${pub}`}>{pub}</a>
          <span className={'home--sign_in-divider'}>|</span>
          <a href={'/'}>back to home</a>
        </div>
      </div>
      <div class={'row'}>
        <div class={'col'}>
          <ThumbList
            items={data.map(({ id }) => ({
              state: 'done',
              base: `../${id}`,
              ctx: 'gallery',
            }))}
          />
          <div class={'util--clear'} />
        </div>
      </div>
    </div>
  );
}
