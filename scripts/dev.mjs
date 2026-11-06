import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PREVIEW_CONFIG = 'ui/vite.preview.config.ts';

/**
 * @param {{ exists?: (path: string) => boolean, log?: (line: string) => void }} [options]
 * @returns {number} process exit code
 */
export function run({ exists = existsSync, log = console.log } = {}) {
  if (!exists(PREVIEW_CONFIG)) {
    log('dev: the UI preview harness is not in this checkout yet; it arrives with the UI stub PR.');
    log('dev: nothing to serve. Run `npm test` to exercise the repository scripts.');
    return 0;
  }
  log(`dev: ${PREVIEW_CONFIG} exists but this dev script predates it; update scripts/dev.mjs to serve it.`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run();
}
