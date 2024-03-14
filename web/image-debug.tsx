import { Printer, Upload } from './components/upload';
import { useState } from 'preact/hooks';
import { serializeError } from 'serialize-error';
import { encodeWebP, readMagic } from './locket/resize';
import { JSX } from 'preact';

export const ImageDebug = (props: {}) => {
  const [messages, setMessages] = useState<JSX.Element[]>([]);
  const addMessage = (msg: JSX.Element) =>
    setMessages((messages) => [...messages, msg]);
  const printer: Printer = {
    error: (err) =>
      addMessage(<>crash: {JSON.stringify(serializeError(err))}</>),
    warn: (msg) => addMessage(<>warn: {msg}</>),
  };

  console.log('rendering with', messages);

  const handle = (files: Blob[], ctx: string) => {
    addMessage(
      <>
        {files.length} items from {ctx}
      </>,
    );
    for (let i = 0; i < files.length; ++i) {
      (async () => {
        const file = files[i];
        let magic;
        try {
          magic = await readMagic(file);
        } catch (err) {
          console.error(err);
          magic = 'error reading magic: ' + err;
        }

        const images: JSX.Element[] = [
          <Stretchy src={file} alt={'original'} />,
        ];
        try {
          const image = await createImageBitmap(file);
          try {
            for (const quality of [undefined, 1, 0.8, 0.6, 0.4, 0.2]) {
              const enc = await encodeWebP(image, quality);
              images.push(
                <Stretchy
                  src={enc}
                  alt={'browser webp at ' + (quality ?? 'default')}
                />,
              );
            }
          } finally {
            image.close();
          }
        } catch (err) {
          console.error(err);
          images.push(
            <>
              error opening or encoding: {JSON.stringify(serializeError(err))}
            </>,
          );
        }

        addMessage(
          <p>
            <p>
              {i + 1}. {file.name}, declared {file.type}, magic: {magic}
            </p>
            {images}
          </p>,
        );
      })().catch((err) => printer.error(err));
    }
  };

  return (
    <div class={'container-fluid'}>
      <div class={'row'}>
        <div class={'col'}>
          <Upload printer={printer} triggerUploads={handle} />
        </div>
      </div>
      <div class={'row'}>
        <div class={'col'}>
          {messages.map((msg) => (
            <p>{msg}</p>
          ))}
        </div>
      </div>
    </div>
  );
};

const Size = (props: { size: number }) => {
  return (
    <abbr title={props.size.toLocaleString() + ' bytes'}>
      {(props.size / 1024 / 1024).toFixed(2)} MiB
    </abbr>
  );
};

const Stretchy = (props: { src: Blob; alt: string }) => {
  const [big, setBig] = useState(false);
  return (
    <div style={{ float: 'left' }}>
      <img
        src={URL.createObjectURL(props.src)}
        style={{ maxWidth: big ? undefined : '500px', cursor: 'zoom-in' }}
        onClick={() => setBig((big) => !big)}
      />
      <p>
        {props.alt}: <Size size={props.src.size} />
      </p>
    </div>
  );
};
