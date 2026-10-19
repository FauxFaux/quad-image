import { parentPort, workerData } from 'node:worker_threads';
import { createEncoder, encode } from './webp-experiment-utils.mjs';

const encoder = await createEncoder(workerData.wasm);
parentPort.on('message', ({ rgba, width, height, variant }) => {
  try {
    const started = performance.now();
    const bytes = encode(encoder, new Uint8Array(rgba), width, height, variant);
    const encodeMs = performance.now() - started;
    // Copy out of Buffer's pooled backing store before transferring ownership.
    const owned = Uint8Array.from(bytes);
    parentPort.postMessage({ bytes: owned, encodeMs }, [owned.buffer]);
  } catch (error) {
    parentPort.postMessage({ error: String(error) });
  }
});
