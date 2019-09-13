import { h, Component, render } from 'preact';

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
          <div id="user-settings">
            <div class="close">✖</div>
            <p>
              Current gallery:{' '}
              <span id="current-gallery">
                <i>thinking</i>
              </span>
            </p>
            <form id="user-form">
              <label>
                New <abbr title="Gallery name and trigger (4-10 letter name, !, password)">gallery</abbr>:
                <input id="new-gallery" name="gallery" required placeholder="green!battery staple"></input>
              </label>
              <button>sync</button>
            </form>
          </div>
        </div>
        <label for="realos" id="form"></label>
        <input type="file" multiple id="realos" />
        <ul id="images"></ul>
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
