import { useEffect, useRef, useState } from 'preact/hooks';
import { Upload } from './components/upload';
import { Messages, printer } from './locket/err';
import { canvasSupportsWebP, encodeWebPUsingCanvas } from './locket/encode';
import { encodeWebPUsingWasm } from './locket/webp-wasm';

const qualities = [0.8, 0.5, 0.2];

interface EncodedPreview {
  size: number;
  duration: number;
  url: string;
}

interface QualityPreview {
  quality: number;
  canvas: EncodedPreview;
  wasm: EncodedPreview;
}

export function EncodePreview() {
  const [file, setFile] = useState<Blob | undefined>(undefined);
  const [previews, setPreviews] = useState<QualityPreview[]>([]);
  const [webpWarning, setWebpWarning] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<['warn' | 'error', string][]>([]);
  const printerRef = useRef(
    printer((message) => setMessages((current) => [...current, message])),
  );

  useEffect(() => {
    if (!file) return;

    let cancelled = false;
    const outputUrls: string[] = [];
    setPreviews([]);
    setWebpWarning(undefined);

    void (async () => {
      const image = await createImageBitmap(file);
      try {
        if (!(await canvasSupportsWebP())) {
          if (!cancelled) {
            setWebpWarning(
              'This browser cannot encode WebP with canvas, so there is no WebP preview.',
            );
          }
          return;
        }

        const nextPreviews: QualityPreview[] = [];
        for (const quality of qualities) {
          await sleep(15);
          const canvasStart = performance.now();
          const canvasWebp = await encodeWebPUsingCanvas(image, quality);
          const canvasDuration = performance.now() - canvasStart;
          if (cancelled) return;
          await sleep(15);
          const wasmStart = performance.now();
          const wasmWebp = await encodeWebPUsingWasm(image, quality);
          const wasmDuration = performance.now() - wasmStart;
          if (cancelled) return;

          const canvasUrl = URL.createObjectURL(canvasWebp);
          const wasmUrl = URL.createObjectURL(wasmWebp);
          outputUrls.push(canvasUrl, wasmUrl);
          nextPreviews.push({
            quality,
            canvas: {
              size: canvasWebp.size,
              duration: canvasDuration,
              url: canvasUrl,
            },
            wasm: { size: wasmWebp.size, duration: wasmDuration, url: wasmUrl },
          });
        }
        if (!cancelled) setPreviews(nextPreviews);
      } finally {
        image.close();
      }
    })().catch((error: unknown) => {
      if (!cancelled) {
        printerRef.current.error(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });

    return () => {
      cancelled = true;
      for (const url of outputUrls) URL.revokeObjectURL(url);
    };
  }, [file]);

  return (
    <main class={'container-fluid encode-preview'}>
      <h1>Encode preview</h1>
      <Messages
        messages={messages}
        removeMessage={(index) =>
          setMessages((current) => current.filter((_, i) => i !== index))
        }
      />
      <Upload
        printer={printerRef.current}
        triggerUploads={(files) => setFile(files[0])}
      />
      {file && (
        <>
          <p class={'encode-preview--original'}>
            Original: {humanSize(file.size)}
          </p>
          {webpWarning && (
            <div class={'alert alert-warning'} role="alert">
              {webpWarning}
            </div>
          )}
          {previews.map((preview) => (
            <div class={'row encode-preview--images'} key={preview.quality}>
              <section class={'col-md'}>
                <h2>
                  Canvas q{preview.quality} ({humanSize(preview.canvas.size)},{' '}
                  {humanDuration(preview.canvas.duration)})
                </h2>
                <img
                  src={preview.canvas.url}
                  alt={`Canvas WebP q${preview.quality} preview`}
                />
              </section>
              <section class={'col-md'}>
                <h2>
                  WASM q{preview.quality} ({humanSize(preview.wasm.size)},{' '}
                  {humanDuration(preview.wasm.duration)})
                </h2>
                <img
                  src={preview.wasm.url}
                  alt={`WASM WebP q${preview.quality} preview`}
                />
              </section>
            </div>
          ))}
        </>
      )}
    </main>
  );
}

const humanSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${Math.round(bytes / 1024)}kB`;

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const humanDuration = (milliseconds: number) => `${Math.round(milliseconds)}ms`;
