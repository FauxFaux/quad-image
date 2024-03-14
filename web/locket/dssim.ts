import * as sys from '../../dssim-core/dssim_core_bg.wasm';

export interface Dssim {
  __marker: 'dssim';
  inner: number;
}

export interface DssimImage {
  __marker: 'dssim-image';
  inner: number;
}

export const create = (): Dssim => {
  const inner = sys.dssim_new();
  return { __marker: 'dssim', inner };
};

export const free = (dssim: Dssim) => {
  sys.dssim_free(dssim.inner);
};

export const createImageRgba = (
  dssim: Dssim,
  data: Uint8ClampedArray,
  width: number,
  height: number,
): DssimImage => {
  const tempPtr = sys.dssim_calloc(data.length);
  try {
    const memory = new Uint8ClampedArray(sys.memory.buffer);
    for (let i = 0; i < data.length; i++) {
      memory[tempPtr + i] = data[i];
    }
    const inner = sys.dssim_create_image_rgba(
      dssim.inner,
      tempPtr,
      width,
      height,
    );
    return { __marker: 'dssim-image', inner };
  } finally {
    sys.dssim_free_calloc(tempPtr, data.length);
  }
};

export const freeImage = (image: DssimImage) => {
  sys.dssim_free_image(image.inner);
};

export const compare = (dssim: Dssim, a: DssimImage, b: DssimImage): number => {
  return sys.dssim_compare(dssim.inner, a.inner, b.inner);
};
