import { Component } from 'preact';
import { useQuery } from 'preact-fetching';

import IconSettings from 'mdi-preact/SettingsIcon';

interface SignInProps {
  gallery: string | undefined;
}

interface SignInState {
  configuring?: boolean;
}

export class SignIn extends Component<SignInProps, SignInState> {
  render(props: SignInProps, state: SignInState) {
    if (state.configuring) {
      return (
        <div className={'col home--sign_in-info'}>
          <div>
            <label>
              new backup gallery, in <i>public-name!secret passphrase</i>{' '}
              format:
              <input
                type={'text'}
                className={'form-control'}
                placeholder={'horse!battery staple'}
              />
            </label>
            <button className={'btn btn-primary'}>sync</button>
            <button
              className={'btn btn-secondary'}
              onClick={() => {
                this.setState({ configuring: false });
              }}
            >
              cancel
            </button>
          </div>
        </div>
      );
    }

    const configure = (
      <span>
        <span className={'home--sign_in-divider'}>|</span>
        <button
          className={'btn btn-dark'}
          onClick={() => this.setState({ configuring: true })}
        >
          <IconSettings /> configure
        </button>
      </span>
    );

    const existing = props.gallery;
    if (existing) {
      const { data } = useQuery(`gallery-${existing}-id`, async () =>
        callGallery(existing, []),
      );

      const id = data?.id;

      const status = id ? (
        <span>
          backing up to <a href={`/gallery/${id}`}>{id}</a>
        </span>
      ) : (
        <span>backups configured but we're offline</span>
      );

      return (
        <div className={'col home--sign_in-' + (id ? 'info' : 'warn')}>
          {status}
          {configure}
        </div>
      );
    }

    return (
      <div className={'col home--sign_in-warn'}>
        Gallery backup: off; stored in this browser only
        {configure}
      </div>
    );
  }
}

async function callGallery(gallery: string, images: string[]) {
  const resp = await fetch('/api/gallery', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'gallery',
        attributes: {
          gallery,
          images,
        },
      },
    }),
  });
  if (!resp.ok) {
    throw new Error(`failed to call gallery: ${resp.status}`);
  }
  const body: any = await resp.json();
  if (!body?.data) {
    throw new Error(`missing data in response: ${JSON.stringify(body)}`);
  }

  return body.data;
}
