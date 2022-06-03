import { h, Component, Fragment } from 'preact';
import { SavedImage } from '../types';

export interface Props {
  images: SavedImage[];
}

export class Tiles extends Component<Props> {
  render(props: Props) {
    return props.images.map((id) => (
      <div className="gallery__thumb">
        <a className="gallery__thumb" href={`../${id}`}>
          <img className="gallery__thumb" src={`../${id}.thumb.jpg`} />
        </a>
      </div>
    ));
  }
}
