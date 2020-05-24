import { SavedImage } from '../types';
import { upload } from './net';

async function readFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = function () {
      if (this.result instanceof ArrayBuffer) {
        resolve(this.result);
      } else {
        reject('invalid result');
      }
    };

    reader.onerror = () => reject('unknown error reading file');
    reader.onabort = () => reject('unexpected abort reading file');

    reader.readAsArrayBuffer(file);
  });
}

export async function uploadFile(file: File): Promise<SavedImage> {
  const blobPart = await readFile(file);

  const type = file.type || 'image/jpeg';

  const blob = new Blob([blobPart], { type });

  return await upload(blob);
}
