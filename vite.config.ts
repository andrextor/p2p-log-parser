import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'P2PLogParser',
      fileName: 'p2p-log-parser',
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@checkout': resolve(__dirname, 'src/checkout'),
      '@rest': resolve(__dirname, 'src/rest'),
      '@common': resolve(__dirname, 'src/common'),
      '@types': resolve(__dirname, 'src/types'),
      '@utils': resolve(__dirname, 'src/utils'),
      '@test': resolve(__dirname, 'test'),
    },
  },
});
