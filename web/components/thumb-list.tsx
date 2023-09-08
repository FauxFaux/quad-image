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
          switch (item.state) {
            case 'done':
              return <ThumbDone bare={item.base} />;
            case 'error':
              return <li>error: {item.error}</li>;
            case 'queued':
              return <li>queued: {item.file.name}</li>;
            case 'starting':
              return <li>starting...</li>;
            case 'uploading': {
              if (Number.isNaN(item.progress)) {
                return <li>upload progress not available</li>;
              }
              const pct = Math.round(item.progress * 100);
              if (pct < 100)
                return (
                  <li>
                    <div className="progress">
                      <div
                        className="progress-bar"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        transferring...
                      </div>
                    </div>
                  </li>
                );
              return <li>upload complete, waiting for server</li>;
            }
            default:
              return <li>unknown state: {(item as any).state}</li>;
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
        <a href={bare} target={'_blank'}>
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
