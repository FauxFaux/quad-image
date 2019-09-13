import * as JSONAPI from 'jsonapi-typescript';
import { h, Component, render } from 'preact';

import { Loader, SavedImage } from './types';
import { Tiles } from './tiles';

let state: State | null = null;

export function init(el: HTMLElement) {
  render(<Gallery galleryId="green:p33qj9zIOw" />, el);
}

export interface Props {
  galleryId: string;
}

export interface State {
  images: Loader<{ images: SavedImage[] }>;
}

export class Gallery extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.setState({ images: { code: 'loading' } });

    fetch('../api/gallery/' + new Hash().gallery).then(async (response) => {
      const data = await response.json();
      const images = extractImages(data, () => {});
      if (null === images) {
        return;
      }

      await this.setState({ images: { code: 'ready', images } });
    });
  }

  render(props: Props, state: State) {
    const images = state.images;
    switch (images.code) {
      case 'loading':
        return <span>Loading...</span>;
      case 'error':
        return <span>Failed: {images.message}</span>;
      case 'ready':
        return <Tiles images={images.images} />;
    }
  }
}

class OState {
  gallery: string;
  images: string[];

  constructor(gallery: string, images: string[]) {
    this.gallery = gallery;
    this.images = images;
  }
}

class Hash {
  gallery: string;
  after: string | null;

  constructor() {
    const hash: string = window.location.hash || '#';

    const parts: string[] = hash.split('#');

    if (parts.length < 2) {
      throw new Error('no gallery provided');
    }

    this.gallery = parts[1];

    if (parts.length > 1) {
      this.after = parts[2];
    } else {
      this.after = null;
    }
  }
}
/*
export function hashChanged() {
  const target: null | HTMLElement = document.getElementById('gallery');
  if (null == target) {
    console.log('script mis-loaded?');
    return;
  }

  const showError = (msg: string) => (target.innerText = msg);

  // throws on failure
  const hash = new Hash();

  if (state && state.gallery === hash.gallery) {
    render(target, hash);
    return;
  }

  // the data we have saved is useless now
  state = null;

  fetch('../api/gallery/' + hash.gallery)
    .then(async (response) => {
      const data = await response.json();
      const images = extractImages(data, showError);
      if (null === images) {
        return;
      }
      state = new OState(hash.gallery, images);
      render(target, hash);
    })
    .catch(() => showError('network error fetching gallery'));
}
*/

function unpackJson(resp: any): resp is JSONAPI.DocWithData<JSONAPI.ResourceObject[]> | JSONAPI.DocWithErrors {
  return ('data' in resp && Array.isArray(resp.data)) || 'errors' in resp;
}

function extractImages(resp: any, showError: (msg: string) => void): string[] | null {
  if (!unpackJson(resp)) {
    showError('invalid JSONAPI response');
    return null;
  }

  if ('errors' in resp) {
    showError(JSON.stringify(resp.errors));
    return null;
  }

  return imageIds(resp.data);
}

function imageIds(withData: JSONAPI.ResourceObject[]): string[] {
  const ids: string[] = [];

  for (const img of withData) {
    if ('image' !== img.type || undefined === img.id) {
      console.log('invalid record', img);
      continue;
    }

    ids.push(img.id);
  }

  return ids;
}
