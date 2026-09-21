import { JSX } from 'preact';
import { useId, useState } from 'preact/hooks';
import { GallerySecret, plausibleGallerySecret } from '../types';
import CheckCircleOutlineIcon from 'mdi-preact/CheckCircleOutlineIcon';
import CircleOutlineIcon from 'mdi-preact/CircleOutlineIcon';
import EyeIcon from 'mdi-preact/EyeIcon';
import EyeOffIcon from 'mdi-preact/EyeOffIcon';

interface GalleryInputProps {
  accept: (gallery: GallerySecret) => void;
  cancel: () => void;
  label: JSX.Element;
  submitName: string;

  // wip?
  enabled: boolean;
  placeholder?: string;
  initialValue?: GallerySecret;
}

export function GalleryInput(props: GalleryInputProps) {
  const inputId = useId();
  const [newGallery, setNewGallery] = useState<string>(
    props.initialValue ?? '',
  );
  const [revealPassword, setRevealPassword] = useState(false);

  const valid = plausibleGallerySecret(newGallery);

  const validations: [string, RegExp | ((s: string) => boolean)][] = [
    ['starts with an ascii letter', /^[a-z]/i],
    ['contains a !', /!/],
    ['tag is 4-10 ascii alphanumerics', /^[a-z0-9]{4,10}!/],
    ['secret is 4-99 characters', /!.{4,99}$/],
    ['matches the mystery regex', plausibleGallerySecret],
  ];

  const checkAndAccept = () => {
    if (!plausibleGallerySecret(newGallery)) return;
    props.accept(newGallery);
  };

  const galleryForm = (
    <>
      <label htmlFor={inputId}>{props.label}</label>
      <div className={'input-group'}>
        <input
          id={inputId}
          type={revealPassword ? 'text' : 'password'}
          className={`form-control is-${valid ? 'valid' : 'invalid'}`}
          placeholder={props.placeholder ?? 'horse!battery staple'}
          onInput={(ev) => {
            setNewGallery(ev.currentTarget.value);
          }}
          onKeyDown={(ev) => {
            switch (ev.key) {
              case 'Enter':
                checkAndAccept();
                break;
              case 'Escape':
                props.cancel();
                break;
            }
          }}
          value={newGallery}
        />
        <button
          type={'button'}
          className={'btn btn-outline-secondary'}
          title={
            revealPassword ? 'hide gallery password' : 'reveal gallery password'
          }
          aria-label={
            revealPassword ? 'hide gallery password' : 'reveal gallery password'
          }
          aria-pressed={revealPassword}
          onClick={() => setRevealPassword((current) => !current)}
        >
          {revealPassword ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      <button
        className={'btn btn-primary'}
        disabled={!(valid && props.enabled)}
        onClick={checkAndAccept}
      >
        {props.submitName}
      </button>
      <button className={'btn btn-secondary'} onClick={props.cancel}>
        cancel
      </button>
    </>
  );
  const validationView = (
    <ul class={'home--sign_in-validation'}>
      {validations.map(([msg, re]) => {
        const cand = newGallery;
        const valid = 'test' in re ? re.test(cand) : re(cand);
        return (
          <li class={valid ? 'text-success' : 'text-danger'}>
            {valid ? <CheckCircleOutlineIcon /> : <CircleOutlineIcon />} {msg}
          </li>
        );
      })}
    </ul>
  );
  return (
    <>
      {galleryForm}
      {newGallery && validationView}
    </>
  );
}
