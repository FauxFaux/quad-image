import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, test, vi } from 'vitest';

import { GalleryInput } from '../../web/components/gallery-input';

describe('gallery configuration', () => {
  test('starts with the existing gallery hidden and can reveal it', () => {
    render(
      <GalleryInput
        accept={vi.fn()}
        cancel={vi.fn()}
        label={<>backup gallery</>}
        submitName={'sync'}
        enabled={true}
        initialValue={'album!secret'}
      />,
    );

    const input = screen.getByLabelText('backup gallery');
    expect(input).toHaveProperty('type', 'password');
    expect(input).toHaveProperty('value', 'album!secret');

    fireEvent.click(
      screen.getByRole('button', { name: 'reveal gallery password' }),
    );

    expect(input).toHaveProperty('type', 'text');
    screen.getByRole('button', { name: 'hide gallery password' });
  });

  test('submits the existing gallery even when it has not changed', () => {
    const accept = vi.fn();
    const { container } = render(
      <GalleryInput
        accept={accept}
        cancel={vi.fn()}
        label={<>backup gallery</>}
        submitName={'sync'}
        enabled={true}
        initialValue={'album!secret'}
      />,
    );

    const sync = container.querySelector('button.btn-primary');
    expect(sync).not.toBeNull();
    fireEvent.click(sync!);

    expect(accept).toHaveBeenCalledOnce();
    expect(accept).toHaveBeenCalledWith('album!secret');
  });
});
