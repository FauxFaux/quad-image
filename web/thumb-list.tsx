import { Component } from 'preact';

interface ThumbProps {
  items: string[];
}
interface ThumbState {}

export class ThumbList extends Component<ThumbProps, ThumbState> {
  render(props: Readonly<ThumbProps>, state: Readonly<ThumbState>) {
    return (
      <ul class={'thumb--frame'}>
        {props.items.map((bare) => (
          <ThumbDone bare={bare} />
        ))}
      </ul>
    );
  }
}

interface ThumbDoneProps {
  bare: string;
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
