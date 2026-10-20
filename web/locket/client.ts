import type { EncodeResult, PendingItem } from '../upload';
import * as z from 'zod/mini';
import { ServerEventParser } from './sse';

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

// TYOOL 2026, fetch() actively discourages progress reporting on uploads
export async function driveUpload(
  initial: PendingItem,
  updateState: (next: PendingItem) => void,
  gallery?: string,
) {
  const formData = new FormData();
  {
    if (initial.state !== 'ready') {
      throw new Error(`Invalid state: ${initial.state}`);
    }
    formData.append('image', initial.file, initial.file.name);
    formData.append('ctx', initial.ctx);
    formData.append('return_json', 'true');
    if (gallery) formData.append('gallery', gallery);
  }

  const common = {
    ctx: initial.ctx,
    file: initial.file,
    stats: initial.stats,
  };
  let encodes: EncodeResult[] = [];
  updateState({ ...common, state: 'starting' });
  try {
    const base = await new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload-stream');
      xhr.responseType = 'text';
      xhr.setRequestHeader('Accept', 'text/event-stream');
      const parser = new ServerEventParser();
      let offset = 0;
      let settled = false;
      let processing = false;
      let thumbnail: string | undefined;
      let available: { id: string; url: string } | undefined;

      const cleanup = () => {
        xhr.upload.removeEventListener('progress', uploadProgress);
        xhr.removeEventListener('progress', responseProgress);
        xhr.removeEventListener('load', loaded);
        xhr.removeEventListener('error', failed);
        xhr.removeEventListener('abort', failed);
        xhr.removeEventListener('timeout', failed);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
        xhr.abort();
      };
      const uploadProgress = (event: ProgressEvent) => {
        if (settled || processing) return;
        updateState({
          ...common,
          state: 'uploading',
          progress: event.lengthComputable ? event.loaded / event.total : NaN,
        });
      };
      const readResponse = (done: boolean) => {
        if (settled) return;
        try {
          if (xhr.status !== 200) {
            // Wait for load to include the full HTTP error response body.
            if (!done) return;
            throw new Error(
              `unexpected request error: ${xhr.status}: ${xhr.statusText}: ${xhr.responseText}`,
            );
          }
          if (
            xhr.getResponseHeader('Content-Type')?.split(';')[0].trim() !==
            'text/event-stream'
          ) {
            throw new Error('Expected an SSE upload response');
          }
          const text = xhr.responseText;
          // Only consume complete lines while loading. Browsers may temporarily
          // replace an incomplete trailing UTF-8 character in responseText.
          const end = done
            ? text.length
            : Math.max(
                text.lastIndexOf('\n'),
                text.lastIndexOf('\r', text.length - 2),
              ) + 1;
          const events = parser.push(text.slice(offset, end), done);
          offset = end;
          for (const event of events) {
            const payload: unknown = JSON.parse(event.data);
            if (event.event === 'error') {
              const { message } = uploadErrorSchema.parse(payload);
              throw new Error(message);
            }
            if (event.event === 'done') {
              const { data } = uploadCompleteSchema.parse(payload);
              settled = true;
              cleanup();
              resolve(data.id);
              xhr.abort();
              return;
            }
            const status = uploadStatusSchema.parse(payload);
            processing = true;
            if (status.kind === 'thumbnail') thumbnail = status.id;
            if (status.kind === 'image') {
              available = { id: status.id, url: status.url };
            }
            if (status.kind === 'encoded') {
              encodes = [
                ...encodes,
                {
                  name: status.name,
                  bytes: status.bytes,
                  ...(status.improved !== undefined
                    ? { improved: status.improved }
                    : {}),
                },
              ];
            }
            updateState({
              ...common,
              state: 'processing',
              message: available
                ? 'Image ready, optimizing…'
                : status.kind === 'accepted'
                  ? status.message
                  : 'Upload accepted, server transcoding…',
              thumbnail,
              available,
              encodes,
            });
          }
          if (done) throw new Error('Upload stream ended before completion');
        } catch (error) {
          fail(error);
        }
      };
      const responseProgress = () => readResponse(false);
      const loaded = () => readResponse(true);
      const failed = (event: ProgressEvent) => {
        fail(new Error(`Upload ${event.type}: [opaque networking failure]`));
      };
      xhr.upload.addEventListener('progress', uploadProgress);
      xhr.addEventListener('progress', responseProgress);
      xhr.addEventListener('load', loaded);
      xhr.addEventListener('error', failed);
      xhr.addEventListener('abort', failed);
      xhr.addEventListener('timeout', failed);
      try {
        xhr.send(formData);
      } catch (error) {
        fail(error);
      }
    });
    return {
      state: 'done',
      ctx: initial.ctx,
      base,
      stats: initial.stats,
      ...(encodes.length ? { encodes } : {}),
    } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      message,
      'sending',
      initial.file.size,
      'bytes',
      initial.stats,
    );
    updateState({
      ...common,
      state: 'error',
      error: message,
      ...(encodes.length ? { encodes } : {}),
    });
    return;
  }
}

const uploadErrorSchema = z.object({ message: z.string() });
const imageIdSchema = z
  .string()
  .check(z.regex(/^e\/[a-zA-Z0-9]{10}\.(?:png|webp|jpg|gif)$/));
const uploadStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accepted'), message: z.string() }),
  z.object({ kind: z.literal('thumbnail'), id: imageIdSchema }),
  z.object({
    kind: z.literal('encoded'),
    name: z.string().check(z.regex(/^(?:q|nl)(?:100|[1-9]?\d)$/)),
    bytes: z.int().check(z.positive()),
    improved: z.optional(z.boolean()),
  }),
  z
    .object({
      kind: z.literal('image'),
      id: imageIdSchema,
      url: z.string(),
    })
    .check(z.refine((value) => value.url === `${value.id}?work-in-progress`)),
]);
const uploadCompleteSchema = z.object({
  data: z.object({
    id: imageIdSchema,
    type: z.literal('image'),
  }),
});

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
