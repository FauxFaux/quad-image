import { AppError, SavedImage } from '../types';
import { upload } from './net';

function readFile(file: File): Promise<ArrayBuffer> {
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
  setBodyActive();

  const blobPart = await readFile(file);

  const type = file.type || 'image/jpeg';

  const blob = new Blob([blobPart], { type });

  // TODO: add placeholder

  const imageId = await upload(blob);

  return imageId;
}

/*
if (!success) {
  loadingItem.actionButton.onclick = () => {
    alert(msg);
  };
  loadingItem.li.classList.add('failed');
  loadingItem.li.classList.remove('loading');
  return;
}

makeLoadedItem(loadingItem, msg);
*/

// TODO: State somewhere
function setBodyActive() {
  document.body.classList.add('active-upload');
}
