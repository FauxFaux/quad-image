import { OurFile } from '../home';

export type KnownImageFormat =
  | 'image/jpeg'
  | 'image/webp'
  | 'image/png'
  | 'image/gif'
  | 'image/heic';

interface BlobLike {
  slice(start: number, end: number, contentType: string): BlobLike;
  arrayBuffer(): Promise<ArrayBuffer>;
}

const toHexString = (bytes: number[]) => {
  return bytes.map((x) => x.toString(16).padStart(2, '0')).join(' ');
};

export const readMagic = async (
  file: BlobLike,
): Promise<KnownImageFormat | undefined> => {
  const slice = file.slice(0, 32, 'application/octet-stream');
  const prefix = new Uint8Array(await slice.arrayBuffer());

  if (startsWith(prefix, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (
    startsWith(prefix, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(prefix.slice(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return 'image/webp';
  }
  if (
    startsWith(
      prefix.slice(4),
      // ftypheic
      [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63],
    ) ||
    startsWith(
      prefix.slice(16),
      // heic
      [0x68, 0x65, 0x69, 0x63],
    ) ||
    startsWith(
      prefix.slice(16),
      // mif1heic
      [0x6d, 0x69, 0x66, 0x31, 0x68, 0x65, 0x69, 0x63],
    )
  ) {
    return 'image/heic';
  }
  if (startsWith(prefix, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWith(prefix, [0x47, 0x49, 0x46, 0x38])) {
    return 'image/gif';
  }

  console.log('unknown image format', toHexString([...prefix]));
  return undefined;
};

const startsWith = (haystack: ArrayLike<number>, needle: number[]) => {
  for (let i = 0; i < needle.length; ++i) {
    if (haystack[i] !== needle[i]) {
      return false;
    }
  }
  return true;
};

export const readDimensions = async (file: OurFile) => {
  const image = await createImageBitmap(file);
  try {
    return {
      width: image.width,
      height: image.height,
    };
  } finally {
    image.close();
  }
};

export const resizeToWeb = async (
  file: OurFile,
  width: number,
): Promise<OurFile> => {
  const image = await createImageBitmap(file, {
    resizeWidth: width,
    resizeQuality: 'high',
  });
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext('2d')?.drawImage(image, 0, 0);

  const blob: OurFile = await canvas.convertToBlob({ type: 'image/webp' });
  if (file.name) {
    blob.name = file.name;
  }
  canvas.width = 0;
  canvas.height = 0;
  return blob;
};

export const encodeWebP = async (
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

export const supportsWebP = async () => {
  const canvas = new OffscreenCanvas(1, 1);
  // this won't realistically fail, but getContext must
  // have been called for convertToBlob to not fail (Chrome, 2024)
  const drawable = canvas.getContext('2d');
  if (!drawable) throw new Error('OffscreenCanvas does not support 2d context');
  const blob = await canvas.convertToBlob({ type: 'image/webp' });
  return blob.type === 'image/webp';
};
