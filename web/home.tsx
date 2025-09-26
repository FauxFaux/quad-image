import { useEffect, useRef, useState } from 'preact/hooks';

import { ThumbList } from './components/thumb-list';
import { Upload } from './components/upload';
import { SignIn, Theme } from './components/sign-in';
import { driveUpload, putGallery } from './locket/client';
import { Messages, printer } from './locket/err';
import { GallerySecret, ImageId } from './types';
import { encodeWebP, readMagic } from './locket/resize';

export type OurFile = Blob & { name?: string };

export type PendingItem = { ctx: string } & (
  | { state: 'queued'; file: OurFile }
  | { state: 'resizing'; file: OurFile }
  | { state: 'ready'; file: OurFile; originalSize: number | undefined }
  | { state: 'starting'; file: OurFile }
  | { state: 'uploading'; progress: number; file: OurFile }
  | { state: 'done'; base: string }
  | { state: 'error'; error: string; file: OurFile }
);

export function Home() {
  const imRight = useRef<HTMLDivElement>(null);
  const [imRightWidth, setImRightWidth] = useState<number | undefined>(
    undefined,
  );
  const [messages, setMessages] = useState<['warn' | 'error', string][]>([]);
  const [uploads, setUploads] = useState<PendingItem[]>([]);
  const [pees, setPees] = useState<string[]>([]);
  const [configuredGallery, setConfiguredGallery] = useState<
    GallerySecret | undefined
  >(undefined);
  const [syncingNewGallery, setSyncingNewGallery] = useState<
    boolean | undefined
  >(undefined);
  const [configuredTheme, setConfiguredTheme] = useState<Theme | undefined>(
    undefined,
  );
  const [picking, setPicking] = useState<Record<ImageId, boolean> | undefined>(
    undefined,
  );
  // copy-pasta localStorage management
  useEffect(() => {
    setPees(getLocalOr('quadpees', []));
  }, []);

  useEffect(() => {
    // try not to corrupt existing data
    if (!Array.isArray(pees) || !(pees.length > 0)) return;
    localStorage.setItem('quadpees', JSON.stringify(pees));
  }, [pees]);

  // copy-pasta localStorage management
  useEffect(() => {
    setConfiguredGallery(localStorage.getItem('gallery') ?? undefined);
  }, []);

  useEffect(() => {
    if (configuredGallery?.includes('!')) {
      localStorage.setItem('gallery', configuredGallery);
    } else {
      localStorage.removeItem('gallery');
    }
  }, [configuredGallery]);

  const reprocessTheme = () => {
    document.body.setAttribute(
      'data-bs-theme',
      configuredTheme ?? (userWantsLight() ? 'light' : 'dark'),
    );
  };

  useEffect(() => {
    const configuredTheme = localStorage.getItem('theme') as Theme;
    setConfiguredTheme(configuredTheme);

    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handle = () => reprocessTheme();
    mq?.addEventListener('change', handle);
    return () => mq?.removeEventListener('change', handle);
  }, []);

  useEffect(() => {
    reprocessTheme();
    if (configuredTheme) {
      localStorage.setItem('theme', configuredTheme);
    } else {
      localStorage.removeItem('theme');
    }
  }, [configuredTheme]);

  const onResize = () => {
    setImRightWidth(imRight.current?.getBoundingClientRect()?.width);
  };

  useEffect(() => {
    window.addEventListener('resize', onResize);
    // massive hack, but failure isn't critical
    setTimeout(onResize, 0);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const uploadWrapper = async (i: number, initial: PendingItem) => {
    const updateState = (next: PendingItem) => {
      setUploads((uploads) => {
        const newUploads = [...uploads];
        newUploads[i] = next;
        return newUploads;
      });
    };
    try {
      let next: PendingItem | undefined = initial;
      if ('queued' !== next?.state) {
        throw new Error('should be in starting state');
      }

      const magic = await readMagic(next.file);

      if (next.file.size > 1024 * 1024 || magic === 'image/heic') {
        next = {
          ...next,
          state: 'resizing',
        };
        updateState(next);

        next = await attemptShrinkage(next);
        updateState(next);
      } else {
        next = {
          ...next,
          state: 'ready',
          originalSize: undefined,
        };
      }

      next = await driveUpload(next, updateState);
      if (!next) return;
      const base = next.base;
      // two synchronous setState calls must be merged for no flicker
      setPees((pees) => [...pees, base]);
      updateState(next);
      if (configuredGallery) {
        await putGallery(configuredGallery, [base]);
      }
    } catch (err) {
      printerRef.current.error(err);
    }
  };

  const printerRef = useRef(
    printer((msg) => setMessages((messages) => [...messages, msg])),
  );

  // non-finished uploads, followed by real items munged to look like uploads
  const displayItems: PendingItem[] = [
    // ...(require('./mocks/thumbs').mockThumbs()),
    ...uploads
      .filter((u) => u.state !== 'done')
      .map((u) => u)
      .reverse(),
    ...pees
      .map(
        (base) =>
          ({ base, state: 'done', ctx: 'local-storage' }) as PendingItem,
      )
      .reverse(),
  ];

  const rightCount = Math.floor((imRightWidth ?? 330) / 330);
  const displayRight = displayItems.slice(0, rightCount);
  const displayBottom = displayItems.slice(rightCount);

  const triggerUploads = (files: OurFile[], ctx: string) => {
    const additional: PendingItem[] = files.map((file) => ({
      file,
      ctx,
      state: 'queued',
    }));
    setUploads((currentUploads) => {
      for (let i = 0; i < additional.length; ++i) {
        void uploadWrapper(currentUploads.length + i, additional[i]);
      }
      return [...currentUploads, ...additional];
    });
  };

  const setGallery = async (next: string | undefined) => {
    setConfiguredGallery(next);
    if (next) {
      setConfiguredGallery(next);
      setSyncingNewGallery(true);

      try {
        await putGallery(next, pees);
      } catch (err) {
        printerRef.current.error(err);
      }

      setSyncingNewGallery(false);
    }
  };

  const setTheme = (newTheme: Theme) => setConfiguredTheme(newTheme);

  const setPickingState = (pickingEnabled: boolean) =>
    setPicking(pickingEnabled ? {} : undefined);

  const pickingProp = {
    v: picking,
    set: (newPicking: Record<ImageId, boolean> | undefined) => {
      setPicking(newPicking);
    },
  };

  return (
    <div class={'container-fluid'}>
      <SignIn
        gallery={{ v: configuredGallery, set: setGallery }}
        theme={{ v: configuredTheme, set: setTheme }}
        picking={{ v: picking !== undefined, set: setPickingState }}
        currentlyPicked={Object.values(picking ?? {}).filter(Boolean).length}
        syncingNewGallery={syncingNewGallery}
      />
      <Messages
        messages={messages}
        removeMessage={(i) => {
          setMessages((currentMessages) => {
            const newMessages = [...currentMessages];
            newMessages.splice(i, 1);
            return newMessages;
          });
        }}
      />
      <div class={'row'}>
        <div class={'col-md'}>
          <Upload
            printer={printerRef.current}
            triggerUploads={triggerUploads}
          />
        </div>
        {displayRight.length > 0 && (
          <div class={'col-md'} ref={imRight}>
            <ThumbList items={displayRight} picking={pickingProp} />
          </div>
        )}
      </div>
      {displayBottom.length > 0 && (
        <div class={'row'}>
          <div className={'col'}>
            <ThumbList items={displayBottom} picking={pickingProp} />
            <div className={'util--clear'} />
          </div>
        </div>
      )}
      <div class={'row'}>
        <footer>
          <p className="text-center text-body-secondary">
            <a href={'/terms/'}>t&amp;cs</a>
          </p>
        </footer>
      </div>
    </div>
  );
}

function getLocalOr<T>(key: string, def: T): T {
  const value = localStorage.getItem(key);
  if (!value) return def;
  return JSON.parse(value);
}

function userWantsLight() {
  try {
    return window.matchMedia('(prefers-color-scheme: light)')?.matches;
  } catch {
    return false;
  }
}

const attemptShrinkage = async (next: PendingItem): Promise<PendingItem> => {
  if (next.state !== 'resizing') {
    throw new Error(`invalid state: ${next.state}`);
  }
  const original = next.file;

  await unblock();
  const image = await createImageBitmap(original);

  let resized;
  try {
    await unblock();
    resized = await encodeWebP(image, 0.8);

    if (resized.size > 5 * 1024 * 1024) {
      resized = undefined;
      await unblock();
      resized = await encodeWebP(image, 0.5);
    }

    if (resized.size > 9 * 1024 * 1024) {
      resized = undefined;
      await unblock();
      resized = await encodeWebP(image, 0.2);
    }
  } finally {
    image.close();
  }

  await unblock();
  const saveAtLeast = 0.1; // 0.1 = 10%
  if (resized.size > original.size * (1 - saveAtLeast)) {
    resized = original;
  }

  return {
    ...next,
    state: 'ready',
    file: resized.size < original.size * 0.9 ? resized : original,
    originalSize: original.size,
  };
};

const unblock = async () => sleep(15);

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
