import { h, Component, render } from 'preact';
import cc from 'classcat';

import { User } from './user';
import { Images, MaybeImage } from './images';
import { uploadFile } from './files';
import { Errors } from './errors';
import { JSXInternal } from 'preact/src/jsx';
import EventHandler = JSXInternal.EventHandler;

require('preact/debug');

class Storage {
  targetGallery: string | null;
  images: string[];

  constructor() {
    const pees = localStorage.getItem('quadpees');

    if (pees) {
      this.images = JSON.parse(pees);
    } else {
      this.images = [];
    }

    this.targetGallery = localStorage.getItem('gallery');
  }
}

const storage = new Storage();

export function init(element: HTMLElement) {
  render(<Shine />, element);
}

interface State {
  images: MaybeImage[];
  dragging: boolean;
  errors: string[];
}

class Shine extends Component<{}, State> {
  constructor(props: {}) {
    super(props);

    this.setupDoc();

    this.state = {
      images: storage.images.map((id) => ({ id, code: 'image' })),
      dragging: false,
      errors: [],
    };
  }
  render() {
    return (
      <div>
        <div id="menu">
          <p>
            <img id="user-button" src="user.svg" alt="user menu" />
          </p>
          <User />
        </div>
        <label
          class={cc({
            dragover: this.state.dragging,
            upload: true,
          })}
        >
          <input class="upload__input" type="file" multiple={true} onInput={(e) => this.onInput(e)} />
        </label>
        <Images images={this.state.images} />
        <div id="tcs">
          <p>
            <a href="/terms/">T&amp;Cs</a>
          </p>
        </div>
        <Errors errors={this.state.errors} />
      </div>
    );
  }

  error(message: string) {
    this.setState((state) => {
      state.errors.push(message);
      return { errors: state.errors };
    });
  }

  async onFiles(items: FileList | null, context: string) {
    if (!items) {
      this.error('Files not set; nothing to do.');
      return;
    }

    if (0 === items.length) {
      this.error(
        `No files, valid or not, were found in your ${context}.` +
          `Maybe it wasn't a valid image, or your browser is confused about what it was?`
      );
      return;
    }

    // FileList isn't iterable
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (item.type.match(/image.*/)) {
        await uploadFile(item);
      } else {
        this.error("Ignoring non-image item (of type '" + item.type + "') in " + context + ': ' + item.name);
      }
    }

    // TODO: form.classList.remove('dragover');
  }

  onFilesOrError(items: FileList | null, context: string) {
    this.onFiles(items, context).catch((e) => this.error(e.toString()));
  }

  onInput(e: Event) {
    this.onFilesOrError(e.target && (e.target as HTMLInputElement).files, 'picked files');
  }

  setupDoc() {
    const doc = document.documentElement;

    doc.onpaste = (e) => {
      e.preventDefault();
      this.onFilesOrError(e.clipboardData && e.clipboardData.files, 'pasted content');
    };

    doc.ondrop = (e) => {
      e.preventDefault();
      this.setState({ dragging: false });
      if (e.dataTransfer) {
        this.onFilesOrError(e.dataTransfer.files, 'dropped objects');
      } else {
        this.error("Something was dropped, but it didn't have anything inside.");
      }
    };

    doc.ondragenter = (e) => {
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
      e.preventDefault();
    };

    doc.ondragover = (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
      this.setState({ dragging: true });
    };

    doc.ondragexit = doc.ondragleave = () => {
      this.setState({ dragging: false });
    };
  }
}
