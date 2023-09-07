import './main.css';

export function init(element: HTMLElement, mode: string | null) {
  element.innerHTML = 'JS App booting...';
  (async () => {
    const { render } = await import('preact');
    await new Promise((r) => setTimeout(r));
    element.innerHTML = '';
    switch (mode) {
      case 'gallery':
        const { Gallery } = await import('./gallery');
        return render(<Gallery />, element);
      default:
        const { Home } = await import('./home');
        return render(<Home />, element);
    }
  })().catch(async (e) => {
    const { serializeError } = await import('serialize-error');
    console.error(e);
    // really
    element.innerHTML = `<pre>${JSON.stringify(serializeError(e), null, 2)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</pre>`;
  });
}

init(document.getElementById('app')!, document.body.getAttribute('data-mode'));
