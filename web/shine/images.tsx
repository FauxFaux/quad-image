import { h, Component } from 'preact';
import { SavedImage } from '../types';
import { Image } from './image';

export type MaybeImage = { code: 'image'; id: SavedImage } | { code: 'loading' };

export interface Props {
  images: MaybeImage[];
}

export class Images extends Component<Props> {
  render(props) {
    return (
      <ul id="images">
        {props.images.map((image) => {
          if ('image' === image.code) {
            return <Image id={image.id} />;
          }
          return <p>ENIS</p>;
        })}
      </ul>
    );
  }
}
