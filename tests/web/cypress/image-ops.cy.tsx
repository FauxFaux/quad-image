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

describe('image ops', () => {
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
            const webp = encodeWebPLosslessUsingWasm(image, encoder);
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
          const webp = encodeWebPLosslessUsingWasm(image, fullEncoder);
          expect(await readDimensions(webp)).to.deep.equal({
            width: 5120,
            height: 1440,
          });

          const losslessEncoder = await loadLosslessEncoder();
          const losslessWebp = encodeWebPLosslessUsingWasm(
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
