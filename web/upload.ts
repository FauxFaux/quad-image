import { encodeInWorker } from './locket/encode-worker-client';
import { maxUploadBytes, selectUpload } from './upload-policy';
export { shrinkThreshold } from './upload-policy';

export type OurFile = Blob & { name?: string };

/** what we did to the file before sending it; for on-device debugging */
export interface UploadStats {
  /** what the browser handed us */
  originalSize: number;
  /** the format we sniffed out of the original, not what it claimed */
  originalType: string;
  /** the smallest encode we managed, if we tried to encode at all */
  resizedSize?: number;
  /** the webp quality of a lossy encode; absent for a lossless encode */
  quality?: number;
  /** which of the two we actually put on the wire */
  used: 'resized' | 'original';
}

export interface EncodeResult {
  name: string;
  /** Absent until the planned encode completes. */
  bytes?: number;
  improved?: boolean;
}

export type PendingItem = {
  /** Stable card identity while files, status, and list position change. */
  uploadId?: number;
  ctx: string;
  stats?: UploadStats;
  encodes?: EncodeResult[];
} & (
  | { state: 'queued'; file: OurFile }
  | { state: 'resizing'; file: OurFile }
  | { state: 'ready'; file: OurFile }
  | { state: 'starting'; file: OurFile }
  | { state: 'uploading'; progress: number; file: OurFile }
  | {
      state: 'processing';
      message: string;
      file: OurFile;
      thumbnail?: string;
      available?: { id: string; url: string };
    }
  | { state: 'done'; base: string }
  | { state: 'error'; error: string; file: OurFile }
);

export const attemptShrinkage = async (
  next: PendingItem,
  originalType: string,
): Promise<PendingItem> => {
  if (next.state !== 'resizing') {
    throw new Error(`invalid state: ${next.state}`);
  }
  const original = next.file;

  if (originalType === 'image/gif') {
    if (original.size > maxUploadBytes)
      throw new Error('Animated GIF exceeds the 9 MiB upload limit');
    return {
      ...next,
      state: 'ready',
      stats: {
        originalSize: original.size,
        originalType,
        used: 'original',
      },
    };
  }

  const { blob: resized, quality } = await encodeInWorker(
    original,
    originalType,
  );

  const used = selectUpload(
    original.size,
    resized.size,
    originalType === 'image/heic',
  );

  const stats: UploadStats = {
    originalSize: original.size,
    originalType,
    resizedSize: resized.size,
    quality,
    used,
  };

  console.log('resize', stats);

  return {
    ...next,
    state: 'ready',
    file: used === 'resized' ? resized : original,
    stats,
  };
};

// GIFs must retain their animation.
export const isLosslessFormat = (type: string) => type === 'image/png';
