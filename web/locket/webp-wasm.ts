interface WebPEncoderExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(pointer: number): void;
  WebPEncodeRGBA(
    rgba: number,
    width: number,
    height: number,
    stride: number,
    quality: number,
    output: number,
  ): number;
  WebPFree(pointer: number): void;
}

let encoderPromise: Promise<WebPEncoderExports> | undefined;

export const loadEncoder = async () => {
  encoderPromise ??= fetch(
    new URL('../assets/webp-encode.wasm', import.meta.url),
  )
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`could not load WebP encoder (${response.status})`);
      }

      return WebAssembly.instantiate(await response.arrayBuffer(), {
        env: {
          emscripten_notify_memory_growth: () => {},
        },
      });
    })
    .then(({ instance }) => instance.exports as WebPEncoderExports);

  return encoderPromise;
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
  const canvas = new OffscreenCanvas(image.width, image.height);
  try {
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error('OffscreenCanvas does not support 2d context');

    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, image.width, image.height).data;
    const encoder = await loadEncoder();
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

      const size = encoder.WebPEncodeRGBA(
        input,
        image.width,
        image.height,
        image.width * 4,
        wasmQuality(quality),
        output,
      );
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
