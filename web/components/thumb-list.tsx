import { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { ImageId } from '../types';
import type { PendingItem } from '../home';
import type { Prop } from './sign-in';
import CheckboxBlankCircleOutlineIcon from 'mdi-preact/CheckboxBlankCircleOutlineIcon';
import CheckboxMarkedCircleOutlineIcon from 'mdi-preact/CheckboxMarkedCircleOutlineIcon';

interface ThumbProps {
  items: PendingItem[];
  picking?: Prop<Record<ImageId, boolean> | undefined>;
}

export function ThumbList(props: ThumbProps) {
  return (
    <ul class={'thumb--frame'}>
      {props.items.map((item) => {
        // I think I split these because Done is the most common case (by far), but I don't think I like it
        switch (item.state) {
          case 'done':
            return (
              <ThumbDone
                bare={item.base}
                picking={
                  props.picking?.v
                    ? (props.picking.v[item.base] ?? false)
                    : undefined
                }
                setPicked={(v) => {
                  props.picking?.set({ ...props.picking.v, [item.base]: v });
                }}
              />
            );
          default:
            return <ThumbUpload item={item} />;
        }
      })}
    </ul>
  );
}

interface ThumbDoneProps {
  bare: ImageId;
  picking?: boolean;
  setPicked?: (picked: boolean) => void;
}

export function ThumbDone(props: ThumbDoneProps) {
  const [copied, setCopied] = useState<boolean>(false);

  const doCopy = async () => {
    try {
      const { bare } = props;
      const url = new URL(bare, document.location.href);
      await navigator.clipboard.writeText(url.href);
      setCopied(true);
    } catch (err) {
      alert('Failed to copy to clipboard: ' + err);
    }
  };

  const clearCopy = () => {
    setCopied(false);
  };

  const bare = props.bare;
  let footer: JSX.Element;
  if (props.picking === undefined) {
    footer = (
      <button
        className={`btn btn-${!copied ? 'secondary' : 'success'}`}
        onClick={doCopy}
        onMouseLeave={clearCopy}
      >
        {!copied ? 'copy' : 'copied!'}
      </button>
    );
  } else {
    const checked = props.picking;
    const label = checked ? (
      <>
        <CheckboxMarkedCircleOutlineIcon /> selected
      </>
    ) : (
      <>
        <CheckboxBlankCircleOutlineIcon /> select
      </>
    );
    footer = (
      <button
        className={`btn btn-${!checked ? 'secondary' : 'success'}`}
        onClick={() => props.setPicked?.(!checked)}
      >
        {label}
      </button>
    );
  }
  return (
    <li>
      <a href={bare} target={'_blank'} class={'thumb--frame-imgbox'}>
        <img src={`${bare}.thumb.jpg`} loading={'lazy'} />
      </a>
      {footer}
    </li>
  );
}

interface ThumbUploadProps {
  item: PendingItem;
}

export function ThumbUpload(props: ThumbUploadProps) {
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

const simpleMessage = (item: PendingItem) => {
  switch (item.state) {
    case 'queued':
      return 'queued';
    case 'resizing':
      return 'resizing';
    case 'ready':
      return 'ready';
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
