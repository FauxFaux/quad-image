import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { driveUpload } from '../../web/locket/client';
import { ServerEventParser } from '../../web/locket/sse';
import type { PendingItem } from '../../web/upload';

const initial: PendingItem = {
  state: 'ready',
  ctx: 'picked',
  file: new File(['image bytes'], 'picture.png'),
  stats: { originalSize: 11, originalType: 'image/png', used: 'original' },
};
const accepted =
  'event: status\ndata: {"kind":"accepted","message":"Transcoding…"}\n\n';
const complete =
  'event: done\ndata: {"data":{"id":"e/abcdefghij.webp","type":"image"}}\n\n';

class FakeRequest extends EventTarget {
  static latest: FakeRequest;
  upload = new EventTarget();
  status = 200;
  statusText = 'OK';
  responseText = '';
  responseType = '';
  contentType = 'text/event-stream; charset=utf-8';
  open = vi.fn();
  setRequestHeader = vi.fn();
  getResponseHeader = vi.fn(() => this.contentType);
  send = vi.fn<(body: FormData) => void>();
  abort = vi.fn(() => this.dispatchEvent(new ProgressEvent('abort')));

  constructor() {
    super();
    FakeRequest.latest = this;
  }

  progress(text: string) {
    this.responseText = text;
    this.dispatchEvent(new ProgressEvent('progress'));
  }

  load(text: string) {
    this.responseText = text;
    this.dispatchEvent(new ProgressEvent('load'));
  }
}

beforeEach(() => vi.stubGlobal('XMLHttpRequest', FakeRequest));
afterEach(() => vi.unstubAllGlobals());

