export interface WebPEncoderExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(size: number): number;
  free(pointer: number): void;
  WebPEncodeLosslessRGBA(
    rgba: number,
    width: number,
    height: number,
    stride: number,
    output: number,
  ): number;
  WebPFree(pointer: number): void;
}

interface FullWebPEncoderExports extends WebPEncoderExports {
  WebPEncodeRGBA(
    rgba: number,
    width: number,
    height: number,
    stride: number,
    quality: number,
    output: number,
  ): number;
}

let encoderPromise: Promise<FullWebPEncoderExports> | undefined;
let losslessEncoderPromise: Promise<WebPEncoderExports> | undefined;

const instantiateEncoder = async <Encoder extends WebPEncoderExports>(
  url: URL,
) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`could not load WebP encoder (${response.status})`);
  }

  const { instance } = await WebAssembly.instantiate(
    await response.arrayBuffer(),
    {
      env: {
        emscripten_notify_memory_growth: () => {},
      },
    },
  );
  const encoder = instance.exports as Encoder;
  encoder._initialize();
  return encoder;
};

export const loadEncoder = async () => {
  encoderPromise ??= instantiateEncoder<FullWebPEncoderExports>(
    new URL('../assets/webp-encode.wasm', import.meta.url),
  );

  return encoderPromise;
};

export const loadLosslessEncoder = async () => {
  losslessEncoderPromise ??= instantiateEncoder<WebPEncoderExports>(
    new URL('../assets/webp-encode-lossless.wasm', import.meta.url),
  );

  return losslessEncoderPromise;
};

const wasmQuality = (quality: number | undefined) => {
  // WebPEncodeRGBA accepts 0 through 100; canvas quality is 0 through 1.
  if (quality === undefined || !Number.isFinite(quality)) return 75;
  return Math.min(1, Math.max(0, quality)) * 100;
};

export const encodeWebPUsingWasm = async (
  image: ImageBitmap,
  quality: number | undefined,
): Promise<Blob> => {
  const encoder = await loadEncoder();
  return encodeWebPWithEncoder(image, encoder, (input, output) =>
    encoder.WebPEncodeRGBA(
      input,
      image.width,
      image.height,
      image.width * 4,
      wasmQuality(quality),
      output,
    ),
  );
};

export const encodeWebPLosslessUsingWasm = (
  image: ImageBitmap,
  encoder: WebPEncoderExports,
): Blob =>
  encodeWebPWithEncoder(image, encoder, (input, output) =>
    encoder.WebPEncodeLosslessRGBA(
      input,
      image.width,
      image.height,
      image.width * 4,
      output,
    ),
  );

const encodeWebPWithEncoder = (
  image: ImageBitmap,
  encoder: WebPEncoderExports,
  encode: (input: number, output: number) => number,
): Blob => {
  const canvas = new OffscreenCanvas(image.width, image.height);
  try {
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error('OffscreenCanvas does not support 2d context');

    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, image.width, image.height).data;
    const input = encoder.malloc(rgba.byteLength);
    const output = encoder.malloc(Uint32Array.BYTES_PER_ELEMENT);

    if (!input || !output) {
      if (input) encoder.free(input);
      if (output) encoder.free(output);
      throw new Error('could not allocate WebP encoder memory');
    }

    let encoded = 0;
    try {
      new Uint8Array(encoder.memory.buffer, input, rgba.byteLength).set(rgba);
      new DataView(encoder.memory.buffer).setUint32(output, 0, true);

      const size = encode(input, output);
      encoded = new DataView(encoder.memory.buffer).getUint32(output, true);

      if (!size || !encoded) throw new Error('WebP encoding failed');

      // Copy before WebPFree releases libwebp's output buffer.
      const bytes = new Uint8Array(
        encoder.memory.buffer,
        encoded,
        size,
      ).slice();
      return new Blob([bytes], { type: 'image/webp' });
    } finally {
      if (encoded) encoder.WebPFree(encoded);
      encoder.free(input);
      encoder.free(output);
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
};
