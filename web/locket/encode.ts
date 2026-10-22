import {
  encodeWebPLosslessUsingWasm,
  encodeWebPUsingWasm,
  loadEncoder,
  loadLosslessEncoder,
} from './webp-wasm';

export const canvasSupportsWebP = async () => {
  const canvas = new OffscreenCanvas(1, 1);
  // this won't realistically fail, but getContext must
  // have been called for convertToBlob to not fail (Chrome, 2024)
  const drawable = canvas.getContext('2d');
  if (!drawable) throw new Error('OffscreenCanvas does not support 2d context');
  const blob = await canvas.convertToBlob({ type: 'image/webp' });
  return blob.type === 'image/webp';
};

// Detect capabilities on demand and share the result across encodes.
let canvasWebPSupported: Promise<boolean> | undefined;
const getCanvasWebPSupport = async () =>
  (canvasWebPSupported ??= canvasSupportsWebP());

export const preloadWebPEncoder = async () => {
  const supported = await getCanvasWebPSupport();
  await (supported ? loadLosslessEncoder() : loadEncoder());
};

export const encodeWebPUsingCanvas = async (
  image: ImageBitmap,
  quality: number | undefined,
): Promise<Blob> => {
  const canvas = new OffscreenCanvas(image.width, image.height);
  try {
    const draw = canvas.getContext('2d');
    if (!draw) throw new Error('OffscreenCanvas does not support 2d context');
    draw.drawImage(image, 0, 0);
    return await canvas.convertToBlob({ type: 'image/webp', quality });
  } finally {
    // allegedly this is how you 'free' a canvas
    canvas.width = 0;
    canvas.height = 0;
  }
};

export const encodeWebP = async (
  image: ImageBitmap,
  quality: number | undefined,
): Promise<Blob> => {
  if (await getCanvasWebPSupport()) return encodeWebPUsingCanvas(image, quality);
  return encodeWebPUsingWasm(image, quality);
};

export const encodeWebPLossless = async (image: ImageBitmap): Promise<Blob> => {
  const encoder = await ((await getCanvasWebPSupport())
    ? loadLosslessEncoder()
    : loadEncoder());
  return encodeWebPLosslessUsingWasm(image, encoder);
};
