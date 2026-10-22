import { encodeWebP, encodeWebPLossless } from './encode';
import { encodeWebPUsingWasm } from './webp-wasm';
import {
  initialLossyQuality,
  nextLossyQuality,
  shrinkThreshold,
} from '../upload-policy';

// The comparison page explicitly requests WASM rather than canvas encoding.
export const encodeWasmImage = async (original: Blob, quality?: number) => {
  const image = await createImageBitmap(original);
  try {
    const start = performance.now();
    const blob = await encodeWebPUsingWasm(image, quality);
    return { blob, quality, duration: performance.now() - start };
  } finally {
    image.close();
  }
};

// GIFs bypass this path so animation is never decoded to a still frame.
export const encodeImage = async (original: Blob, originalType: string) => {
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
    if (originalType === 'image/png') {
      resized = await encodeWebPLossless(image);
    }

    // Small lossless images are worth preserving exactly. Larger ones fall
    // through to the existing quality-based encoding strategy.
    if (!resized || resized.size > shrinkThreshold) {
      quality = initialLossyQuality;
      resized = await encodeWebP(image, quality);
      let retry = nextLossyQuality(quality, resized.size);
      while (retry !== undefined) {
        resized = undefined;
        quality = retry;
        resized = await encodeWebP(image, quality);
        retry = nextLossyQuality(quality, resized.size);
      }
    }
  } finally {
    image.close();
  }

  return { blob: resized, quality };
};
