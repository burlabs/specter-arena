import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const fromUi = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The FIXTURE harness is a normal app build with React bundled in, kept apart from the
// ui/dist library bundle. A relative base lets the same output serve from /pr-<n>/.
export default defineConfig({
  root: fromUi('./preview'),
  base: './',
  plugins: [react()],
  resolve: { alias: { '@kirocrew/app-sdk': fromUi('./fixtures/app-sdk.ts') } },
  build: {
    outDir: fromUi('./preview-dist'),
    emptyOutDir: true,
  },
  preview: { port: 4173, strictPort: true },
});
