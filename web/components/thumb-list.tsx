import { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ImageId } from '../types';
import type { EncodeResult, PendingItem, UploadStats } from '../upload';
import type { Prop } from './sign-in';
import CheckboxBlankCircleOutlineIcon from 'mdi-preact/CheckboxBlankCircleOutlineIcon';
import CheckboxMarkedCircleOutlineIcon from 'mdi-preact/CheckboxMarkedCircleOutlineIcon';
import { serializeError } from 'serialize-error';

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
                stats={item.stats}
                encodes={item.encodes}
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
  url?: string;
  message?: string;
  /** only present for uploads from this session */
  stats?: UploadStats;
  encodes?: EncodeResult[];
  picking?: boolean;
  setPicked?: (picked: boolean) => void;
}

export function ThumbDone(props: ThumbDoneProps) {
  const [copied, setCopied] = useState<boolean>(false);

  const doCopy = async () => {
    try {
      const url = new URL(props.url ?? props.bare, document.location.href);
      await navigator.clipboard.writeText(url.href);
      setCopied(true);
    } catch (err) {
      alert(
        'Failed to copy to clipboard: ' + JSON.stringify(serializeError(err)),
      );
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
        onClick={() => {
          void doCopy();
        }}
        onMouseLeave={clearCopy}
      >
        {copied ? 'copied!' : props.url ? 'copy intermediate' : 'copy'}
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
      <a
        href={props.url ?? bare}
        target={'_blank'}
        class={'thumb--frame-imgbox'}
      >
        <img src={`${bare}?variant=thumbnail`} loading={'lazy'} />
      </a>
      {props.message && (
        <div class={'thumb--stats text-body-secondary'}>{props.message}</div>
      )}
      <UploadDetails stats={props.stats} encodes={props.encodes} />
      {footer}
    </li>
  );
}

function UploadDetails(props: {
  stats?: UploadStats;
  encodes?: EncodeResult[];
}) {
  if (!props.stats && !props.encodes?.length) return null;
  const winner = props.encodes
    ?.filter((encode) => encode.improved)
    .at(-1)?.name;
  return (
    <details class={'thumb--stats text-body-secondary'}>
      <summary>Upload details</summary>
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Format / setting</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          {props.stats && (
            <>
              <tr>
                <td>Original{props.stats.used === 'original' && ' (sent)'}</td>
                <td>{props.stats.originalType}</td>
                <td>{humanSize(props.stats.originalSize)}</td>
              </tr>
              {props.stats.resizedSize !== undefined && (
                <tr>
                  <td>
                    Local
                    {props.stats.used === 'resized' ? ' (sent)' : ' (not sent)'}
                  </td>
                  <td>
                    WebP{' '}
                    {props.stats.quality === undefined
                      ? 'lossless'
                      : `q${Math.round(props.stats.quality * 100)}`}
                  </td>
                  <td>{humanSize(props.stats.resizedSize)}</td>
                </tr>
              )}
            </>
          )}
          {props.encodes?.map((encode) => (
            <tr
              key={encode.name}
              class={
                encode.name === winner ? 'thumb--encode-winner' : undefined
              }
              aria-current={encode.name === winner ? 'true' : undefined}
              title={
                encode.name === winner ? 'Winning server encode' : undefined
              }
            >
              <td>Server</td>
              <td>{encode.name}</td>
              <td>{humanSize(encode.bytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

const humanSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${(bytes / 1024).toFixed(1)}kB`;

interface ThumbUploadProps {
  item: PendingItem;
}

export function ThumbUpload(props: ThumbUploadProps) {
  const item = props.item;
  const file =
    item.state === 'done' || (item.state === 'processing' && item.available)
      ? undefined
      : item.file;
  const [previewUrl, setPreviewUrl] = useState<string>();
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (item.state === 'done') {
    //return <ThumbDone bare={item.base} />;
    throw new Error('ThumbUpload should not be used for done items');
  }

  if (item.state === 'processing' && item.available) {
    return (
      <ThumbDone
        bare={item.available.id}
        url={item.available.url}
        message={item.message}
        stats={item.stats}
        encodes={item.encodes}
      />
    );
  }

  const preview = (msg: string) => (
    <div class={'thumb--frame-imgbox thumb--frame-message'}>
      <img
        src={previewUrl}
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
        <UploadDetails stats={item.stats} encodes={item.encodes} />
      </li>
    );
  }

  const msg = simpleMessage(item);
  if (msg) {
    return (
      <li>
        {preview(msg)}
        <UploadDetails stats={item.stats} encodes={item.encodes} />
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
      <UploadDetails stats={item.stats} encodes={item.encodes} />
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
    case 'processing':
      return item.message;
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
