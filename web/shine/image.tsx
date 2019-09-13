import { h, Component } from 'preact';
import { writeText } from 'clipboard-polyfill';

import { SavedImage } from '../types';

export interface Props {
  id: SavedImage;
}

export interface State {
  copyDone: false;
}

export class Image extends Component<Props> {
  render(props: Readonly<Props>, state: Readonly<State>) {
    return (
      <li data-mini-url={props.id} class="loaded">
        <button
          onClick={(_) => this.copyUrlToClipboard(props.id)}
          onMouseOut={(_) => this.setState({ copyDone: false })}
        >
          {state.copyDone ? 'copied' : 'copy'}
        </button>
        <button>🗑➡️</button>
        <a href={props.id} target="_blank">
          <img src={`${props.id}.thumb.jpg`} />
        </a>
      </li>
    );
  }

  copyUrlToClipboard(id: SavedImage) {
    const expandedUrl = new URL(id, document.location.href).href;

    writeText(expandedUrl)
      .then((_) => this.setState({ copyDone: true }))
      // TODO: ? Does this really fail?
      .catch(console.log);
  }
}
