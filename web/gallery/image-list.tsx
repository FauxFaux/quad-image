import { AppError, Loader, SavedImage } from '../types';
import { Component } from 'preact';
import * as JSONAPI from 'jsonapi-typescript';
import { Tiles } from './tiles';
import { useQuery } from 'preact-fetching';
import { Paging } from './paging';

export interface Props {
  galleryId: string;
  afterImage?: string;
  perPage: number;
}

export interface State {}

export class ImageList extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    if (props.perPage < 1) throw new Error('impossible paging');
  }

  render(props: Props, state: State) {
    const { isLoading, error, data } = useQuery(props.galleryId, async () => {
      const response = await fetch('../api/gallery/' + props.galleryId);
      const data = await response.json();
      return extractImages(data);
    });

    if (error) {
      console.error(error);
      return <span>Failed: {error.message}</span>;
    }

    if (isLoading || !data) {
      return <span>Loading...</span>;
    }

    let offset = 0;
    if (props.afterImage) {
      offset = data.indexOf(props.afterImage);
      if (offset === -1) {
        return <span>Image not found in gallery (bad url?).</span>;
      }
    }

    return (
      <>
        <Tiles images={data.slice(offset, offset + props.perPage)} />
        <hr />
        <Paging images={data} galleryId={props.galleryId} current={offset} perPage={props.perPage} />
      </>
    );
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
