import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist/extension',
    rollupOptions: {
      input: {
        background: 'extension/background.js',
        sidepanel: 'extension/sidepanel.html',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
})