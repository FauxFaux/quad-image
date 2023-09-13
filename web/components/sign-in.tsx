import { Component, JSX } from 'preact';
import { useQuery } from 'preact-fetching';

import IconSettings from 'mdi-preact/SettingsIcon';
import CheckCircleOutlineIcon from 'mdi-preact/CheckCircleOutlineIcon';
import CircleOutlineIcon from 'mdi-preact/CircleOutlineIcon';

import { putGalleryResp } from '../locket/client';
import { plausibleGallerySecret } from '../types';

interface SignInProps {
  gallery: string | undefined;
  setGallery: (g: string | undefined) => void;
  syncingNewGallery?: boolean;
}

interface SignInState {
  configuring?: boolean;
  newGallery?: string;
}

export class SignIn extends Component<SignInProps, SignInState> {
  syncClick = async (): Promise<void> => {
    if (!plausibleGallerySecret(this.state.newGallery ?? '')) return;
    this.props.setGallery(this.state.newGallery);
    this.doneConfiguring();
  };

  doneConfiguring = () => {
    this.setState({ configuring: false, newGallery: undefined });
  };

  render(props: SignInProps, state: SignInState) {
    if (state.configuring) {
      const valid = plausibleGallerySecret(state.newGallery ?? '');

      const validations: [string, RegExp | ((s: string) => boolean)][] = [
        ['starts with an ascii letter', /^[a-z]/i],
        ['contains a !', /!/],
        ['tag is 4-10 ascii alphanumerics', /^[a-z0-9]{4,10}!/],
        ['secret is 4-99 characters', /!.{4,99}$/],
        ['matches the mystery regex', plausibleGallerySecret],
      ];
      return (
        <div className={'col home--sign_in-info'}>
          <div>
            <label>
              new backup gallery, in <i>public-name!secret passphrase</i>{' '}
              format:
              <input
                type={'text'}
                className={`form-control is-${valid ? 'valid' : 'invalid'}`}
                placeholder={'horse!battery staple'}
                onInput={(ev) => {
                  this.setState({ newGallery: (ev.target as any)?.value });
                }}
                onKeyDown={(ev) => {
                  switch (ev.key) {
                    case 'Enter':
                      this.syncClick();
                      break;
                    case 'Escape':
                      this.doneConfiguring();
                      break;
                  }
                }}
                value={state.newGallery ?? ''}
              />
            </label>
            <button
              className={'btn btn-primary'}
              disabled={!valid}
              onClick={this.syncClick}
            >
              sync
            </button>
            <button
              className={'btn btn-secondary'}
              onClick={this.doneConfiguring}
            >
              cancel
            </button>
          </div>
          <div>
            {validations.map(([msg, re]) => {
              const cand = state.newGallery ?? '';
              const valid = 'test' in re ? re.test(cand) : re(cand);
              return (
                <span
                  class={
                    'home--sign_in-validation ' +
                    (valid ? 'text-success' : 'text-danger')
                  }
                >
                  {valid ? <CheckCircleOutlineIcon /> : <CircleOutlineIcon />}{' '}
                  {msg}
                </span>
              );
            })}{' '}
          </div>
        </div>
      );
    }

    const configure = (
      <span>
        <span className={'home--sign_in-divider'}>|</span>
        <button
          className={'btn btn-secondary'}
          onClick={() => this.setState({ configuring: true })}
        >
          <IconSettings /> configure
        </button>
      </span>
    );

    const existing = props.gallery;
    if (existing) {
      const { data, isLoading, isError } = useQuery(
        `gallery-${existing}-id`,
        async () => {
          const resp = await putGalleryResp(existing, []);
          if (resp.status === 400) {
            return { valid: false } as const;
          }
          if (!resp.ok) throw new Error(`unexpected response: ${resp.status}`);
          const body = await resp.json();
          return { valid: true, id: body?.data?.id as string } as const;
        },
      );

      const id = data?.id;

      let status: JSX.Element;
      if (isLoading) {
        status = <span>backups configured, fetching gallery name</span>;
      } else if (isError) {
        status = <span>backups configured, but we're offline(?)</span>;
      } else if (!data?.valid) {
        status = <span>backups configured, but invalid</span>;
      } else {
        status = (
          <span>
            backing up to <a href={`/gallery/#${id}`}>{id}</a>
          </span>
        );
      }

      return (
        <div className={'col home--sign_in-' + (id ? 'info' : 'warn')}>
          {status}
          {props.syncingNewGallery && ' (syncing)'}
          {configure}
        </div>
      );
    }

    return (
      <div className={'col home--sign_in-warn'}>
        gallery backup: off; stored in this browser only
        {configure}
      </div>
    );
  }
}
