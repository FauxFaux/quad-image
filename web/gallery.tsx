import { Component } from 'preact';
import { useEffect } from 'preact/hooks';
import { useQuery } from 'preact-fetching';
import { getGallery } from './locket/client';
import { ThumbList } from './components/thumb-list';

interface GalleryState {
  hash?: string[];
}

export class Gallery extends Component<{}, GalleryState> {
  render(props: Readonly<{}>, state: Readonly<GalleryState>) {
    useEffect(() => {
      const listener = () => {
        this.setState({
          hash: window.location.hash
            .slice(1)
            .split('/')
            .map((part) => decodeURIComponent(part)),
        });
      };
      window.addEventListener('hashchange', listener);
      listener();
      return () => window.removeEventListener('hashchange', listener);
    }, []);

    const pub = state.hash?.[0];
    if (!pub || !pub.includes(':')) {
      return <div class={'alert alert-warn'}>no valid gallery specified</div>;
    }

    const { status, error, data } = useQuery(`gallery-${pub}-data`, async () =>
      getGallery(pub),
    );
    if (status === 'loading') {
      return <div>fetching gallery details...</div>;
    }
    if (status === 'error') {
      return (
        <div class={'alert alert-error'}>loading failed: {error?.message}</div>
      );
    }
    if (status !== 'success' || !Array.isArray(data)) {
      return (
        <div class={'alert alert-error'}>loading failed: invalid data</div>
      );
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
            <ThumbList items={data.map(({ id }) => `../${id}`)} />
            <div class={'util--clear'} />
          </div>
        </div>
      </div>
    );
  }
}
