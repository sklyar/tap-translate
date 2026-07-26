import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: ['safari15.4', 'ios15.4'],
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content.ts'),
      name: 'TapTranslateContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
});
