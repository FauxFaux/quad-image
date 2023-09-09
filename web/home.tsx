import { Component, createRef } from 'preact';
import { useEffect, useMemo } from 'preact/hooks';

import { ThumbList } from './components/thumb-list';
import { Upload } from './components/upload';
import { SignIn } from './components/sign-in';
import { driveUpload } from './locket/client';
import { Messages, printer } from './locket/err';

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
}

export class Home extends Component<{}, HomeState> {
  imRight = createRef<HTMLDivElement>();

  state: HomeState = {
    messages: [],
    uploads: [],
  };

  render(props: {}, state: Readonly<HomeState>) {
    const existing: string[] = useMemo(
      () => JSON.parse(localStorage.getItem('quadpees') ?? '[]'),
      [],
    );

    const gallery: string | undefined = useMemo(
      () => localStorage.getItem('gallery') ?? undefined,
      [],
    );

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
      ...existing.map(
        (base) =>
          ({ base, state: 'done', ctx: 'local-storage' }) as PendingItem,
      ),
    ];

    const rightCount = Math.floor((state.imRightWidth ?? 1000) / 330);
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

    return (
      <div class={'container-fluid'}>
        <div className={'row home--sign_in'}>
          <SignIn gallery={gallery} />
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
      </div>
    );
  }

  uploadWrapper = async (i: number, initial: PendingItem) => {
    try {
      await driveUpload(initial, (next: PendingItem) => {
        this.setState(({ uploads }) => {
          const newUploads = [...uploads];
          newUploads[i] = next;
          return { uploads: newUploads };
        });
      });
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
