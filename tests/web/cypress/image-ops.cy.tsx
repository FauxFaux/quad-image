import {
  encodeWebP,
  KnownImageFormat,
  readDimensions,
  supportsWebP,
} from '../../../web/locket/resize';

describe('image ops', () => {
  it('supports webp', async () => {
    expect(await supportsWebP()).to.be.true;
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

  it('encodes webp', () => {
    cy.then(async () => {
      const png = await randomImage(3, 2560, 1440, 'image/png');
      expect(png.size).to.be.greaterThan(10 * MB);
      const image = await createImageBitmap(png);
      let webp;
      try {
        webp = await encodeWebP(image, 0.5);
      } finally {
        image.close();
      }
      expect(webp.size).to.be.lessThan(2 * MB);

      const dimensions = await readDimensions(webp);
      expect(dimensions).to.deep.equal({ width: 2560, height: 1440 });
      const style = { maxWidth: 400 };
      cy.mount(
        <>
          <img src={URL.createObjectURL(png)} style={style} />
          <img src={URL.createObjectURL(webp)} style={style} />
          <br />
          {(png.size / MB).toFixed(2)}MB &rArr; {(webp.size / MB).toFixed(2)}MB
        </>,
      );
    });
  });

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

  it('cannot shrink large images', () => {
    withBlob('tests/30k.png', async (blob) => {
      let success = false;
      try {
        await createImageBitmap(blob, {
          resizeWidth: 100,
          resizeHeight: 100,
          resizeQuality: 'low',
        });
        success = true;
      } catch (e) {
        expect(e).to.be.an.instanceOf(DOMException);
      }
      expect(success).to.be.false;
    });
  });
});

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
