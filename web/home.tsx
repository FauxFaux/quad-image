import { useEffect, useRef, useState } from 'preact/hooks';

import { ThumbList } from './components/thumb-list';
import { Upload } from './components/upload';
import { SignIn } from './components/sign-in';
import type { GalleryAddResult, Theme } from './components/sign-in';
import { driveUpload, putGallery } from './locket/client';
import { Messages, printer } from './locket/err';
import { GallerySecret, generateGallerySecret, ImageId } from './types';
import { readMagic } from './locket/resize';
import { orPrinter } from './locket/result';
import { attemptShrinkage, isLosslessFormat } from './upload';
import type { OurFile, PendingItem } from './upload';
import { addImagesToGallery, removeSelectedImages } from './gallery-actions';
import * as z from 'zod/mini';

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
