import { PendingItem } from '../home';

export async function getGallery(
  gallery: string,
): Promise<{ id: string; type: 'image' }[]> {
  const resp = await fetch(`/api/gallery/${gallery}`);
  const body: any = await resp.json();
  if (!body?.data) {
    throw new Error(`missing data in response: ${JSON.stringify(body)}`);
  }

  return body.data;
}

export function putGalleryResp(gallery: string, images: string[]) {
  return fetch('/api/gallery', {
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
}

export async function putGallery(gallery: string, images: string[]) {
  const resp = await putGalleryResp(gallery, images);
  if (!resp.ok) {
    throw new Error(`failed to call gallery: ${resp.status}`);
  }
  const body: any = await resp.json();
  if (!body?.data) {
    throw new Error(`missing data in response: ${JSON.stringify(body)}`);
  }

  return body.data;
}

export async function driveUpload(
  initial: PendingItem,
  updateState: (next: PendingItem) => void,
) {
  const formData = new FormData();
  {
    if (initial.state !== 'queued') {
      throw new Error(`Invalid state: ${initial.state}`);
    }
    formData.append('image', initial.file, initial.file.name);
    formData.append('ctx', initial.ctx);
    formData.append('return_json', 'true');
  }

  const xhr = new XMLHttpRequest();
  xhr.responseType = 'json';
  xhr.open('POST', '/api/upload');
  xhr.upload.addEventListener('progress', (e) => {
    updateState({
      state: 'uploading',
      progress: e.lengthComputable ? e.loaded / e.total : NaN,
      ctx: initial.ctx,
      file: initial.file,
    });
  });
  const code = await new Promise((resolve) => {
    xhr.addEventListener('load', () => resolve('load'));
    xhr.addEventListener('abort', () => resolve('error'));
    xhr.addEventListener('error', () => resolve('error'));
    xhr.send(formData);
    updateState({
      state: 'starting',
      file: initial.file,
      ctx: initial.ctx,
    });
  });

  if (xhr.status !== 200 || code !== 'load') {
    let msg = 'unexpected request error: ';
    if (code === 'error') {
      msg += '[opaque networking failure]';
    } else {
      msg += `${xhr.status}: ${xhr.statusText}`;
    }
    updateState({
      state: 'error',
      error: msg,
      ctx: initial.ctx,
      file: initial.file,
    });
    return;
  }

  const response = xhr.response;
  const base = response.data.id;
  return { state: 'done', ctx: initial.ctx, base } as const;
}
