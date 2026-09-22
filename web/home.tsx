import { useEffect, useRef, useState } from 'preact/hooks';

import { ThumbList } from './components/thumb-list';
import { Upload } from './components/upload';
import { GalleryAddResult, SignIn, Theme } from './components/sign-in';
import { driveUpload, putGallery } from './locket/client';
import { Messages, printer } from './locket/err';
import { GallerySecret, generateGallerySecret, ImageId } from './types';
import { readMagic } from './locket/resize';
import { encodeWebP, encodeWebPLossless } from './locket/encode';
import { orPrinter } from './locket/result';
import * as z from 'zod/mini';
import ensureError from 'ensure-error';

export type OurFile = Blob & { name?: string };

/** what we did to the file before sending it; for on-device debugging */
export interface UploadStats {
  /** what the browser handed us */
  originalSize: number;
  /** the format we sniffed out of the original, not what it claimed */
  originalType: string;
  /** the smallest encode we managed, if we tried to encode at all */
  resizedSize?: number;
  /** the webp quality of a lossy encode; absent for a lossless encode */
  quality?: number;
  /** which of the two we actually put on the wire */
  used: 'resized' | 'original';
}

export type PendingItem = { ctx: string; stats?: UploadStats } & (
  | { state: 'queued'; file: OurFile }
  | { state: 'resizing'; file: OurFile }
  | { state: 'ready'; file: OurFile }
  | { state: 'starting'; file: OurFile }
  | { state: 'uploading'; progress: number; file: OurFile }
  | { state: 'done'; base: string }
  | { state: 'error'; error: string; file: OurFile }
);

