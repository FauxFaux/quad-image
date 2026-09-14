import './base.css';
import './main.css';
import { render } from 'preact';
import { serializeError } from 'serialize-error';
import { Gallery } from './gallery';
import { Home } from './home';
import { EncodePreview } from './encode-preview';

export function init(element: HTMLElement, mode: string | null) {
  element.innerHTML = 'JS App booting...';
  (async () => {
    await new Promise((r) => setTimeout(r));
    element.innerHTML = '';
    if (window.location.hash.slice(1).startsWith('encodePreview=1')) {
      return render(<EncodePreview />, element);
    }
    switch (mode) {
      case 'gallery':
        return render(<Gallery />, element);
      default:
        return render(<Home />, element);
    }
  })().catch((e) => {
    console.error(e);
    // really
    element.innerHTML = `<pre>${JSON.stringify(serializeError(e), null, 2)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</pre>`;
  });
}

init(document.getElementById('app')!, document.body.getAttribute('data-mode'));
