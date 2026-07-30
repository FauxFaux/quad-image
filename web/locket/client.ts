import { PendingItem } from '../home';
import * as z from 'zod/mini';

export async function getGallery(
  gallery: string,
): Promise<GalleryResponse['data']> {
  const resp = await fetch(`/api/gallery/${gallery}`);
  const body: unknown = await resp.json();
  if (!isGalleryResponse(body)) {
    throw new Error(`missing data in response: ${JSON.stringify(body)}`);
  }

  return body.data;
}

export async function putGalleryResp(gallery: string, images: string[]) {
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
  const body: unknown = await resp.json();
  if (!isResourceObjectResponse(body)) {
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
    if (initial.state !== 'ready') {
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
      stats: initial.stats,
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
      stats: initial.stats,
    });
  });

  if (xhr.status !== 200 || code !== 'load') {
    let msg = 'unexpected request error: ';
    msg += `${xhr.status}: ${xhr.statusText}`;
    if (code === 'error') {
      msg += ' + [opaque networking failure]';
    }

    // the tile shows msg and the stats separately, but the console wants both
    console.error(msg, 'sending', initial.file.size, 'bytes', initial.stats);

    updateState({
      state: 'error',
      error: msg,
      ctx: initial.ctx,
      file: initial.file,
      stats: initial.stats,
    });
    return;
  }

  const response: any = xhr.response;
  const base: any = response.data.id;
  return {
    state: 'done',
    ctx: initial.ctx,
    base,
    stats: initial.stats,
  } as const;
}

const resourceObjectSchema = z.object({
  id: z.string(),
  type: z.string(),
});

const resourceObjectResponseSchema = z.object({
  data: resourceObjectSchema,
});

const galleryResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      type: z.literal('image'),
    }),
  ),
});

type ResourceObjectResponse = z.infer<typeof resourceObjectResponseSchema>;
type GalleryResponse = z.infer<typeof galleryResponseSchema>;

function isResourceObjectResponse(obj: unknown): obj is ResourceObjectResponse {
  try {
    resourceObjectResponseSchema.parse(obj);
    return true;
  } catch (e) {
    console.error('invalid resource object response', e, obj);
    return false;
  }
}

function isGalleryResponse(body: unknown): body is GalleryResponse {
  try {
    galleryResponseSchema.parse(body);
    return true;
  } catch (e) {
    console.error('invalid gallery response', e, body);
    return false;
  }
}
