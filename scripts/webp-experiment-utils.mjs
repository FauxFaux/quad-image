// Shared experiment helpers; encoding always uses the checked-in WASM module.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
export async function createEncoder(wasm) {
  const { instance } = await WebAssembly.instantiate(wasm, {
    env: { emscripten_notify_memory_growth() {} },
  });
  const encoder = instance.exports;
  encoder.emscripten_stack_init();
  encoder.__set_stack_limits(
    encoder.emscripten_stack_get_base(),
    encoder.emscripten_stack_get_end(),
  );
  encoder._initialize();
  return encoder;
}
export function encode(encoder, rgba, width, height, variant) {
  const pointer = encoder.malloc(rgba.length);
  const slot = encoder.malloc(4);
  let encoded = 0;
  try {
    if (!pointer || !slot) throw new Error('WASM allocation failed');
    new Uint8Array(encoder.memory.buffer, pointer, rgba.length).set(rgba);
    new DataView(encoder.memory.buffer).setUint32(slot, 0, true);
    const entryPoint =
      variant.mode === 'lossy'
        ? encoder.WebPEncodeRGBA
        : encoder.WebPEncodeRGBAWithNearLossless;
    const size = entryPoint(
      pointer,
      width,
      height,
      width * 4,
      variant.quality ?? variant.nearLossless,
      slot,
    );
    encoded = new DataView(encoder.memory.buffer).getUint32(slot, true);
    if (!size || !encoded) throw new Error('WASM encode failed');
    return Buffer.from(new Uint8Array(encoder.memory.buffer, encoded, size));
  } finally {
    if (encoded) encoder.WebPFree(encoded);
    if (pointer) encoder.free(pointer);
    if (slot) encoder.free(slot);
  }
}
export async function decode(file, width, height) {
  const { stdout } = await run(
    'magick',
    [file, '-colorspace', 'sRGB', '-depth', '8', 'rgba:-'],
    { encoding: 'buffer', maxBuffer: width * height * 4 + 1024 * 1024 },
  );
  if (stdout.length !== width * height * 4)
    throw new Error('Unexpected decoded pixel count');
  return stdout;
}
export function metrics(original, decoded) {
  let squared = 0,
    alphaMaxError = 0,
    rgbMaxError = 0,
    rgbChangedPixels = 0;
  // Composite RGB over white so fully transparent hidden RGB does not affect PSNR.
  for (let i = 0; i < original.length; i += 4) {
    alphaMaxError = Math.max(
      alphaMaxError,
      Math.abs(original[i + 3] - decoded[i + 3]),
    );
    let changed = false;
    for (let c = 0; c < 3; c++) {
      const error = Math.abs(original[i + c] - decoded[i + c]);
      rgbMaxError = Math.max(rgbMaxError, error);
      changed ||= error !== 0;
      const a =
        (original[i + c] * original[i + 3]) / 255 + 255 - original[i + 3];
      const b = (decoded[i + c] * decoded[i + 3]) / 255 + 255 - decoded[i + 3];
      squared += (a - b) ** 2;
    }
    if (changed) rgbChangedPixels++;
  }
  const mse = squared / ((original.length / 4) * 3);
  return {
    psnr: mse === 0 ? null : 10 * Math.log10(255 ** 2 / mse),
    alphaMaxError,
    rgbMaxError,
    rgbChangedPixels,
  };
}
