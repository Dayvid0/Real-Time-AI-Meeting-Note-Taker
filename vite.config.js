import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(root, 'dist/extension');

// Static files copied verbatim into the bundle (HTML/CSS/JSON/assets).
const STATIC_ASSETS = [
  'extension/manifest.json',
  'extension/offscreen.html',
  'extension/worklet.js',
  'extension/logger.js',
  'extension/panel/panel.html',
  'extension/panel/panel.css',
  'extension/icons',
];

function copyStaticAssets() {
  return {
    name: 'meeting-notes:copy-static-assets',
    closeBundle() {
      for (const relative of STATIC_ASSETS) {
        const source = resolve(root, relative);
        if (!existsSync(source)) continue;
        const destination = resolve(outDir, relative.replace(/^extension\//, ''));
        mkdirSync(dirname(destination), { recursive: true });
        cpSync(source, destination, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  build: {
    outDir: 'dist/extension',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(root, 'extension/background.js'),
        'panel/panel': resolve(root, 'extension/panel/panel.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  plugins: [copyStaticAssets()],
});
