import { Component, createRef } from 'preact';
import { useEffect } from 'preact/hooks';

import { ThumbList } from './components/thumb-list';
import { Upload } from './components/upload';
import { SignIn } from './components/sign-in';
import { driveUpload, putGallery } from './locket/client';
import { Messages, printer } from './locket/err';
import { GallerySecret } from './types';

export type OurFile = Blob & { name?: string };

export type PendingItem = { ctx: string } & (
  | { state: 'queued'; file: OurFile }
  | { state: 'starting'; file: OurFile }
  | { state: 'uploading'; progress: number; file: OurFile }
  | { state: 'done'; base: string }
  | { state: 'error'; error: string; file: OurFile }
);

interface HomeState {
  imRightWidth?: number;
  messages: ['warn' | 'error', string][];
  uploads: PendingItem[];
  pees: string[];
  configuredGallery?: GallerySecret;
  syncingNewGallery?: boolean;
}

export class Home extends Component<unknown, HomeState> {
  imRight = createRef<HTMLDivElement>();

  state: HomeState = {
    messages: [],
    uploads: [],
    pees: [],
    configuredGallery: undefined,
  };

  render(props: unknown, state: Readonly<HomeState>) {
    // copy-pasta localStorage management
    useEffect(
      () =>
        this.setState({
          pees: getLocalOr('quadpees', []),
        }),
      [],
    );
    useEffect(() => {
      // try not to corrupt existing data
      if (!Array.isArray(state.pees) || !(state.pees.length > 0)) return;
      localStorage.setItem('quadpees', JSON.stringify(state.pees));
    }, [state.pees]);

    // copy-pasta localStorage management
    useEffect(() => {
      this.setState({
        configuredGallery: localStorage.getItem('gallery') ?? undefined,
      });
    }, []);
    useEffect(() => {
      if (state.configuredGallery?.includes('!')) {
        localStorage.setItem('gallery', state.configuredGallery);
      } else {
        localStorage.removeItem('gallery');
      }
    }, [state.configuredGallery]);

    const onResize = () => {
      this.setState({
        imRightWidth: this.imRight.current?.getBoundingClientRect()?.width,
      });
    };

    useEffect(() => {
      window.addEventListener('resize', onResize);
      onResize();
      return () => window.removeEventListener('resize', onResize);
    }, []);

    // non-finished uploads, followed by real items munged to look like uploads
    const displayItems: PendingItem[] = [
      // ...(require('./mocks/thumbs').mockThumbs()),
      ...state.uploads
        .filter((u) => u.state !== 'done')
        .map((u) => u)
        .reverse(),
      ...state.pees.map(
        (base) =>
          ({ base, state: 'done', ctx: 'local-storage' }) as PendingItem,
      ),
    ];

    const rightCount = Math.floor((state.imRightWidth ?? 330) / 330);
    const displayRight = displayItems.slice(0, rightCount);
    const displayBottom = displayItems.slice(rightCount);

    const triggerUploads = (files: OurFile[], ctx: string) => {
      const additional: PendingItem[] = files.map((file) => ({
        file,
        ctx,
        state: 'queued',
      }));
      this.setState(({ uploads }) => {
        for (let i = 0; i < additional.length; ++i) {
          void this.uploadWrapper(uploads.length + i, additional[i]);
        }
        return { uploads: [...uploads, ...additional] };
      });
    };

    const setGallery = async (next: string | undefined) => {
      this.setState({ configuredGallery: next });
      if (next) {
        this.setState({ configuredGallery: next, syncingNewGallery: true });

        try {
          await putGallery(next, state.pees);
        } catch (err) {
          this.printer.error(err);
        }

        this.setState({ syncingNewGallery: false });
      }
    };

    return (
      <div class={'container-fluid'}>
        <div className={'row home--sign_in'}>
          <SignIn
            gallery={state.configuredGallery}
            setGallery={setGallery}
            syncingNewGallery={state.syncingNewGallery}
          />
        </div>
        <Messages
          messages={state.messages}
          removeMessage={(i) => {
            this.setState(({ messages }) => {
              const newMessages = [...messages];
              newMessages.splice(i, 1);
              return { messages: newMessages };
            });
          }}
        />
        <div class={'row'}>
          <div class={'col-md'}>
            <Upload printer={this.printer} triggerUploads={triggerUploads} />
          </div>
          {displayRight.length > 0 && (
            <div class={'col-md'} ref={this.imRight}>
              <ThumbList items={displayRight} />
            </div>
          )}
        </div>
        {displayBottom.length > 0 && (
          <div class={'row'}>
            <div className={'col'}>
              <ThumbList items={displayBottom} />
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

  uploadWrapper = async (i: number, initial: PendingItem) => {
    const updateState = (next: PendingItem) => {
      this.setState(({ uploads }) => {
        const newUploads = [...uploads];
        newUploads[i] = next;
        return { uploads: newUploads };
      });
    };
    try {
      const next = await driveUpload(initial, updateState);
      if (!next) return;
      const base = next.base;
      // two synchronous setState calls must be merged for no flicker
      this.setState(({ pees }) => ({ pees: [base, ...pees] }));
      updateState(next);
      if (this.state.configuredGallery) {
        await putGallery(this.state.configuredGallery, [base]);
      }
    } catch (err) {
      this.printer.error(err);
    }
  };

  printer = printer((msg) =>
    this.setState(({ messages }) => ({
      messages: [...messages, msg],
    })),
  );
}

function getLocalOr<T>(key: string, def: T): T {
  const value = localStorage.getItem(key);
  if (!value) return def;
  return JSON.parse(value);
}
