import { Component } from 'preact';
import type { ImageId } from '../types';
import type { PendingItem } from '../home';

interface ThumbProps {
  items: PendingItem[];
}
interface ThumbState {}

export class ThumbList extends Component<ThumbProps, ThumbState> {
  render(props: Readonly<ThumbProps>, state: Readonly<ThumbState>) {
    return (
      <ul class={'thumb--frame'}>
        {props.items.map((item) => {
          // I think I split these because Done is the most common case (by far), but I don't think I like it
          switch (item.state) {
            case 'done':
              return <ThumbDone bare={item.base} />;
            default:
              return <ThumbUpload item={item} />;
          }
        })}
      </ul>
    );
  }
}

interface ThumbDoneProps {
  bare: ImageId;
}
interface ThumbDoneState {
  copied?: boolean;
}

export class ThumbDone extends Component<ThumbDoneProps, ThumbDoneState> {
  doCopy = async () => {
    try {
      const { bare } = this.props;
      const url = new URL(bare, document.location.href);
      await navigator.clipboard.writeText(url.href);
      this.setState({ copied: true });
    } catch (err) {
      alert('Failed to copy to clipboard: ' + err);
    }
  };

  clearCopy = () => {
    this.setState({ copied: false });
  };

  render(props: Readonly<ThumbDoneProps>, state: Readonly<ThumbDoneState>) {
    const bare = props.bare;
    return (
      <li>
        <a href={bare} target={'_blank'} class={'thumb--frame-imgbox'}>
          <img src={`${bare}.thumb.jpg`} />
        </a>
        <button
          class={`btn btn-${!this.state.copied ? 'secondary' : 'success'}`}
          onClick={this.doCopy}
          onMouseLeave={this.clearCopy}
        >
          {!this.state.copied ? 'copy' : 'copied!'}
        </button>
      </li>
    );
  }
}

interface ThumbUploadProps {
  item: PendingItem;
}

export class ThumbUpload extends Component<ThumbUploadProps> {
  render(props: Readonly<ThumbUploadProps>) {
    const item = props.item;
    if (item.state === 'done') {
      //return <ThumbDone bare={item.base} />;
      throw new Error('ThumbUpload should not be used for done items');
    }

    const preview = (msg: string) => (
      <div class={'thumb--frame-imgbox thumb--frame-message'}>
        <img
          src={URL.createObjectURL(item.file)}
          alt={item.file.name ? `preview of ${item.file.name}` : 'preview'}
        />
        <span>
          {item.ctx}
          <br />
          {item.file.name}
          <br />
          {msg}
        </span>
      </div>
    );

    // this is such garbage

    if (item.state === 'error') {
      return (
        <li>
          {preview(`error: ${item.error}`)}
          <div class={'embarrassment'}>&nbsp;</div>
        </li>
      );
    }

    const msg = simpleMessage(item);
    if (msg) {
      return (
        <li>
          {preview(msg)}
          <div class={'embarrassment'}>&nbsp;</div>
        </li>
      );
    }

    if (item.state !== 'uploading' || Number.isNaN(item.progress)) {
      throw new Error(`unreachable state ${item.state}`);
    }

    const pct = Math.round(item.progress * 100);
    // pct < 100
    return (
      <li>
        {preview(`transferring: ${pct}% complete`)}
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="progress-bar" style={`width: ${pct}%`} />
        </div>
      </li>
    );
  }
}

const simpleMessage = (item: PendingItem) => {
  switch (item.state) {
    case 'queued':
      return 'queued';
    case 'starting':
      return 'starting';
    case 'uploading': {
      if (Number.isNaN(item.progress)) {
        return 'transferring (progress not available)';
      }
      const pct = Math.round(item.progress * 100);
      if (pct === 100) {
        return 'upload complete, waiting for server';
      }
    }
  }
  return undefined;
};
