import * as JSONAPI from 'jsonapi-typescript/index';

let state: State | null = null;

class State {
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

  $.get('../api/gallery/' + hash.gallery)
    .done((data) => {
      const images = fetchComplete(data, showError);
      if (null === images) {
        return;
      }
      state = new State(hash.gallery, images);
      render(target, hash);
    })
    .catch(() => showError('network error fetching gallery'));
}

function fetchComplete(resp: JSONAPI.Document, showError: (msg: string) => void): string[] | null {
  if ('errors' in resp) {
    showError(JSON.stringify(resp.errors));
    return null;
  }

  if (!('data' in resp) || !Array.isArray(resp.data)) {
    showError(JSON.stringify(resp));
    return null;
  }

  const withData = resp as JSONAPI.DocWithData<JSONAPI.ResourceObject[]>;

  return imageIds(withData.data);
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

function render(body: HTMLElement, hash: Hash) {
  // clear
  body.innerText = '';

  if (null == state) {
    console.log('impossible state');
    return;
  }

  const itemsPerPage = 10;
  const images: string[] = state.images;

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
