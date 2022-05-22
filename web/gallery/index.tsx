import * as JSONAPI from 'jsonapi-typescript';
import { h, Component, render } from 'preact';

import { AppError, Loader, SavedImage } from '../types';
import { Tiles } from './tiles';
import { useEffect } from 'preact/compat';

export function init(el: HTMLElement) {
  el.innerHTML = '';
  render(<Gallery galleryId="green:z25E-PzBTg" />, el);
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
    this.state = { images: { code: 'loading' } };

    this.orFatal(async () => {
      const response = await fetch('../api/gallery/' + new Hash().gallery);
      const data = await response.json();
      const images = extractImages(data);
      this.setState({ images: { code: 'ready', images } });
    });
  }

  render(props: Props, state: State) {
    const hashChange = (ev: HashChangeEvent) => {
      // look, this needs to be a different component
    };

    useEffect(() => {
      window.addEventListener('hashchange', hashChange);
      return () => window.removeEventListener('hashchange', hashChange);
    });

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

  orFatal(f: () => Promise<void>) {
    f().catch((e) => {
      if (e instanceof AppError) {
        // TODO: UI-ise?
        console.error(e.message, e.body);
      }
      this.setState({ images: { code: 'error', message: e.message } });
    });
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

function unpackJson(resp: any): resp is JSONAPI.DocWithData<JSONAPI.ResourceObject[]> | JSONAPI.DocWithErrors {
  return ('data' in resp && Array.isArray(resp.data)) || 'errors' in resp;
}

function extractImages(resp: unknown): string[] {
  if (!unpackJson(resp)) {
    throw new AppError('invalid JSONAPI response', resp);
  }

  if ('errors' in resp) {
    throw new AppError('server returned unexpected errors', resp.errors);
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

/*
  let currentImage = 0;
  if (null !== hash.after) {
    const afterIdx = images.indexOf(hash.after);
    if (-1 !== afterIdx) {
      currentImage = afterIdx + 1;
    }
  }

  const thisPage = images.slice(currentImage, Math.min(currentImage + itemsPerPage, images.length));

  for (const id of thisPage) {
    $('<img/>', {
      src: '../' + id,
    }).appendTo(body);
    $('<hr/>').appendTo(body);
  }

  // 17 images, 10 images per page
  // ceil(0.1) == 1
  // ceil(1.7) == 2
  // ceil(2.0) == 2
  // ceil(2.1) == 3
  // image  0, floor(0.0) == 0
  // image  9, floor(0.9) == 0
  // image 10, floor(1.0) == 1
  // image 12, floor(1.2) == 1

  const pages: number = Math.ceil(images.length / itemsPerPage);
  const currentPage: number = Math.floor(currentImage / itemsPerPage);

  for (let page = 0; page < pages; ++page) {
    const active = page === currentPage;
    $('<a/>', {
      href: `#${hash.gallery}#${images[page * itemsPerPage]}`,
    })
      .addClass(active ? 'active' : 'inactive')
      .append(`${page + 1}`)
      .appendTo(body);
  }
}
*/
