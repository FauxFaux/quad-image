import { JSX } from 'preact';
import LoadingIcon from 'mdi-preact/LoadingIcon';

import { Printer, Upload } from './components/upload';
import { useEffect, useState } from 'preact/hooks';
import { serializeError } from 'serialize-error';
import { encodeWebP, readMagic } from './locket/resize';
import * as dssim from './locket/dssim';

interface Picked {
  blob: Blob;
  alt: string[];
  ctx: string;

  magic?: string;
  dims?: [number, number];
  images: Record<
    string,
    {
      enc?: Blob;
      comp?: number;
      elapsed?: number;
    }
  >;
}

async function loadImage(
  file: Blob,
  d: dssim.Dssim,
  cleanup: (f: () => void) => void,
) {
  const image = await createImageBitmap(file);
  cleanup(() => image.close());
  const cvs = new OffscreenCanvas(image.width, image.height);
  const ct = cvs.getContext('2d');
  ct!.drawImage(image, 0, 0);
  const arr = ct!.getImageData(0, 0, image.width, image.height);
  cvs.width = 0;
  cvs.height = 0;
  const di = dssim.createImageRgba(d, arr.data, image.width, image.height);
  cleanup(() => dssim.freeImage(di));
  return { image, di };
}

export const ImageDebug = () => {
  const [picked, setPicked] = useState<Picked | undefined>(undefined);
  const [messages, setMessages] = useState<JSX.Element[]>([]);

  const addMessage = (msg: JSX.Element) =>
    setMessages((messages) => [...messages, msg]);
  const printer: Printer = {
    error: (err) =>
      addMessage(<>crash: {JSON.stringify(serializeError(err))}</>),
    warn: (msg) => addMessage(<>warn: {msg}</>),
  };

  useEffect(() => {
    (async () => {
      const cleanup: (() => void)[] = [];

      try {
        if (!picked) return;
        const file = picked.blob;

        try {
          const magic = await readMagic(file);
          setPicked((picked) => picked && { ...picked, magic });
        } catch (err) {
          console.error('reading magic', err);
        }

        const toProduce = [0.9, 0.8, 0.7, 0.5, 0.3, 0.1].map(
          (v) => [v, 'browser webp at ' + (v ?? 'default')] as const,
        );

        setPicked(
          (picked) =>
            picked && {
              ...picked,
              images: Object.fromEntries(
                toProduce.map(([, msg]) => [msg, {}] as const),
              ),
            },
        );

        const d = dssim.create();
        cleanup.push(() => dssim.free(d));

        const { image: iOriginal, di: dOriginal } = await loadImage(
          file,
          d,
          (c) => cleanup.push(c),
        );

        setPicked(
          (picked) =>
            picked && { ...picked, dims: [iOriginal.width, iOriginal.height] },
        );
        for (const [quality, msg] of toProduce) {
          const start = performance.now();
          const enc = await encodeWebP(iOriginal, quality);
          const elapsed = performance.now() - start;
          await sleep(15);

          let comp: number;
          try {
            const cleanupsHere: (() => void)[] = [];
            const { image: iThis, di: dThis } = await loadImage(enc, d, (c) =>
              cleanupsHere.push(c),
            );
            iThis.close();

            try {
              comp = dssim.compare(d, dOriginal, dThis);
            } finally {
              for (const c of cleanupsHere) {
                c();
              }
            }
          } catch (err) {
            console.error(err);
            // TODO: printer
          }

          setPicked(
            (picked) =>
              picked && {
                ...picked,
                images: {
                  ...picked.images,
                  [msg]: {
                    enc,
                    comp,
                    elapsed,
                  },
                },
              },
          );
        }
      } catch (err) {
        console.error(err);
        // TODO: printer
      } finally {
        for (const c of cleanup) {
          try {
            c();
          } catch (err) {
            console.error('cleanup', err);
            // TODO: printer
          }
        }
      }
    })();
  }, [picked?.blob, picked?.ctx, picked?.alt]);

  const rows = [
    <div class={'row'}>
      <div className={'col'}>
        <Upload
          printer={printer}
          triggerUploads={(files: Blob[], ctx: string) => {
            addMessage(
              <>
                {files.length} items received from {ctx}, using first
              </>,
            );
            setPicked({
              blob: files[0],
              alt: [],
              ctx,
              images: {},
            });
          }}
        />
      </div>
      <div className={'col'}>
        <p>
          <button
            class={'btn btn-danger'}
            onClick={() => {
              setPicked(undefined);
              setMessages([]);
            }}
          >
            Clear
          </button>
        </p>
      </div>
    </div>,
    <div class={'row'}>
      <div className={'col'}>
        {messages.map((msg) => (
          <p>{msg}</p>
        ))}
      </div>
    </div>,
  ];

  if (picked) {
    rows.push(
      <div class={'row'}>
        <div class={'col'}>
          <Stretchy image={{ enc: picked.blob }} alt={'original'} />
        </div>
        <div class={'col'}>
          <p>Declared: {picked.blob.type}</p>
          <p>Magic: {picked.magic}</p>
          <p>
            Dims:{' '}
            {picked.dims ? (
              <>
                {picked.dims?.[0]}x{picked.dims?.[1]}
              </>
            ) : (
              '???'
            )}
          </p>
        </div>
      </div>,
    );

    rows.push(
      <div class={'row'}>
        <div class={'col'}>
          <h2>WebP</h2>
          {Object.entries(picked.images ?? {}).map(([msg, result]) =>
            result.enc ? (
              <>
                <Stretchy image={result} alt={msg} />
              </>
            ) : (
              <div style={{ float: 'left' }}>
                <LoadingIcon /> {msg}
              </div>
            ),
          )}
        </div>
      </div>,
    );
  }

  return <div class={'container-fluid'}>{rows}</div>;
};

const Size = (props: { size: number }) => {
  return (
    <abbr title={props.size.toLocaleString() + ' bytes'}>
      {(props.size / 1024 / 1024).toFixed(2)} MiB
    </abbr>
  );
};

const Stretchy = (props: { image: Picked['images'][string]; alt: string }) => {
  const res = props.image;
  const [big, setBig] = useState(false);
  return (
    <div>
      <img
        src={URL.createObjectURL(res.enc!)}
        style={{ maxWidth: big ? undefined : '500px', cursor: 'zoom-in' }}
        onClick={() => setBig((big) => !big)}
      />
      <p>
        {props.alt}: <Size size={res.enc!.size} />{' '}
        {res.comp && (
          <>
            <a href={'https://github.com/kornelski/dssim'} target={'_blank'}>
              dssim
            </a>{' '}
            error: {(100 * res.comp).toFixed(6)}%
          </>
        )}
        {res.elapsed && <>, encoded in {res.elapsed.toFixed(0)}ms</>}
      </p>
    </div>
  );
};

const sleep = async (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
