import { resolve } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import analyzer from 'vite-bundle-analyzer';

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact(), analyzer({ enabled: process.env.ANALYZE === 'true' })],

  // copied verbatim into dist/, for e.g. /dumb/ and /terms/
  publicDir: 'web/plain',

  build: {
    sourcemap: true,
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
        gallery: resolve(import.meta.dirname, 'gallery/index.html'),
      },
    },
  },

  server: {
    // the rust api server, `cargo run`
    proxy: {
      '/api': 'http://127.0.0.1:6699',
    },
  },

  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, '.lint/**'],
  },
});
