import { Component, createRef } from 'preact';
import { useEffect, useMemo } from 'preact/hooks';

import { ThumbList } from './components/thumb-list';
import { Upload } from './components/upload';
import { serializeError } from 'serialize-error';
import { SignIn } from './components/sign-in';

export type OurFile = Blob & { name?: string };

type PendingItem = { ctx: string } & (
  | { state: 'queued'; file: OurFile }
  | { state: 'starting' }
  | { state: 'uploading'; progress: number }
  | { state: 'done'; base: string }
  | { state: 'error'; error: Error }
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

    const rightCount = Math.floor((state.imRightWidth ?? 1000) / 330);
    const existingRight = existing.slice(0, rightCount);
    const existingBottom = existing.slice(rightCount);

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
        {state.messages.length > 0 && (
          <div class={'row'}>
            <div class={'col'}>
              {state.messages.map(([type, msg], i) => (
                <div
                  key={`warning-${i}`}
                  className={`alert alert-${
                    type === 'warn' ? 'warning' : 'danger'
                  } home--alert`}
                  role="alert"
                  onClick={() => {
                    this.setState(({ messages }) => {
                      const newMessages = [...messages];
                      newMessages.splice(i, 1);
                      return { messages: newMessages };
                    });
                  }}
                >
                  {msg}
                </div>
              ))}
            </div>
          </div>
        )}
        <div class={'row'}>
          <div class={'col-md'}>
            <Upload printer={this.printer} triggerUploads={triggerUploads} />
          </div>
          {existingRight.length > 0 && (
            <div class={'col-md'} ref={this.imRight}>
              <ThumbList items={existingRight} />
            </div>
          )}
        </div>
        {existingBottom.length > 0 && (
          <div class={'row'}>
            <div className={'col'}>
              <ThumbList items={existingBottom} />
              <div className={'util--clear'} />
            </div>
          </div>
        )}
      </div>
    );
  }

  uploadWrapper = async (i: number, initial: PendingItem) => {
    try {
      const { ctx } = initial;

      const formData = new FormData();
      {
        if (initial.state !== 'queued') {
          throw new Error(`Invalid state: ${initial.state}`);
        }
        formData.append('image', initial.file, initial.file.name);
        formData.append('ctx', initial.ctx);
        formData.append('return_json', 'true');
      }

      const updateState = (next: PendingItem) => {
        this.setState(({ uploads }) => {
          const newUploads = [...uploads];
          newUploads[i] = next;
          return { uploads: newUploads };
        });
      };

      const xhr = new XMLHttpRequest();
      xhr.responseType = 'json';
      xhr.open('POST', '/api/upload');
      xhr.upload.addEventListener('progress', (e) => {
        updateState({
          state: 'uploading',
          progress: e.lengthComputable ? e.loaded / e.total : NaN,
          ctx: ctx,
        });
      });
      await new Promise((resolve) => {
        xhr.addEventListener('loadend', resolve);
        xhr.send(formData);
        updateState({ state: 'starting', ctx: ctx });
      });

      if (xhr.status !== 200) {
        throw new Error(`Unexpected status ${xhr.status}: ${xhr.statusText}.`);
      }

      const response = xhr.response;
      updateState({ state: 'done', ctx: ctx, base: response.data.id });
    } catch (err) {
      this.printer.error(err);
    }
  };

  printer = {
    warn: (msg: string) => {
      this.setState(({ messages }) => ({
        messages: [...messages, ['warn', msg]],
      }));
    },
    error: (err: Error | unknown) => {
      console.error(err);
      this.setState(({ messages }) => ({
        messages: [
          ...messages,
          [
            'error',
            'Unexpected internal error: ' + JSON.stringify(serializeError(err)),
          ],
        ],
      }));
    },
  };
}
