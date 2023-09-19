import { Component, JSX } from 'preact';
import { useQuery } from 'preact-fetching';
import { toWords } from 'number-to-words';

import IconSettings from 'mdi-preact/SettingsIcon';
import SunWirelessIcon from 'mdi-preact/SunWirelessIcon';
import ThemeLightDarkIcon from 'mdi-preact/ThemeLightDarkIcon';
import TrashCanIcon from 'mdi-preact/TrashCanIcon';
import WeatherNightIcon from 'mdi-preact/WeatherNightIcon';

import { putGalleryResp } from '../locket/client';
import { GalleryInput } from './gallery-input';

export type Theme = 'light' | 'dark' | undefined | null;

export type Prop<T> = { v: T; set: (v: T) => void };

interface SignInProps {
  gallery: Prop<string | undefined>;
  theme: Prop<Theme>;
  picking: Prop<boolean>;
  currentlyPicked?: number;
  syncingNewGallery?: boolean;
}

interface SignInState {
  configuring?: boolean;
}

export class SignIn extends Component<SignInProps, SignInState> {
  doneConfiguring = () => {
    this.props.picking.set(false);
    this.setState({ configuring: false });
  };

  render(props: SignInProps, state: SignInState) {
    if (state.configuring) {
      const galleryForm = (
        <GalleryInput
          label={
            <>
              new backup gallery, in <i>public-name!secret passphrase</i> format
            </>
          }
          submitName={'sync'}
          accept={(gallery) => {
            this.props.gallery.set(gallery);
            this.doneConfiguring();
          }}
          cancel={this.doneConfiguring}
        />
      );

      const themeView = (
        <div class={'btn-group home--sign_in-theme'}>
          <button
            type={'button'}
            class={'btn btn-secondary' + (!props.theme.v ? ' active' : '')}
            onClick={() => props.theme.set(undefined)}
          >
            <ThemeLightDarkIcon /> Auto
          </button>
          <button
            type={'button'}
            className={
              'btn btn-secondary' + (props.theme.v === 'dark' ? ' active' : ' ')
            }
            onClick={() => props.theme.set('dark')}
          >
            <WeatherNightIcon /> Dark
          </button>
          <button
            type={'button'}
            className={
              'btn btn-secondary' + (props.theme.v === 'light' ? ' active' : '')
            }
            onClick={() => props.theme.set('light')}
          >
            <SunWirelessIcon /> Light
          </button>
        </div>
      );

      let pickedActions: JSX.Element | undefined = undefined;
      if (props.picking.v) {
        let selectedImages: JSX.Element;
        const c = props.currentlyPicked ?? 0;
        switch (c) {
          case 0:
            selectedImages = <>no selected images</>;
            break;
          case 1:
            selectedImages = <>one selected image</>;
            break;
          default:
            selectedImages = <>{toWords(c)} selected images</>;
        }
        pickedActions = (
          <div>
            <GalleryInput
              accept={() => {}}
              cancel={() => {
                props.picking.set(false);
              }}
              label={<>add {selectedImages} to a gallery</>}
              submitName={'(wip) add'}
              enabled={false}
              placeholder={'husband!valley forge'}
            />
            <button className={'btn btn-danger'} disabled={true}>
              <TrashCanIcon /> (wip) remove {selectedImages} from local storage
            </button>
          </div>
        );
      }

      const pickerView = (
        <div>
          <div className="form-check form-switch form-check-inline">
            <input
              className="form-check-input"
              type="checkbox"
              role="switch"
              id="signin-pickety"
              checked={props.picking.v}
              onChange={(ev) => {
                props.picking.set(ev.currentTarget.checked);
              }}
            />
            <label className="form-check-label" htmlFor="signin-pickety">
              pick images to add to gallery, or clean-up
            </label>
          </div>
          {pickedActions}
        </div>
      );

      return (
        <div className={'row home--sign_in home--sign_in-info'}>
          <div className={'col'}>
            {galleryForm}
            <hr />
            {themeView}
            <hr />
            {pickerView}
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

    const existing = props.gallery.v;
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
