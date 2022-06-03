import { h, Component, render } from 'preact';

import { AppError, Loader, SavedImage } from '../types';
import { useEffect } from 'preact/compat';
import { ImageList } from './image-list';

export function init(el: HTMLElement) {
  el.innerHTML = '';
  render(<Gallery />, el);
}

export interface Props {}

export interface State {
  galleryId?: string;
  afterImage?: string;
}

export class Gallery extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = readHash();
  }

  render(props: Props, state: State) {
    const hashChange = (_ev: HashChangeEvent) => {
      this.setState(readHash());
    };

    useEffect(() => {
      window.addEventListener('hashchange', hashChange);
      return () => window.removeEventListener('hashchange', hashChange);
    });

    if (!state.galleryId) {
      return <span>No gallery provided.</span>;
    }

    return <ImageList galleryId={state.galleryId} afterImage={state.afterImage} perPage={24} />;
  }
}

function readHash(hash: string = window.location.hash || '#'): {
  galleryId?: string;
  afterImage?: string;
} {
  const parts: (string | undefined)[] = hash.split('#');

  const galleryId = parts[1];
  const afterImage = parts[2];
  return { galleryId, afterImage };
}
