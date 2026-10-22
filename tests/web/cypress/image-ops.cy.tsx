import { KnownImageFormat, readDimensions } from '../../../web/locket/resize';
import {
  encodeWebP,
  encodeWebPUsingCanvas,
  canvasSupportsWebP,
} from '../../../web/locket/encode';
import {
  encodeWebPLosslessUsingWasm,
  encodeWebPUsingWasm,
  loadEncoder,
  loadLosslessEncoder,
} from '../../../web/locket/webp-wasm';
import { attemptShrinkage } from '../../../web/upload';
import { encodeInWorker } from '../../../web/locket/encode-worker-client';

describe('image ops', () => {
  it('uses q90 for pasted photographic PNGs whose lossless encode exceeds 1 MiB', () => {
    cy.then(async () => {
      const png = await randomImage(3, 1024, 768, 'image/png');
      const decode = cy.spy(globalThis, 'createImageBitmap');
      const result = await attemptShrinkage(
        { state: 'resizing', ctx: 'pasted', file: png },
        'image/png',
      );
      expect(result.stats).to.include({ quality: 0.9, used: 'resized' });
      if (result.state !== 'ready') throw new Error('expected a ready upload');
      expect(result.file.type).to.equal('image/webp');
      expect(decode).not.to.have.been.called;
      expect(await readDimensions(result.file)).to.deep.equal({
        width: 1024,
        height: 768,
      });
    });
  });

  it('starts JPEG transcoding at q90', () => {
    withBlob('tests/orient.jpg', async (file) => {
      const result = await attemptShrinkage(
        { state: 'resizing', ctx: 'picked', file },
        'image/jpeg',
      );
      expect(result.stats?.quality).to.equal(0.9);
      expect(result.state).to.equal('ready');
    });
  });

  it('retains small PNGs losslessly and keeps an original when re-encoding is not worthwhile', () => {
    cy.then(async () => {
      const canvas = new OffscreenCanvas(32, 32);
      try {
        const draw = canvas.getContext('2d');
        if (!draw) throw new Error('could not create 2d context');
        draw.fillStyle = '#4488cc';
        draw.fillRect(0, 0, 32, 32);
        const png = await canvas.convertToBlob({ type: 'image/png' });
        const lossless = await attemptShrinkage(
          { state: 'resizing', ctx: 'pasted', file: png },
          'image/png',
        );
        expect(lossless.stats).to.include({
          quality: undefined,
          used: 'resized',
        });
        if (lossless.state !== 'ready')
          throw new Error('expected a ready upload');
        const decoded = await createImageBitmap(lossless.file);
        const restored = new OffscreenCanvas(32, 32);
        try {
          const context = restored.getContext('2d');
          if (!context) throw new Error('could not create 2d context');
          context.drawImage(decoded, 0, 0);
          expect(context.getImageData(0, 0, 32, 32).data).to.deep.equal(
            draw.getImageData(0, 0, 32, 32).data,
          );
        } finally {
          decoded.close();
          restored.width = 0;
          restored.height = 0;
        }
        const webp = await canvas.convertToBlob({
          type: 'image/webp',
          quality: 0.9,
        });
        const retained = await attemptShrinkage(
          { state: 'resizing', ctx: 'picked', file: webp },
          'image/webp',
        );
        if (retained.state !== 'ready')
          throw new Error('expected a ready upload');
        expect(retained.file).to.equal(webp);
        expect(retained.stats?.used).to.equal('original');
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    });
  });

  it('keeps GIF bytes intact without decoding a still frame', () => {
    withBlob('tests/parrot.gif', async (file) => {
      const decode = cy.spy(globalThis, 'createImageBitmap');
      const result = await attemptShrinkage(
        { state: 'resizing', ctx: 'picked', file },
        'image/gif',
      );
      if (result.state !== 'ready') throw new Error('expected a ready upload');
      expect(result.file).to.equal(file);
      expect(result.stats?.used).to.equal('original');
      expect(decode).not.to.have.been.called;
    });
  });

  it(
    'drops large photographic transfers to q50 above the 5 MiB threshold',
    { defaultCommandTimeout: 120_000 },
    () => {
      cy.then(async () => {
        const png = await randomImage(4, 3072, 3072, 'image/png');
        const decode = cy.spy(globalThis, 'createImageBitmap');
        let ticks = 0;
        let lastTick = performance.now();
        let longestGap = 0;
        const timer = setInterval(() => {
          const now = performance.now();
          longestGap = Math.max(longestGap, now - lastTick);
          lastTick = now;
          ticks++;
        }, 20);
        let result;
        try {
          result = await attemptShrinkage(
            { state: 'resizing', ctx: 'pasted', file: png },
            'image/png',
          );
          longestGap = Math.max(longestGap, performance.now() - lastTick);
        } finally {
          clearInterval(timer);
        }
        expect(decode).not.to.have.been.called;
        expect(ticks).to.be.greaterThan(5);
        // The lossless WASM call takes seconds for this image. The UI thread
        // must keep running throughout, with tolerance for loaded CI machines.
        expect(longestGap).to.be.lessThan(1000);
        expect(result.stats).to.include({ quality: 0.5, used: 'resized' });
        if (result.state !== 'ready')
          throw new Error('expected a ready upload');
        expect(result.file.size).to.be.at.most(9 * MB);
        expect(await readDimensions(result.file)).to.deep.equal({
          width: 3072,
          height: 3072,
        });
      });
    },
  );

  it('reports malformed images and rejects oversized GIFs before decoding', () => {
    cy.then(async () => {
      for (const [file, type, message] of [
        [new Blob(['invalid']), 'image/png', 'cannot decode image/png'],
        [
          new Blob([new Uint8Array(9 * MB + 1)]),
          'image/gif',
          'Animated GIF exceeds',
        ],
      ] as const) {
        let failure: unknown;
        try {
          await attemptShrinkage(
            { state: 'resizing', ctx: 'picked', file },
            type,
          );
        } catch (error) {
          failure = error;
        }
        expect(failure).to.be.instanceOf(Error);
        expect((failure as Error).message).to.contain(message);
      }
    });
  });

  it('matches queued worker results and continues after a malformed image', () => {
    cy.then(async () => {
      const png = await randomImage(2, 64, 32, 'image/png');
      const results = await Promise.allSettled([
        attemptShrinkage(
          { state: 'resizing', ctx: 'bad', file: new Blob(['invalid']) },
          'image/png',
        ),
        attemptShrinkage(
          { state: 'resizing', ctx: 'first', file: png },
          'image/png',
        ),
        attemptShrinkage(
          { state: 'resizing', ctx: 'second', file: png },
          'image/png',
        ),
      ]);
      expect(results[0].status).to.equal('rejected');
      for (const [index, ctx] of [
        [1, 'first'],
        [2, 'second'],
      ] as const) {
        const result = results[index];
        if (result.status !== 'fulfilled') throw result.reason;
        expect(result.value.ctx).to.equal(ctx);
        expect(result.value.state).to.equal('ready');
        expect(result.value.stats?.originalSize).to.equal(png.size);
      }
    });
  });

  it('supports webp', async () => {
    expect(await canvasSupportsWebP()).to.be.true;
  });

  it('reads dimensions', () => {
    withBlob('tests/orient.png', async (blob) => {
      const dimensions = await readDimensions(blob);
      expect(dimensions).to.deep.equal({ width: 200, height: 100 });
    });

    // 6 is rotated; so 100/200 (not 200/100) if you fail at exif
    withBlob('tests/orient_6.jpg', async (blob) => {
      const dimensions = await readDimensions(blob);
      expect(dimensions).to.deep.equal({ width: 200, height: 100 });
    });
  });

  it('encodes webp using the fallback', () => {
    cy.then(() => expectWebP(encodeWebP));
  });

  it('encodes webp using canvas', () => {
    cy.then(() => expectWebP(encodeWebPUsingCanvas));
  });

  it('encodes webp using wasm', () => {
    cy.then(() => expectWebP(encodeWebPUsingWasm));
  });

  it('runs explicit WASM previews in the shared worker', () => {
    cy.then(async () => {
      const png = await randomImage(3, 128, 64, 'image/png');
      const decode = cy.spy(globalThis, 'createImageBitmap');
      const result = await encodeInWorker(png, 'image/png', {
        mode: 'wasm',
        quality: 0.5,
      });
      expect(decode).not.to.have.been.called;
      expect(result.blob.type).to.equal('image/webp');
      expect(result.duration).to.be.greaterThan(0);
      expect(await readDimensions(result.blob)).to.deep.equal({
        width: 128,
        height: 64,
      });
    });
  });

  it('exposes near-lossless preprocessing and validates its range', () => {
    cy.then(async () => {
      const encoder = await loadEncoder();
      const width = 128;
      const height = 128;
      const pixels = new Uint8Array(width * height * 4);
      let state = 1;
      for (let i = 0; i < pixels.length; i += 4) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        pixels[i] = state & 255;
        pixels[i + 1] = (state >>> 8) & 255;
        pixels[i + 2] = (state >>> 16) & 255;
        pixels[i + 3] = 255;
      }
      const input = encoder.malloc(pixels.length);
      const output = encoder.malloc(4);
      expect(input).not.to.equal(0);
      expect(output).not.to.equal(0);
      try {
        new Uint8Array(encoder.memory.buffer, input, pixels.length).set(pixels);
        const encode = (nearLossless?: number) => {
          new DataView(encoder.memory.buffer).setUint32(output, 123, true);
          const size =
            nearLossless === undefined
              ? encoder.WebPEncodeLosslessRGBA(
                  input,
                  width,
                  height,
                  width * 4,
                  output,
                )
              : encoder.WebPEncodeRGBAWithNearLossless(
                  input,
                  width,
                  height,
                  width * 4,
                  nearLossless,
                  output,
                );
          const pointer = new DataView(encoder.memory.buffer).getUint32(
            output,
            true,
          );
          if (!size) {
            expect(pointer).to.equal(0);
            return undefined;
          }
          try {
            return new Uint8Array(encoder.memory.buffer, pointer, size).slice();
          } finally {
            encoder.WebPFree(pointer);
          }
        };
        const original = encode();
        expect(encode(100)).to.deep.equal(original);
        for (const level of [0, 60]) {
          const bytes = encode(level);
          if (!bytes) throw new Error('near-lossless encoding failed');
          expect(bytes).not.to.deep.equal(original);
          const decoded = await createImageBitmap(
            new Blob([bytes], { type: 'image/webp' }),
          );
          try {
            expect(decoded.width).to.equal(width);
            expect(decoded.height).to.equal(height);
          } finally {
            decoded.close();
          }
        }
        expect(encode(-1)).to.equal(undefined);
        expect(encode(101)).to.equal(undefined);
      } finally {
        encoder.free(input);
        encoder.free(output);
      }
    });
  });

  it('lets browser tasks run before and after a wasm encode', () => {
    cy.then(async () => {
      const encoder = await loadLosslessEncoder();
      const image = await createImageBitmap(new ImageData(1, 1));
      let beforeEncode = false;
      let afterEncode = false;
      try {
        setTimeout(() => {
          beforeEncode = true;
        }, 0);
        const webp = await encodeWebPLosslessUsingWasm(image, {
          ...encoder,
          WebPEncodeLosslessRGBA: (...args) => {
            expect(beforeEncode).to.be.true;
            setTimeout(() => {
              afterEncode = true;
            }, 0);
            return encoder.WebPEncodeLosslessRGBA(...args);
          },
        });
        expect(afterEncode).to.be.true;
        expect(await readDimensions(webp)).to.deep.equal({
          width: 1,
          height: 1,
        });
      } finally {
        image.close();
      }
    });
  });

  it('encodes narrow and odd-sized images across SIMD block boundaries', () => {
    cy.then(async () => {
      const encoders = [await loadEncoder(), await loadLosslessEncoder()];
      for (const width of [1, 7, 15, 16, 17, 31, 33]) {
        const height = 19;
        const pixels = new ImageData(width, height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          pixels.data[i] = (i * 13) & 255;
          pixels.data[i + 1] = (i * 7) & 255;
          pixels.data[i + 2] = (i * 3) & 255;
          pixels.data[i + 3] = 255;
        }
        const image = await createImageBitmap(pixels);
        try {
          for (const quality of [0, 0.75, 1]) {
            const webp = await encodeWebPUsingWasm(image, quality);
            expect(await readDimensions(webp)).to.deep.equal({ width, height });
          }
          for (const encoder of encoders) {
            const webp = await encodeWebPLosslessUsingWasm(image, encoder);
            const decoded = await createImageBitmap(webp);
            const canvas = new OffscreenCanvas(width, height);
            try {
              expect(decoded.width).to.equal(width);
              expect(decoded.height).to.equal(height);
              const context = canvas.getContext('2d');
              if (!context) throw new Error('could not create 2d context');
              context.drawImage(decoded, 0, 0);
              expect(
                context.getImageData(0, 0, width, height).data,
              ).to.deep.equal(pixels.data);
            } finally {
              decoded.close();
              canvas.width = 0;
              canvas.height = 0;
            }
          }
        } finally {
          image.close();
        }
      }
    });
  });

  it(
    'encodes large images with both lossless wasm entry points',
    { defaultCommandTimeout: 120_000 },
    () => {
      cy.then(async () => {
        // 28.1 MiB of decoded RGBA guards the allocator regression previously
        // seen in the lossless-only build.
        const png = await randomImage(3, 5120, 1440, 'image/png');
        const image = await createImageBitmap(png);
        try {
          const fullEncoder = await loadEncoder();
          const webp = await encodeWebPLosslessUsingWasm(image, fullEncoder);
          expect(await readDimensions(webp)).to.deep.equal({
            width: 5120,
            height: 1440,
          });

          const losslessEncoder = await loadLosslessEncoder();
          const losslessWebp = await encodeWebPLosslessUsingWasm(
            image,
            losslessEncoder,
          );
          expect(await readDimensions(losslessWebp)).to.deep.equal({
            width: 5120,
            height: 1440,
          });
        } finally {
          image.close();
        }
      });
    },
  );

  it('fails to open large images', () => {
    withBlob('tests/30k.png', async (blob) => {
      let success = false;
      try {
        await createImageBitmap(blob);
        success = true;
      } catch (e) {
        expect(e).to.be.an.instanceOf(DOMException);
      }
      expect(success).to.be.false;
    });
  });

  it.skip('can shrink large images', () => {
    withBlob('tests/30k.png', async (blob) => {
      await createImageBitmap(blob, {
        resizeWidth: 100,
        resizeHeight: 100,
        resizeQuality: 'low',
      });
    });
  });
});

