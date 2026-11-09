import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIAGNOSTIC_MARKER } from './check-fixtures.mjs';

export const OVERLAY_PATH = 'probe/manifest-overlay.json';
export const DEFAULT_OUT_DIR = '.probe-app';
export const PHASES = ['v0', 'v1', 'v2'];
export const V2_EXTRA_API_ENTRY = '/api/version';
export const INSTALL_COMMAND = 'kirocrew app install';

const DIAGNOSTIC_ENTRY = 'ui/diagnostic-dist/index.mjs';
const RELEASE_ENTRY = 'ui/dist/index.mjs';

/** Paths copied into the staged app, relative to the repo root. Tests and lockfiles are never listed. */
export const COPY_LIST = ['requirements.txt', 'backend/app.py', 'backend/__init__.py', 'backend/specter_arena', 'ui/dist', 'ui/diagnostic-dist'];

const SKIPPED_NAMES = new Set(['__pycache__', 'tests', 'node_modules']);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The overlay holds the v1 shape. v0 drops the permissions, v2 adds one api entry.
 * @param {Record<string, unknown>} overlay
 * @param {string} phase
 * @returns {Record<string, any>}
 */
export function overlayForPhase(overlay, phase) {
  if (!PHASES.includes(phase)) throw new Error(`unknown phase ${phase}; expected one of ${PHASES.join(', ')}`);
  if (isRecord(overlay.backend) && 'hooks' in overlay.backend) throw new Error('the overlay must not declare backend.hooks');
  const { permissions, ...rest } = overlay;
  if (phase === 'v0') return rest;
  const granted = isRecord(permissions) ? permissions : {};
  const api = Array.isArray(granted.api) ? [...granted.api] : [];
  return { ...rest, permissions: { ...granted, api: phase === 'v2' ? [...api, V2_EXTRA_API_ENTRY] : api } };
}

/**
 * Scalar overlay keys replace, `ui.pages` are appended, `permissions` are added.
 * @param {Record<string, unknown>} base release app.json
 * @param {Record<string, unknown>} overlay
 * @returns {Record<string, any>}
 */
export function mergeManifest(base, overlay) {
  const { ui: overlayUi, permissions, ...scalars } = overlay;
  const baseUi = isRecord(base.ui) ? base.ui : {};
  const basePages = Array.isArray(baseUi.pages) ? baseUi.pages : [];
  const overlayPages = isRecord(overlayUi) && Array.isArray(overlayUi.pages) ? overlayUi.pages : [];
  return {
    ...base,
    ...scalars,
    ...(permissions === undefined ? {} : { permissions }),
    ui: { ...baseUi, pages: [...basePages, ...overlayPages] },
  };
}

/**
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function readJson(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(parsed)) throw new Error(`${path} is not a JSON object`);
  return parsed;
}

/**
 * @param {{ phase: string, root?: string, outDir?: string, log?: (line: string) => void }} options
 * @returns {number} process exit code
 */
export function stage({ phase, root = '.', outDir = DEFAULT_OUT_DIR, log = console.log }) {
  const repo = resolve(root);
  const out = resolve(repo, outDir);
  const outside = relative(repo, out);
  if (outside === '' || outside.startsWith('..') || isAbsolute(outside)) {
    log(`probe:stage: ${outDir} must be a directory inside the repository`);
    return 1;
  }
  const diagnosticEntry = join(repo, DIAGNOSTIC_ENTRY);
  if (!existsSync(join(repo, RELEASE_ENTRY))) {
    log('probe:stage: ui/dist/index.mjs not found; run npm run build first');
    return 1;
  }
  if (!existsSync(diagnosticEntry)) {
    log('probe:stage: ui/diagnostic-dist/index.mjs not found; run npm run build:diagnostic first');
    return 1;
  }
  if (!readFileSync(diagnosticEntry, 'utf8').includes(DIAGNOSTIC_MARKER)) {
    log(`probe:stage: ${DIAGNOSTIC_ENTRY} lacks ${DIAGNOSTIC_MARKER}; refusing to stage an unmarked diagnostic bundle`);
    return 1;
  }
  let manifest;
  try {
    manifest = mergeManifest(readJson(join(repo, 'app.json')), overlayForPhase(readJson(join(repo, OVERLAY_PATH)), phase));
  } catch (error) {
    log(`probe:stage: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const path of COPY_LIST) {
    mkdirSync(join(out, path, '..'), { recursive: true });
    cpSync(join(repo, path), join(out, path), {
      recursive: true,
      filter: (source) => !SKIPPED_NAMES.has(source.split(/[\\/]/).pop() ?? '') && !source.endsWith('.pyc'),
    });
  }
  writeFileSync(join(out, 'app.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(out, '.probe-enabled'), '');
  log(`probe:stage: staged phase ${phase} in ${outDir}`);
  log(`probe:stage: install it yourself with: ${INSTALL_COMMAND} ${outDir}`);
  return 0;
}

/**
 * @param {string[]} args
 * @returns {{ phase: string, outDir: string }}
 */
export function parseArgs(args) {
  const flag = args.indexOf('--phase');
  const phase = flag === -1 ? 'v0' : (args[flag + 1] ?? '');
  return { phase, outDir: DEFAULT_OUT_DIR };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = stage(parseArgs(process.argv.slice(2)));
}
