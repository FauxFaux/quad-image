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

    const paging = <Paging images={data} galleryId={props.galleryId} current={offset} perPage={props.perPage} />;

    return (
      <>
        {paging}
        <hr />
        <Tiles images={data.slice(offset, offset + props.perPage)} />
        <hr />
        {paging}
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