type WebPEncoder = (
  image: ImageBitmap,
  quality: number | undefined,
) => Promise<Blob>;

const expectWebP = async (encode: WebPEncoder) => {
  const png = await randomImage(3, 2560, 1440, 'image/png');
  expect(png.size).to.be.greaterThan(10 * MB);

  const image = await createImageBitmap(png);
  let webp: Blob;
  try {
    webp = await encode(image, 0.5);
  } finally {
    image.close();
  }
  expect(webp.size).to.be.lessThan(10 * MB);

  const dimensions = await readDimensions(webp);
  expect(dimensions).to.deep.equal({ width: 2560, height: 1440 });
};

const withBlob = (
  filePath: string,
  callback: (blob: Blob) => Promise<void>,
) => {
  cy.readFile(filePath, 'base64').then(async (b64) => {
    const resp = await fetch('data:application/octet-stream;base64,' + b64);
    const blob = await resp.blob();
    await callback(blob);
  });
};

export const randomImage = async (
  seed: number,
  width: number,
  height: number,
  type: KnownImageFormat,
) => {
  const canvas = new OffscreenCanvas(width, height);
  const draw = canvas.getContext('2d');
  if (!draw) throw new Error('OffscreenCanvas does not support 2d context');
  const data = draw.getImageData(0, 0, width, height);
  let rand = makeSplitMix32Rng(seed);
  for (let i = 0; i < data.data.length; i += 4) {
    const a = rand();
    data.data[i] = a & 0xff;
    data.data[i + 1] = (a >> 8) & 0xff;
    data.data[i + 2] = (a >> 16) & 0xff;
    data.data[i + 3] = 0xff;
  }
  draw.putImageData(data, 0, 0);

  return await canvas.convertToBlob({ type });
};

const makeSplitMix32Rng = (a: number) => {
  return () => {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t = t ^ (t >>> 15)) >>> 0;
  };
};

const MB = 1024 * 1024;
