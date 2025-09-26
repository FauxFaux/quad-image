import { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { GallerySecret, plausibleGallerySecret } from '../types';
import CheckCircleOutlineIcon from 'mdi-preact/CheckCircleOutlineIcon';
import CircleOutlineIcon from 'mdi-preact/CircleOutlineIcon';

interface GalleryInputProps {
  accept: (gallery: GallerySecret) => void;
  cancel: () => void;
  label: JSX.Element;
  submitName: string;

  // wip?
  enabled: boolean;
  placeholder?: string;
}

export function GalleryInput(props: GalleryInputProps) {
  const [newGallery, setNewGallery] = useState<string>('');

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
      <label>
        {props.label}
        <input
          type={'text'}
          className={`form-control is-${valid ? 'valid' : 'invalid'}`}
          placeholder={props.placeholder ?? 'horse!battery staple'}
          onInput={(ev) => {
            setNewGallery((ev.target as any)?.value || '');
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
      </label>
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
