import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIAGNOSTIC_MARKER, OWN_API_ENTRY } from './check-fixtures.mjs';

export const OVERLAY_PATH = 'probe/manifest-overlay.json';
export const DEFAULT_OUT_DIR = '.probe-app';
export const PHASES = ['v0', 'v1', 'v2', 'v3'];
/**
 * Phases that read their grants from another overlay file. v3 is the narrow 0.13.0 set (exact `=` entries).
 * @type {Record<string, string>}
 */
export const OVERLAY_BY_PHASE = { v3: 'probe/manifest-overlay-v3.json' };
export const V2_EXTRA_API_ENTRY = '/api/version';
export const INSTALL_COMMAND = 'kirocrew app install';
export const RUN_OPTIONS_FILE = '.probe-run.json';
/** Never staged: the probe app must not carry the product store (RS-12, V2.1-8). */
export const EXCLUDED_PATHS = ['backend/specter_arena/store', 'backend/specter_arena/store_runtime.py'];
const HOST_VERSION = /^\d+\.\d+\.\d+$/;
/** One opt-in probe step id; the backend's probe/options.py applies the same pattern and a 8-entry cap. */
const STEP_ID = /^[a-z][a-z0-9-]{0,40}$/;
const MAX_EXTRA_STEPS = 8;
/** Flag, run-option key and inclusive range; the backend's probe/options.py applies the same ranges. */
const NUMBER_FLAGS = [
  { flag: '--capture-seconds', key: 'captureSeconds', low: 1, high: 900 },
  { flag: '--reconnect-after-start', key: 'reconnectAfterStartSeconds', low: 1, high: 120 },
];

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
 * The overlay holds the v1 shape. Every phase keeps the app's own-namespace api entry
 * (the browser SDK rejects the app's own proxy path otherwise). v0 adds nothing else,
 * v1 adds the probe grants, v2 adds one more api entry.
 * @param {Record<string, unknown>} overlay
 * @param {string} phase
 * @returns {Record<string, any>}
 */
export function overlayForPhase(overlay, phase) {
  if (!PHASES.includes(phase)) throw new Error(`unknown phase ${phase}; expected one of ${PHASES.join(', ')}`);
  if (isRecord(overlay.backend) && 'hooks' in overlay.backend) throw new Error('the overlay must not declare backend.hooks');
  const { permissions, ...rest } = overlay;
  if (phase === 'v0') return { ...rest, permissions: { api: [OWN_API_ENTRY] } };
  const granted = isRecord(permissions) ? permissions : {};
  const probeApi = (Array.isArray(granted.api) ? granted.api : []).filter((entry) => entry !== OWN_API_ENTRY);
  const api = [OWN_API_ENTRY, ...probeApi, ...(phase === 'v2' ? [V2_EXTRA_API_ENTRY] : [])];
  return { ...rest, permissions: { ...granted, api } };
}

/**
 * Scalar overlay keys replace, `ui` keys replace (the 0.12.0 dashboard router gives a third-party
 * app the single route `/apps/:name`, so the probe page takes over the release page's route),
 * `permissions` are added, and the release `agents` list is dropped.
 * @param {Record<string, unknown>} base release app.json
 * @param {Record<string, unknown>} overlay
 * @returns {Record<string, any>}
 */
export function mergeManifest(base, overlay) {
  const { ui: overlayUi, permissions, ...scalars } = overlay;
  const baseUi = isRecord(base.ui) ? base.ui : {};
  /** @type {Record<string, any>} */
  const merged = {
    ...base,
    ...scalars,
    ...(permissions === undefined ? {} : { permissions }),
    ui: { ...baseUi, ...(isRecord(overlayUi) ? overlayUi : {}) },
  };
  // The staged probe copies no `agents/` directory, so an agent list in any overlay stays behind.
  delete merged.agents;
  return merged;
}

/**
 * The staged `.probe-run.json` content from the stage flags, or null when the phase needs none.
 * v1 and v2 need a host version; v0 may omit it only when it sets no other option.
 * @param {string} phase
 * @param {Record<string, string | undefined>} flags raw flag values by flag name
 * @returns {Record<string, string | number | string[]> | null}
 */
export function runOptions(phase, flags) {
  /** @type {Record<string, string | number | string[]>} */
  const options = {};
  const version = flags['--host-version'];
  if (version !== undefined) {
    if (!HOST_VERSION.test(version)) throw new Error(`--host-version must look like 0.12.2, got ${version}`);
    options.hostVersion = version;
  }
  for (const { flag, key, low, high } of NUMBER_FLAGS) {
    const raw = flags[flag];
    if (raw === undefined) continue;
    const value = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(value) || value < low || value > high) {
      throw new Error(`${flag} must be a number from ${low} to ${high}, got ${raw}`);
    }
    options[key] = value;
  }
  const extra = flags['--extra-steps'];
  if (extra !== undefined) {
    const ids = extra.split(',');
    if (ids.length > MAX_EXTRA_STEPS || !ids.every((id) => STEP_ID.test(id))) {
      throw new Error(`--extra-steps must be up to ${MAX_EXTRA_STEPS} comma-separated step ids, got ${extra}`);
    }
    options.extraSteps = ids;
  }
  if (Object.keys(options).length === 0 && phase === 'v0') return null;
  if (version === undefined) throw new Error(`phase ${phase} needs --host-version (read it with kirocrew --version)`);
  return options;
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
 * @param {{ phase: string, flags?: Record<string, string | undefined>, root?: string, outDir?: string, log?: (line: string) => void }} options
 * @returns {number} process exit code
 */
export function stage({ phase, flags = {}, root = '.', outDir = DEFAULT_OUT_DIR, log = console.log }) {
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
  let options;
  try {
    manifest = mergeManifest(readJson(join(repo, 'app.json')), overlayForPhase(readJson(join(repo, OVERLAY_BY_PHASE[phase] ?? OVERLAY_PATH)), phase));
    options = runOptions(phase, flags);
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
      filter: (source) => {
        const name = source.split(/[\\/]/).pop() ?? '';
        const path = relative(repo, source).split(/[\\/]/).join('/');
        return !SKIPPED_NAMES.has(name) && !source.endsWith('.pyc') && !EXCLUDED_PATHS.includes(path);
      },
    });
  }
  writeFileSync(join(out, 'app.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(out, '.probe-enabled'), '');
  if (options !== null) writeFileSync(join(out, RUN_OPTIONS_FILE), `${JSON.stringify(options, null, 2)}\n`);
  log(`probe:stage: staged phase ${phase} in ${outDir}`);
  log(`probe:stage: install it yourself with: ${INSTALL_COMMAND} ${outDir}`);
  return 0;
}

/**
 * @param {string[]} args
 * @returns {{ phase: string, flags: Record<string, string | undefined>, outDir: string }}
 */
export function parseArgs(args) {
  /** @param {string} name */
  const value = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : (args[index + 1] ?? '');
  };
  const flags = Object.fromEntries(['--host-version', ...NUMBER_FLAGS.map(({ flag }) => flag)].map((name) => [name, value(name)]));
  // Kept off the flag map unless given, so the map keeps the shape it had before the v3 phase.
  if (value('--extra-steps') !== undefined) flags['--extra-steps'] = value('--extra-steps');
  return { phase: value('--phase') ?? 'v0', flags, outDir: DEFAULT_OUT_DIR };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = stage(parseArgs(process.argv.slice(2)));
}
