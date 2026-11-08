import { defineConfig, devices } from '@playwright/test';

// Serves the built FIXTURE harness (the same ui/preview-dist the preview workflow
// uploads) rather than a dev server, so the smoke test checks the deployed artifact.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 15_000,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173/' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite preview --config ui/vite.preview.config.ts --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/',
    timeout: 30_000,
    reuseExistingServer: false,
  },
});
