import { encodeImage, encodeWasmImage } from './encode-image';
import { encodeRequest, type EncodeResponse } from './encode-worker-protocol';
import { preloadWebPEncoder } from './encode';

// The page starts this worker after settling; only the worker preloads WASM.
// An encode operation will surface loading failures to its caller.
void preloadWebPEncoder().catch(() => {});

// Async decoding and canvas encoding can overlap message handlers. Serialize
// whole jobs to bound decoded memory and keep one encoder operation in flight.
let queue = Promise.resolve();
globalThis.addEventListener('message', (event: MessageEvent<unknown>) => {
  const request = encodeRequest.parse(event.data);
  queue = queue.then(async () => {
    let response: EncodeResponse;
    try {
      response = {
        id: request.id,
        ok: true,
        ...(await (request.mode === 'wasm'
          ? encodeWasmImage(request.blob, request.quality)
          : encodeImage(request.blob, request.originalType))),
      };
    } catch (error) {
      response = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    globalThis.postMessage(response);
  });
});
