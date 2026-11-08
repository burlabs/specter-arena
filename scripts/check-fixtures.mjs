import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FIXTURE_MARKER = 'SPECTER-FIXTURE-ONLY';
export const DEFAULT_BUNDLE_DIR = 'ui/dist';
export const DEFAULT_BACKEND_DIR = 'backend';

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

const TEST_OR_FIXTURE_IMPORT = /^\s*(?:from\s+\S*\b(?:tests?|fixtures?)\b\S*\s+import|import\s+\S*\b(?:tests?|fixtures?)\b)/m;

/**
 * @param {string} text Python source
 * @returns {boolean} whether the module imports from a tests or fixtures module
 */
export function importsTestCode(text) {
  return TEST_OR_FIXTURE_IMPORT.test(text);
}

/**
 * The backend files Crew runs: `app.py` and the runtime package, never `tests/`.
 * @param {string} dir backend directory
 * @returns {string[]} paths relative to `dir`
 */
export function backendRuntimeFiles(dir) {
  const app = join(dir, 'app.py');
  const runtime = join(dir, 'specter_arena');
  return [
    ...(existsSync(app) ? [app] : []),
    ...(existsSync(runtime) ? listFiles(runtime) : []),
  ]
    .filter((path) => path.endsWith('.py'))
    .map((path) => relative(dir, path));
}

/**
 * @param {string} dir backend directory
 * @returns {{ file: string, reason: string }[]}
 */
export function scanBackend(dir) {
  return backendRuntimeFiles(dir)
    .filter((file) => importsTestCode(readFileSync(join(dir, file), 'utf8')))
    .map((file) => ({ file, reason: 'imports from a tests or fixtures module' }));
}

/**
 * @param {{ dir?: string, backendDir?: string, log?: (line: string) => void }} [options]
 * @returns {number} process exit code
 */
export function run({ dir = DEFAULT_BUNDLE_DIR, backendDir = DEFAULT_BACKEND_DIR, log = console.log } = {}) {
  if (!existsSync(dir)) {
    log(`check:fixtures: ${dir} not found; run the production build first`);
    return 1;
  }
  const findings = [
    ...scanBundle(dir).map(({ file, reason }) => `${dir}/${file} ${reason}`),
    ...scanBackend(backendDir).map(({ file, reason }) => `${backendDir}/${file} ${reason}`),
  ];
  for (const finding of findings) log(`check:fixtures: ${finding}`);
  if (findings.length > 0) return 1;
  log(`check:fixtures: ${dir} and ${backendDir} runtime ok`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run({ dir: process.argv[2] ?? DEFAULT_BUNDLE_DIR });
}
