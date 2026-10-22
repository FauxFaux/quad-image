import { afterEach, beforeEach, expect, test, vi } from 'vitest';

class TestWorker extends EventTarget {
  static instances: TestWorker[] = [];
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    super();
    TestWorker.instances.push(this);
  }
  reply(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

beforeEach(() => {
  vi.resetModules();
  TestWorker.instances = [];
  vi.stubGlobal('Worker', TestWorker);
});
afterEach(() => vi.unstubAllGlobals());

test('reuses one worker and matches responses to their jobs', async () => {
  const { encodeInWorker } =
    await import('../../web/locket/encode-worker-client');
  const blob = new Blob(['image']);
  const first = encodeInWorker(blob, 'image/png');
  const second = encodeInWorker(blob, 'image/jpeg');
  expect(TestWorker.instances).toHaveLength(1);
  const worker = TestWorker.instances[0];
  expect(worker.postMessage).toHaveBeenNthCalledWith(1, {
    id: 0,
    blob,
    originalType: 'image/png',
  });
  worker.reply({ id: 1, ok: true, blob, quality: 0.9 });
  worker.reply({ id: 0, ok: false, error: 'encode failed' });
  await expect(first).rejects.toThrow('encode failed');
  await expect(second).resolves.toMatchObject({ blob, quality: 0.9 });
});

test.each(['error', 'messageerror', 'invalid response'])(
  'rejects pending jobs and restarts after %s',
  async (failure) => {
    const { encodeInWorker } =
      await import('../../web/locket/encode-worker-client');
    const blob = new Blob(['image']);
    const first = encodeInWorker(blob, 'image/png');
    const second = encodeInWorker(blob, 'image/png');
    const rejected = Promise.allSettled([first, second]);
    const worker = TestWorker.instances[0];
    if (failure === 'invalid response') worker.reply({ unexpected: true });
    else worker.dispatchEvent(new Event(failure));
    expect((await rejected).map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    expect(worker.terminate).toHaveBeenCalledOnce();
    const retry = encodeInWorker(blob, 'image/png');
    expect(TestWorker.instances).toHaveLength(2);
    TestWorker.instances[1].reply({ id: 2, ok: true, blob });
    await expect(retry).resolves.toMatchObject({ blob });
  },
);
