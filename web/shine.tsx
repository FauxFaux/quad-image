import { h, Component, render } from 'preact';

import { User } from './user';
import { Images } from './images';

export function init(element: HTMLElement) {
  render(<Shine />, element);
}

class Shine extends Component {
  render() {
    return (
      <div>
        <div id="menu">
          <p>
            <img id="user-button" src="user.svg" alt="user menu" />
          </p>
          <User />
        </div>
        <label for="realos" id="form"></label>
        <input type="file" multiple id="realos" />
        <Images />
        <div id="errors">Waiting for Javascript to initialise...</div>
        <div id="tcs">
          <p>
            <a href="/terms/">T&amp;Cs</a>
          </p>
        </div>
      </div>
    );
  }
}