export function Home() {
  const [messages, setMessages] = useState<['warn' | 'error', string][]>([]);
  const [uploads, setUploads] = useState<PendingItem[]>([]);
  const [pees, setPees] = useState<string[]>(() => getLocalOrEmpty('quadpees'));
  const [configuredGallery, setConfiguredGallery] = useState<
    GallerySecret | undefined
  >(() => localStorage.getItem('gallery') ?? generateGallerySecret());
  const [syncingNewGallery, setSyncingNewGallery] = useState<
    boolean | undefined
  >(undefined);
  const [configuredTheme, setConfiguredTheme] = useState<Theme | undefined>(
    undefined,
  );
  const [picking, setPicking] = useState<Record<ImageId, boolean> | undefined>(
    undefined,
  );
  useEffect(() => {
    localStorage.setItem('quadpees', JSON.stringify(pees));
  }, [pees]);

  useEffect(() => {
    if (configuredGallery?.includes('!')) {
      localStorage.setItem('gallery', configuredGallery);
    } else {
      localStorage.removeItem('gallery');
    }
  }, [configuredGallery]);

  const reprocessTheme = () => {
    document.body.setAttribute(
      'data-theme',
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

  const uploadWrapper = async (i: number, initial: PendingItem) => {
    const updateState = (next: PendingItem) => {
      setUploads((uploads) => {
        const newUploads = [...uploads];
        newUploads[i] = next;
        return newUploads;
      });
    };
    let next: PendingItem | undefined = initial;
    if ('queued' !== next?.state) {
      throw new Error('should be in starting state');
    }

    const magic = await readMagic(next.file);
    const originalType = magic ?? next.file.type ?? 'unknown';

    if (
      next.file.size > shrinkThreshold ||
      magic === 'image/heic' ||
      isLosslessFormat(originalType)
    ) {
      next = {
        ...next,
        state: 'resizing',
      };
      updateState(next);

      next = await attemptShrinkage(next, originalType);
      updateState(next);
    } else {
      next = {
        ...next,
        state: 'ready',
        stats: {
          originalSize: next.file.size,
          originalType,
          used: 'original',
        },
      };
    }

    next = await driveUpload(next, updateState, configuredGallery);
    if (!next) return;
    const base = next.base;
    // two synchronous setState calls must be merged for no flicker
    setPees((pees) => [...pees, base]);
    updateState(next);
  };

  const printerRef = useRef(
    printer((msg) => setMessages((messages) => [...messages, msg])),
  );

  // uploads from this session keep their stats, so prefer them over the
  // (identical looking, but stats-less) local-storage entry for the same image
  const doneUploads = uploads.flatMap((u) => (u.state === 'done' ? [u] : []));
  const thisSession = new Set(doneUploads.map((u) => u.base));

  // non-finished uploads, followed by real items munged to look like uploads
  const displayItems: PendingItem[] = [
    // ...(require('./mocks/thumbs').mockThumbs()),
    ...uploads
      .filter((u) => u.state !== 'done')
      .map((u) => u)
      .reverse(),
    ...doneUploads.reverse(),
    ...pees
      .filter((base) => !thisSession.has(base))
      .map((base): PendingItem => ({
        base,
        state: 'done',
        ctx: 'local-storage',
      }))
      .reverse(),
  ];

  const triggerUploads = (files: OurFile[], ctx: string) => {
    const additional: PendingItem[] = files.map((file) => ({
      file,
      ctx,
      state: 'queued',
    }));
    setUploads((currentUploads) => {
      for (let i = 0; i < additional.length; ++i) {
        orPrinter(
          async () => uploadWrapper(currentUploads.length + i, additional[i]),
          printerRef.current,
        );
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
      } finally {
        setSyncingNewGallery(false);
      }
    }
  };

  const setTheme = (newTheme: Theme) => setConfiguredTheme(newTheme);

  const setPickingState = (pickingEnabled: boolean) =>
    setPicking(pickingEnabled ? {} : undefined);

  const removePicked = () => {
    if (!picking) return;
    const selected = new Set(
      Object.entries(picking).flatMap(([image, picked]) =>
        picked ? [image] : [],
      ),
    );
    setPees((current) => removeSelectedImages(current, selected));
    setUploads((current) =>
      current.filter(
        (upload) => upload.state !== 'done' || !selected.has(upload.base),
      ),
    );
    setPicking({});
  };

  const addPicked = async (gallery: string): Promise<GalleryAddResult> => {
    const selected = Object.entries(picking ?? {}).flatMap(([image, picked]) =>
      picked ? [image] : [],
    );
    return addImagesToGallery(gallery, selected);
  };

  const pickingProp = {
    v: picking,
    set: (newPicking: Record<ImageId, boolean> | undefined) => {
      setPicking(newPicking);
    },
  };

  return (
    <div class={'container-fluid'}>
      <SignIn
        gallery={{
          v: configuredGallery,
          set: (e) => orPrinter(async () => setGallery(e), printerRef.current),
        }}
        syncGallery={(gallery) =>
          orPrinter(async () => setGallery(gallery), printerRef.current)
        }
        theme={{ v: configuredTheme, set: setTheme }}
        picking={{ v: picking !== undefined, set: setPickingState }}
        currentlyPicked={Object.values(picking ?? {}).filter(Boolean).length}
        addPicked={addPicked}
        removePicked={removePicked}
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
      <div class={'home--image-grid'}>
        <div class={'home--upload-grid'}>
          <Upload
            printer={printerRef.current}
            triggerUploads={triggerUploads}
          />
        </div>
        <ThumbList items={displayItems} picking={pickingProp} />
      </div>
      <div className={'util--clear'} />
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

const peesSchema = z.array(z.string());

export function removeSelectedImages(
  images: string[],
  selected: ReadonlySet<string>,
): string[] {
  return images.filter((image) => !selected.has(image));
}

export async function addImagesToGallery(
  gallery: string,
  images: string[],
  galleryPut = putGallery,
): Promise<GalleryAddResult> {
  const results = await Promise.allSettled(
    images.map(async (image) => ({
      image,
      gallery: await galleryPut(gallery, [image]),
    })),
  );

  const failures: GalleryAddResult['failures'] = [];
  let added = 0;
  let publicGallery: string | undefined;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      added++;
      publicGallery = result.value.gallery.id;
    } else {
      failures.push({
        image: images[index],
        error: ensureError(result.reason).message,
      });
    }
  });
  return { added, publicGallery, failures };
}

function getLocalOrEmpty(key: string): string[] {
  const value = localStorage.getItem(key);
  if (!value) return [];
  return peesSchema.parse(JSON.parse(value));
}

function userWantsLight() {
  try {
    return window.matchMedia('(prefers-color-scheme: light)')?.matches;
  } catch {
    return false;
  }
}

const attemptShrinkage = async (
  next: PendingItem,
  originalType: string,
): Promise<PendingItem> => {
  if (next.state !== 'resizing') {
    throw new Error(`invalid state: ${next.state}`);
  }
  const original = next.file;

  await unblock();
  // firefox rejects with a bare, stackless InvalidStateError for anything it
  // can't decode (heic, tiff, ...), so say what we were holding at the time
  const image = await createImageBitmap(original).catch((cause: unknown) => {
    throw new Error(`cannot decode ${originalType} (${original.size} bytes)`, {
      cause,
    });
  });

  let quality: number | undefined;

  let resized;
  try {
    if (isLosslessFormat(originalType)) {
      await unblock();
      resized = await encodeWebPLossless(image);
    }

    // Small lossless images are worth preserving exactly. Larger ones fall
    // through to the existing quality-based encoding strategy.
    if (!resized || resized.size > shrinkThreshold) {
      await unblock();
      quality = 0.8;
      resized = await encodeWebP(image, quality);

      if (resized.size > 5 * 1024 * 1024) {
        resized = undefined;
        await unblock();
        quality = 0.5;
        resized = await encodeWebP(image, quality);
      }

      if (resized.size > 9 * 1024 * 1024) {
        resized = undefined;
        await unblock();
        quality = 0.2;
        resized = await encodeWebP(image, quality);
      }
    }
  } finally {
    image.close();
  }

  await unblock();
  const saveAtLeast = 0.1; // 0.1 = 10%
  const worthIt = resized.size < original.size * (1 - saveAtLeast);

  const stats: UploadStats = {
    originalSize: original.size,
    originalType,
    resizedSize: resized.size,
    quality,
    used: worthIt ? 'resized' : 'original',
  };

  console.log('resize', stats);

  return {
    ...next,
    state: 'ready',
    file: worthIt ? resized : original,
    stats,
  };
};

const shrinkThreshold = 1024 * 1024;

// GIF is excluded: it can be losslessly encoded, but decoding it to an
// ImageBitmap would discard animation. PNG is the lossless still-image format
// accepted by the uploader.
const isLosslessFormat = (type: string) => type === 'image/png';

const unblock = async () => sleep(15);

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
