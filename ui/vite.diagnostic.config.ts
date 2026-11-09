// SPECTER-DIAGNOSTIC-ONLY: builds the dev-only diagnostic bundle outside ui/dist.
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { HOST_EXTERNALS } from './host-modules.ts';

const fromUi = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: fromUi('.'),
  plugins: [react()],
  build: {
    lib: {
      entry: fromUi('./src/diagnostic/entry.tsx'),
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    outDir: fromUi('./diagnostic-dist'),
    emptyOutDir: true,
    rollupOptions: { external: [...HOST_EXTERNALS] },
  },
});
