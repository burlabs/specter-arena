import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { HOST_EXTERNALS } from './host-modules.ts';

// npm scripts run from the repo root; every path is resolved from this file so the
// build lands in ui/dist whatever the working directory.
const fromUi = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: fromUi('.'),
  plugins: [react()],
  build: {
    lib: {
      entry: fromUi('./src/mount.tsx'),
      formats: ['es'],
      fileName: () => 'index.mjs',
    },
    outDir: fromUi('./dist'),
    emptyOutDir: true,
    rollupOptions: { external: [...HOST_EXTERNALS] },
  },
  test: {
    root: fromUi('.'),
    environment: 'jsdom',
    alias: { '@kirocrew/app-sdk': fromUi('./fixtures/app-sdk.ts') },
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: [fromUi('./fixtures/vitest.setup.ts')],
    coverage: {
      provider: 'v8',
      reportsDirectory: fromUi('../coverage/ui'),
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}'],
      thresholds: { lines: 90, branches: 90 },
    },
  },
});
