import { encodeResponse } from './encode-worker-protocol';

interface EncodedImage {
  blob: Blob;
  quality?: number;
  duration?: number;
}

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (result: EncodedImage) => void; reject: (error: Error) => void }
>();

const failWorker = (error: Error) => {
  worker?.terminate();
  worker = undefined;
  for (const job of pending.values()) job.reject(error);
  pending.clear();
};

const getWorker = () => {
  if (worker) return worker;
  worker = new Worker(new URL('./encode-worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.addEventListener('message', (event: MessageEvent<unknown>) => {
    const parsed = encodeResponse.safeParse(event.data);
    if (!parsed.success) {
      failWorker(new Error('Invalid image encoder response'));
      return;
    }
    const response = parsed.data;
    const job = pending.get(response.id);
    if (!job) {
      failWorker(new Error('Unknown image encoder job'));
      return;
    }
    pending.delete(response.id);
    if (response.ok) job.resolve(response);
    else job.reject(new Error(response.error));
  });
  worker.addEventListener('error', (event) => {
    event.preventDefault();
    failWorker(new Error(event.message || 'Image encoder worker failed'));
  });
  worker.addEventListener('messageerror', () => {
    failWorker(new Error('Could not read image encoder response'));
  });
  return worker;
};

export const encodeInWorker = async (
  blob: Blob,
  originalType: string,
  options: { mode: 'wasm'; quality: number } | undefined = undefined,
): Promise<EncodedImage> => {
  const encoder = getWorker();
  const id = nextId++;
  return new Promise<EncodedImage>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      encoder.postMessage({ id, blob, originalType, ...options });
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
};
