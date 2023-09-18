import { Component, JSX } from 'preact';
import { useQuery } from 'preact-fetching';

import IconSettings from 'mdi-preact/SettingsIcon';
import CheckCircleOutlineIcon from 'mdi-preact/CheckCircleOutlineIcon';
import CircleOutlineIcon from 'mdi-preact/CircleOutlineIcon';

import { putGalleryResp } from '../locket/client';
import { plausibleGallerySecret } from '../types';
import ThemeLightDarkIcon from 'mdi-preact/ThemeLightDarkIcon';
import WeatherNightIcon from 'mdi-preact/WeatherNightIcon';
import SunWirelessIcon from 'mdi-preact/SunWirelessIcon';

export type Theme = 'light' | 'dark' | undefined | null;

interface SignInProps {
  gallery: string | undefined;
  setGallery: (g: string | undefined) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  syncingNewGallery?: boolean;
}

interface SignInState {
  configuring?: boolean;
  newGallery?: string;
}

export class SignIn extends Component<SignInProps, SignInState> {
  syncClick = () => {
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
      const galleryForm = (
        <div>
          <label>
            new backup gallery, in <i>public-name!secret passphrase</i> format:
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
      );
      const validationView = (
        <ul class={'home--sign_in-validation'}>
          {validations.map(([msg, re]) => {
            const cand = state.newGallery ?? '';
            const valid = 'test' in re ? re.test(cand) : re(cand);
            return (
              <li class={valid ? 'text-success' : 'text-danger'}>
                {valid ? <CheckCircleOutlineIcon /> : <CircleOutlineIcon />}{' '}
                {msg}
              </li>
            );
          })}
        </ul>
      );
      const themeView = (
        <div class={'btn-group home--sign_in-theme'}>
          <button
            type={'button'}
            class={'btn btn-secondary' + (!props.theme ? ' active' : '')}
            onClick={() => props.setTheme(undefined)}
          >
            <ThemeLightDarkIcon /> Auto
          </button>
          <button
            type={'button'}
            className={
              'btn btn-secondary' + (props.theme === 'dark' ? ' active' : ' ')
            }
            onClick={() => props.setTheme('dark')}
          >
            <WeatherNightIcon /> Dark
          </button>
          <button
            type={'button'}
            className={
              'btn btn-secondary' + (props.theme === 'light' ? ' active' : '')
            }
            onClick={() => props.setTheme('light')}
          >
            <SunWirelessIcon /> Light
          </button>
        </div>
      );
      return (
        <div className={'row home--sign_in home--sign_in-info'}>
          <div className={'col'}>
            {galleryForm}
            {validationView}
            <hr />
            {themeView}
            <hr />
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
        <div
          className={
            'row home--sign_in home--sign_in-' + (id ? 'info' : 'warn')
          }
        >
          <div className={'col'}>
            {status}
            {props.syncingNewGallery && ' (syncing)'}
            {configure}
          </div>
        </div>
      );
    }

    return (
      <div className={'row home--sign_in home--sign_in-warn'}>
        <div className={'col'}>
          gallery backup: off; stored in this browser only
          {configure}
        </div>
      </div>
    );
  }
}