describe('streaming upload', () => {
  test('reports upload percentages and processing before completion arrives', async () => {
    const updates: PendingItem[] = [];
    const upload = driveUpload(
      initial,
      (next) => updates.push(next),
      'album!secret',
    );
    const xhr = FakeRequest.latest;
    expect(xhr.open).toHaveBeenCalledWith('POST', '/api/upload-stream');
    expect(xhr.responseType).toBe('text');
    expect(xhr.setRequestHeader).toHaveBeenCalledWith(
      'Accept',
      'text/event-stream',
    );
    const form = xhr.send.mock.calls[0][0];
    expect(form.get('gallery')).toBe('album!secret');
    expect(form.get('ctx')).toBe('picked');
    expect(form.get('image')).toBeInstanceOf(File);

    xhr.upload.dispatchEvent(
      new ProgressEvent('progress', {
        lengthComputable: true,
        loaded: 25,
        total: 100,
      }),
    );
    expect(updates.at(-1)).toMatchObject({
      state: 'uploading',
      progress: 0.25,
    });
    xhr.upload.dispatchEvent(new ProgressEvent('progress'));
    expect(updates.at(-1)).toMatchObject({ state: 'uploading', progress: NaN });
    xhr.upload.dispatchEvent(
      new ProgressEvent('progress', {
        lengthComputable: true,
        loaded: 100,
        total: 100,
      }),
    );
    expect(updates.at(-1)).toMatchObject({ state: 'uploading', progress: 1 });

    xhr.progress(accepted.slice(0, 17));
    expect(updates.at(-1)?.state).toBe('uploading');
    xhr.progress(accepted);
    expect(updates.at(-1)).toMatchObject({
      state: 'processing',
      message: 'Transcoding…',
      stats: initial.stats,
    });
    const count = updates.length;
    xhr.progress(accepted);
    xhr.upload.dispatchEvent(new ProgressEvent('progress'));
    expect(updates).toHaveLength(count);

    xhr.progress(accepted + complete);
    expect(await upload).toEqual({
      state: 'done',
      base: 'e/abcdefghij.webp',
      ctx: 'picked',
      stats: initial.stats,
    });
    expect(xhr.abort).toHaveBeenCalledOnce();
    xhr.load(accepted + complete);
    xhr.upload.dispatchEvent(new ProgressEvent('progress'));
    expect(updates).toHaveLength(count);
  });

  test('drains final response text on load even without response progress events', async () => {
    const update = vi.fn<(next: PendingItem) => void>();
    const upload = driveUpload(initial, update);
    FakeRequest.latest.load(accepted + complete);
    expect((await upload)?.base).toBe('e/abcdefghij.webp');
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'processing' }),
    );
  });

  test('waits for complete lines before consuming possibly incomplete UTF-8 text', async () => {
    const update = vi.fn<(next: PendingItem) => void>();
    const upload = driveUpload(initial, update);
    const xhr = FakeRequest.latest;
    xhr.progress(
      'event: status\ndata: {"kind":"accepted","message":"Transcoding\uFFFD',
    );
    expect(update).toHaveBeenCalledOnce();
    xhr.progress(accepted);
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'Transcoding…' }),
    );
    xhr.load(accepted + complete);
    expect((await upload)?.base).toBe('e/abcdefghij.webp');
  });

  test.each([
    [
      'server error',
      'event: error\ndata: {"message":"Encoding failed"}\n\n',
      'Encoding failed',
    ],
    ['interrupted stream', accepted, 'ended before completion'],
    ['invalid JSON', 'event: done\ndata: nope\n\n', 'JSON'],
    [
      'invalid payload',
      complete.replace('e/abcdefghij.webp', '../unsafe'),
      'Invalid',
    ],
    [
      'incomplete terminal event',
      complete.trimEnd(),
      'ended before completion',
    ],
  ])('reports %s with file and stats', async (_name, text, message) => {
    const update = vi.fn<(next: PendingItem) => void>();
    const upload = driveUpload(initial, update);
    FakeRequest.latest.load(text);
    expect(await upload).toBeUndefined();
    const last = update.mock.calls.at(-1)?.[0];
    expect(last).toMatchObject({
      state: 'error',
      file: initial.file,
      stats: initial.stats,
    });
    if (last?.state !== 'error') throw new Error('Expected error state');
    expect(last.error).toContain(message);
    expect(FakeRequest.latest.abort).toHaveBeenCalledOnce();
  });

  test.each(['error', 'abort', 'timeout'])(
    'reports request %s',
    async (event) => {
      const update = vi.fn<(next: PendingItem) => void>();
      const upload = driveUpload(initial, update);
      FakeRequest.latest.dispatchEvent(new ProgressEvent(event));
      expect(await upload).toBeUndefined();
      const last = update.mock.calls.at(-1)?.[0];
      if (last?.state !== 'error') throw new Error('Expected error state');
      expect(last.error).toContain(`Upload ${event}`);
      FakeRequest.latest.load(complete);
      expect(update).toHaveBeenCalledTimes(2);
    },
  );

  test('reports HTTP errors after reading their full body', async () => {
    const update = vi.fn<(next: PendingItem) => void>();
    const upload = driveUpload(initial, update);
    const xhr = FakeRequest.latest;
    xhr.status = 400;
    xhr.statusText = 'Bad Request';
    xhr.progress('no image');
    expect(update).toHaveBeenCalledOnce();
    xhr.load('no image provided');
    expect(await upload).toBeUndefined();
    const last = update.mock.calls.at(-1)?.[0];
    if (last?.state !== 'error') throw new Error('Expected error state');
    expect(last.error).toContain('400: Bad Request: no image provided');
  });

  test('cleans up when send throws synchronously', async () => {
    class ThrowingRequest extends FakeRequest {
      override send = vi.fn<(body: FormData) => void>(() => {
        throw new Error('Cannot send request');
      });
    }
    vi.stubGlobal('XMLHttpRequest', ThrowingRequest);
    const update = vi.fn<(next: PendingItem) => void>();
    expect(await driveUpload(initial, update)).toBeUndefined();
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ error: 'Cannot send request' }),
    );
    expect(FakeRequest.latest.abort).toHaveBeenCalledOnce();
    FakeRequest.latest.load(complete);
    expect(update).toHaveBeenCalledTimes(2);
  });

  test('rejects a successful HTTP response with the wrong content type', async () => {
    const update = vi.fn<(next: PendingItem) => void>();
    const upload = driveUpload(initial, update);
    FakeRequest.latest.contentType = 'application/json';
    FakeRequest.latest.load('{}');
    expect(await upload).toBeUndefined();
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ error: 'Expected an SSE upload response' }),
    );
  });
});

test('SSE parser handles split CRLF, Unicode, comments, multiple events and data lines', () => {
  const text =
    ': keepalive\r\nevent: status\r\ndata: héllo\r\ndata: world\r\n\r\n' +
    complete;
  const parser = new ServerEventParser();
  const events = [];
  for (const char of text) events.push(...parser.push(char));
  events.push(...parser.push('', true));
  expect(events).toEqual([
    { event: 'status', data: 'héllo\nworld' },
    {
      event: 'done',
      data: '{"data":{"id":"e/abcdefghij.webp","type":"image"}}',
    },
  ]);
});
