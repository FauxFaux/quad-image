import { encodeWebP, encodeWebPLossless } from './locket/encode';

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

export type PendingItem = { ctx: string; stats?: UploadStats } & (
  | { state: 'queued'; file: OurFile }
  | { state: 'resizing'; file: OurFile }
  | { state: 'ready'; file: OurFile }
  | { state: 'starting'; file: OurFile }
  | { state: 'uploading'; progress: number; file: OurFile }
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

  await unblock();
  // firefox rejects with a bare, stackless InvalidStateError for anything it
  // can't decode (heic, tiff, ...), so say what we were holding at the time
  const image = await createImageBitmap(original).catch((cause: unknown) => {
    throw new Error(`cannot decode ${originalType} (${original.size} bytes)`, {
      cause,
    });
  });

  let quality: number | undefined;
  let resized;
  try {
    if (isLosslessFormat(originalType)) {
      await unblock();
      resized = await encodeWebPLossless(image);
    }

    // Small lossless images are worth preserving exactly. Larger ones fall
    // through to the existing quality-based encoding strategy.
    if (!resized || resized.size > shrinkThreshold) {
      await unblock();
      quality = 0.8;
      resized = await encodeWebP(image, quality);

      if (resized.size > 5 * 1024 * 1024) {
        resized = undefined;
        await unblock();
        quality = 0.5;
        resized = await encodeWebP(image, quality);
      }

      if (resized.size > 9 * 1024 * 1024) {
        resized = undefined;
        await unblock();
        quality = 0.2;
        resized = await encodeWebP(image, quality);
      }
    }
  } finally {
    image.close();
  }

  await unblock();
  const saveAtLeast = 0.1; // 0.1 = 10%
  const worthIt = resized.size < original.size * (1 - saveAtLeast);

  const stats: UploadStats = {
    originalSize: original.size,
    originalType,
    resizedSize: resized.size,
    quality,
    used: worthIt ? 'resized' : 'original',
  };

  console.log('resize', stats);

  return {
    ...next,
    state: 'ready',
    file: worthIt ? resized : original,
    stats,
  };
};

const shrinkThreshold = 1024 * 1024;

// GIF is excluded: it can be losslessly encoded, but decoding it to an
// ImageBitmap would discard animation. PNG is the lossless still-image format
// accepted by the uploader.
export const isLosslessFormat = (type: string) => type === 'image/png';

const unblock = async () => sleep(15);

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
