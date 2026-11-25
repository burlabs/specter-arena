import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PREVIEW_CONFIG = 'ui/vite.preview.config.ts';
export const DEV_COMMAND = ['npx', ['vite', '--config', PREVIEW_CONFIG, '--host', '127.0.0.1']];

/**
 * @typedef {(command: string, args: string[]) => { status: number | null }} Runner
 */

/** @type {Runner} */
const runInherited = (command, args) => spawnSync(command, args, { stdio: 'inherit' });

/**
 * Serves the FIXTURE preview harness with Vite's dev server.
 * @param {{ exists?: (path: string) => boolean, runner?: Runner, log?: (line: string) => void }} [options]
 * @returns {number} process exit code
 */
export function run({ exists = existsSync, runner = runInherited, log = console.log } = {}) {
  if (!exists(PREVIEW_CONFIG)) {
    log(`dev: ${PREVIEW_CONFIG} is missing; nothing to serve.`);
    return 1;
  }
  log('dev: serving the FIXTURE preview harness (not live Crew data; the backend is not started)');
  const [command, args] = DEV_COMMAND;
  return runner(/** @type {string} */ (command), /** @type {string[]} */ (args)).status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run();
}
