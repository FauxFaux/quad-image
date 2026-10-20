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
    <ul class="thumb--frame">
      {props.items.map((item, index) => {
        const bare = item.state === 'done' ? item.base : undefined;
        return (
          <ThumbCard
            key={item.uploadId ?? bare ?? index}
            item={item}
            picking={
              bare && props.picking?.v
                ? (props.picking.v[bare] ?? false)
                : undefined
            }
            setPicked={(v) => {
              if (bare) props.picking?.set({ ...props.picking.v, [bare]: v });
            }}
          />
        );
      })}
    </ul>
  );
}

interface ThumbDoneProps {
  bare: ImageId;
  stats?: UploadStats;
  encodes?: EncodeResult[];
  picking?: boolean;
  setPicked?: (picked: boolean) => void;
}

export function ThumbDone(props: ThumbDoneProps) {
  return (
    <ThumbCard
      item={{
        state: 'done',
        base: props.bare,
        ctx: 'gallery',
        stats: props.stats,
        encodes: props.encodes,
      }}
      picking={props.picking}
      setPicked={props.setPicked}
    />
  );
}

function ThumbCard(props: {
  item: PendingItem;
  picking?: boolean;
  setPicked?: (picked: boolean) => void;
}) {
  const { item } = props;
  const available = item.state === 'processing' ? item.available : undefined;
  const url = item.state === 'done' ? item.base : available?.url;
  const image =
    item.state === 'done'
      ? item.base
      : item.state === 'processing'
        ? (available?.id ?? item.thumbnail)
        : undefined;
  const file = item.state === 'done' || image ? undefined : item.file;
  const [previewUrl, setPreviewUrl] = useState<string>();
  useEffect(() => {
    if (!file) return;
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    return () => URL.revokeObjectURL(localUrl);
  }, [file]);

  // Tie acknowledgement to the copied URL so completing an intermediate upload
  // resets it, including when the clipboard promise resolves after completion.
  const [copiedUrl, setCopiedUrl] = useState<string>();
  const copied = url !== undefined && copiedUrl === url;
  const doCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(
        new URL(url, document.location.href).href,
      );
      setCopiedUrl(url);
    } catch (err) {
      alert(
        'Failed to copy to clipboard: ' + JSON.stringify(serializeError(err)),
      );
    }
  };

  let footer: JSX.Element;
  if (props.picking === undefined) {
    footer = (
      <button
        className={`btn btn-${copied ? 'success' : 'secondary'}`}
        disabled={!url}
        onClick={() => {
          void doCopy();
        }}
        onMouseLeave={() => setCopiedUrl(undefined)}
      >
        {copied ? 'copied!' : available ? 'copy intermediate' : 'copy'}
      </button>
    );
  } else {
    const checked = props.picking;
    footer = (
      <button
        className={`btn btn-${checked ? 'success' : 'secondary'}`}
        onClick={() => props.setPicked?.(!checked)}
      >
        {checked ? (
          <>
            <CheckboxMarkedCircleOutlineIcon /> selected
          </>
        ) : (
          <>
            <CheckboxBlankCircleOutlineIcon /> select
          </>
        )}
      </button>
    );
  }
  const busy = item.state !== 'done' && item.state !== 'error';
  return (
    <li>
      <a href={url} target="_blank" class="thumb--frame-imgbox">
        <img
          src={image ? `${image}?variant=thumbnail` : previewUrl}
          alt={
            item.state !== 'done' && item.file.name
              ? `preview of ${item.file.name}`
              : 'image preview'
          }
          loading="lazy"
        />
      </a>
      <UploadDetails
        stats={item.stats}
        encodes={item.encodes}
        status={uploadStatus(item)}
        busy={busy}
      />
      {footer}
      {item.state === 'uploading' && !Number.isNaN(item.progress) && (
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={Math.round(item.progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="progress-bar"
            style={`width: ${Math.round(item.progress * 100)}%`}
          />
        </div>
      )}
    </li>
  );
}

function UploadDetails(props: {
  stats?: UploadStats;
  encodes?: EncodeResult[];
  status?: string;
  busy?: boolean;
}) {
  if (!props.stats && !props.encodes?.length && !props.status && !props.busy)
    return null;
  const winner = props.encodes
    ?.filter((encode) => encode.improved)
    .at(-1)?.name;
  return (
    <details class={'thumb--stats text-body-secondary'}>
      <summary title="Upload details">
        {props.busy && <span class="thumb--spinner" aria-hidden="true" />}
        {props.status ?? 'Upload details'}
      </summary>
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

const uploadStatus = (item: PendingItem): string | undefined => {
  switch (item.state) {
    case 'queued':
      return 'Queued';
    case 'resizing':
      return 'Preparing image…';
    case 'ready':
      return 'Ready to upload';
    case 'starting':
      return 'Starting upload…';
    case 'processing':
      return item.available ? undefined : item.message;
    case 'error':
      return `Upload failed: ${item.error}`;
    case 'done':
      return undefined;
    case 'uploading':
      if (Number.isNaN(item.progress)) return 'Uploading…';
      if (item.progress === 1) return 'Upload sent, waiting for server…';
      return `Uploading: ${Math.round(item.progress * 100)}%`;
  }
};
