import { h, Component } from 'preact';

export class User extends Component {
  render() {
    return (
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
    );
  }
}
