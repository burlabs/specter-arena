import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FIXTURE_MARKER = 'SPECTER-FIXTURE-ONLY';
export const DEFAULT_BUNDLE_DIR = 'ui/dist';

const HOST_MODULES_ASSIGNMENT = /__kirocrew_modules\s*(?:\.[\w$]+|\[[^\]]*\])?\s*=(?![=>])/;

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

/**
 * @param {string} text
 * @returns {string[]} reasons the text is fixture-contaminated
 */
export function findFixtureContent(text) {
  /** @type {string[]} */
  const reasons = [];
  if (text.includes(FIXTURE_MARKER)) reasons.push(`contains ${FIXTURE_MARKER}`);
  if (HOST_MODULES_ASSIGNMENT.test(text)) reasons.push('assigns __kirocrew_modules');
  return reasons;
}

/**
 * @param {string} dir production bundle directory
 * @returns {{ file: string, reason: string }[]}
 */
export function scanBundle(dir) {
  return listFiles(dir).flatMap((path) =>
    findFixtureContent(readFileSync(path, 'utf8')).map((reason) => ({ file: relative(dir, path), reason })),
  );
}

/**
 * @param {{ dir?: string, log?: (line: string) => void }} [options]
 * @returns {number} process exit code
 */
export function run({ dir = DEFAULT_BUNDLE_DIR, log = console.log } = {}) {
  if (!existsSync(dir)) {
    log(`check:fixtures: ${dir} not found; run the production build first`);
    return 1;
  }
  const findings = scanBundle(dir);
  for (const { file, reason } of findings) log(`check:fixtures: ${dir}/${file} ${reason}`);
  if (findings.length > 0) return 1;
  log(`check:fixtures: ${dir} ok`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run({ dir: process.argv[2] ?? DEFAULT_BUNDLE_DIR });
}
