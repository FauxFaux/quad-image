import { h, Component, Fragment } from 'preact';
import { SavedImage } from '../types';

export interface Props {
  images: SavedImage[];
}

export class Tiles extends Component<Props> {
  render(props: Props) {
    return props.images.map((id) => <img src={`../${id}.thumb.jpg`} />);
  }
}
