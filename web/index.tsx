import './main.css';
import { render } from 'preact';
import { serializeError } from 'serialize-error';
import { Gallery } from './gallery';
import { Home } from './home';

export function init(element: HTMLElement, mode: string | null) {
  element.innerHTML = 'JS App booting...';
  (async () => {
    await new Promise((r) => setTimeout(r));
    element.innerHTML = '';
    switch (mode) {
      case 'gallery':
        return render(<Gallery />, element);
      case 'image-debug': {
        // facilitate splitting off the dssim wasm, which bundle-analyze doesn't understand
        const { ImageDebug } = await import('./image-debug');
        return render(<ImageDebug />, element);
      }
      default:
        return render(<Home />, element);
    }
  })().catch(async (e) => {
    console.error(e);
    // really
    element.innerHTML = `<pre>${JSON.stringify(serializeError(e), null, 2)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</pre>`;
  });
}

init(document.getElementById('app')!, document.body.getAttribute('data-mode'));
