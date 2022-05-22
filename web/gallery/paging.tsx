import { Component } from 'preact';
import cc from 'classcat';
import { SavedImage } from '../types';

export interface Props {
  galleryId: string;
  images: SavedImage[];
  current: number;
  perPage: number;
}

export interface State {}

export class Paging extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    if (props.perPage < 1) throw new Error('impossible paging');
  }

  render(props: Props) {
    const pageHeaders = [];
    for (let i = 0; i < props.images.length; i += props.perPage) {
      const img = props.images[i];
      pageHeaders.push(
        <a
          className={cc({
            gallery__paging: true,
            'gallery__paging--active': props.current === i,
          })}
          href={`#${props.galleryId}#${img}`}
        >
          {1 + i / props.perPage}
        </a>
      );
    }
    return pageHeaders;
  }
}
