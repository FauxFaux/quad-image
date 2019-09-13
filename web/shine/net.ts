import * as JSONAPI from 'jsonapi-typescript/index';
import { SavedImage, AppError } from '../types';

export async function upload(fileBlob: Blob): Promise<SavedImage> {
  const body = new FormData();
  body.append('image', fileBlob);
  body.append('return_json', 'true');

  const r = await fetch('/api/upload', {
    method: 'POST',
    body: body,
  });

  const resp = await r.json();
  if ('data' in resp) {
    const doc = resp as JSONAPI.DocWithData<JSONAPI.ResourceObject>;
    const url = doc.data.id;
    if (!url) {
      throw new AppError('empty id returned');
    }

    return url;
  } else if ('errors' in resp) {
    const doc = resp as JSONAPI.DocWithErrors;
    throw new AppError(doc.errors.join(', '));
  } else {
    throw new AppError(`unexpected object ${Object.keys(resp).join(', ')}`);
  }
}

/*
if (targetGallery) {
  addImagesToGallery(targetGallery, [url]);
}
quadpees.push(url);
localStorage.setItem('quadpees', JSON.stringify(quadpees));
 */

export async function callGallery(gallery: string, images: string[]) {
  const resp = await fetch('/api/gallery', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'gallery',
        attributes: {
          gallery,
          images,
        },
      },
    }),
  });

  return await resp.json();
}
