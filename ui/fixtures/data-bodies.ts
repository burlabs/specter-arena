// SPECTER-FIXTURE-ONLY: FIXTURE Data routes (data-lifecycle v1, collector-control v1) for the preview harness and unit tests; never imported by ui/src.
import type { CollectorControlV1, DataExportFileV1, DataLifecycleV1, DataRunV1 } from '../src/contracts/types.ts';
import { appApiPath } from '../src/host/paths.ts';
import { FIXTURE_NOW_MS } from './monitoring-bodies.ts';

export const DATA_SCENARIO_NAMES = [
  'data-none',
  'data',
  'data-paused',
  'data-full',
  'data-running',
  'data-interrupted',
  'data-busy',
  'data-backup-failed',
  'data-export-failed',
  'data-failure',
  'data-offline',
  'data-unsupported',
] as const;
export type DataScenarioName = (typeof DATA_SCENARIO_NAMES)[number];

const DAY_MS = 86_400_000;
const STEP_MS = 60_000;
const UPLOAD_CAP = 100;
const MAX_EXPORTS = 20;
const RETENTION_CHOICES: readonly (number | null)[] = [null, 30, 90, 180, 365];
const PURGE_CHOICES: readonly number[] = [30, 90, 180, 365];

interface Store {
  retentionDays: number | null;
  retentionChangedAtMs: number | null;
  retentionRevision: number;
  horizonMs: number | null;
  running: DataRunV1 | null;
  lastPurge: DataRunV1 | null;
  lastCleanup: DataRunV1 | null;
  stored: number;
  unused: number;
  exports: DataExportFileV1[];
  paused: boolean;
  controlRevision: number;
  controlChangedAtMs: number;
  tick: number;
}

let override: DataScenarioName | null = null;
let store: Store | null = null;
let storeFor: DataScenarioName | null = null;

export function setDataScenario(name: DataScenarioName | null): void {
  override = name;
  store = null;
  storeFor = null;
}

export function resetDataFixtures(): void {
  setDataScenario(null);
}

const isDataScenario = (value: string | null): value is DataScenarioName => DATA_SCENARIO_NAMES.some((name) => name === value);

/** The test override, else `?scenario=` on the page URL (`paused` also pauses the collector here); every other name is `data-none`. */
export function activeDataScenario(): DataScenarioName {
  if (override !== null) return override;
  const requested = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('scenario');
  if (requested === 'paused') return 'data-paused';
  return isDataScenario(requested) ? requested : 'data-none';
}

export const previewOf = (days: number): { cutoffMs: number; observations: number; quarantine: number; attempts: number } => ({
  cutoffMs: FIXTURE_NOW_MS - days * DAY_MS,
  observations: days * 40,
  quarantine: Math.floor(days / 10),
  attempts: days * 3,
});

const hex64 = (seed: number): string => {
  let out = '';
  let h = (seed * 2654435761) >>> 0;
  while (out.length < 64) {
    h = (Math.imul(h ^ (h >>> 15), 2246822519) + 3266489917) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out;
};

function exportFile(index: number, createdMs: number): DataExportFileV1 {
  // export-v9-YYYYMMDDTHHMMSSffffffZ.db: the contract pattern has twelve digits after the T.
  const stamp = new Date(createdMs).toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1000Z');
  return { fileName: `export-v9-${stamp}.db`, byteLength: 4_194_304 + index * 4096, sha256: hex64(index + 1), createdMs };
}

function run(kind: DataRunV1['kind'], state: DataRunV1['state'], cutoffMs: number, startedMs: number, deleted: Partial<DataRunV1['deleted']>): DataRunV1 {
  return {
    kind,
    state,
    cutoffMs,
    startedMs,
    endedMs: state === 'running' ? null : startedMs + 4_000,
    deleted: { observations: 0, quarantine: 0, attempts: 0, assets: 0, ...deleted },
  };
}

function seed(name: DataScenarioName): Store {
  const base: Store = {
    retentionDays: null,
    retentionChangedAtMs: null,
    retentionRevision: 0,
    horizonMs: null,
    running: null,
    lastPurge: null,
    lastCleanup: null,
    stored: 3,
    unused: 0,
    exports: [],
    paused: false,
    controlRevision: 0,
    controlChangedAtMs: FIXTURE_NOW_MS - 3 * DAY_MS,
    tick: 0,
  };
  const configured: Store = {
    ...base,
    retentionDays: 90,
    retentionChangedAtMs: FIXTURE_NOW_MS - 2 * DAY_MS,
    retentionRevision: 1,
    stored: 12,
    unused: 3,
    exports: [exportFile(1, FIXTURE_NOW_MS - DAY_MS)],
  };
  switch (name) {
    case 'data-paused':
      return { ...base, paused: true, controlRevision: 1 };
    case 'data-full':
      return { ...configured, stored: UPLOAD_CAP, unused: 4 };
    case 'data-running':
      return { ...configured, retentionDays: 30, running: run('purge', 'running', previewOf(30).cutoffMs, FIXTURE_NOW_MS - 20_000, {}) };
    case 'data-interrupted': {
      const cutoff = previewOf(90).cutoffMs;
      return { ...configured, horizonMs: cutoff, lastPurge: run('purge', 'interrupted', cutoff, FIXTURE_NOW_MS - DAY_MS, { observations: 1800, quarantine: 4 }) };
    }
    case 'data':
    case 'data-busy':
    case 'data-backup-failed':
    case 'data-export-failed': {
      const cutoff = FIXTURE_NOW_MS - 120 * DAY_MS;
      return {
        ...configured,
        horizonMs: cutoff,
        lastPurge: run('purge', 'completed', cutoff, FIXTURE_NOW_MS - 30 * DAY_MS, { observations: 5200, quarantine: 12, attempts: 410 }),
        lastCleanup: run('asset-cleanup', 'completed', FIXTURE_NOW_MS - 30 * DAY_MS, FIXTURE_NOW_MS - 30 * DAY_MS, { assets: 2 }),
      };
    }
    default:
      return base;
  }
}

const current = (): Store => {
  const name = activeDataScenario();
  if (store === null || storeFor !== name) {
    store = seed(name);
    storeFor = name;
  }
  return store;
};

const clock = (state: Store): number => {
  state.tick += 1;
  return FIXTURE_NOW_MS + state.tick * STEP_MS;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, error: string): Response => json({ contractVersion: 1, error }, status);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function viewOf(state: Store): DataLifecycleV1 {
  const last = state.exports[0] ?? null;
  return {
    contractVersion: 1,
    asOfMs: FIXTURE_NOW_MS + state.tick * STEP_MS,
    retention: { retentionDays: state.retentionDays as DataLifecycleV1['retention']['retentionDays'], changedAtMs: state.retentionChangedAtMs, revision: state.retentionRevision },
    horizonMs: state.horizonMs,
    preview: state.retentionDays === null ? null : previewOf(state.retentionDays),
    running: state.running,
    lastPurge: state.lastPurge,
    lastCleanup: state.lastCleanup,
    lastExport: last,
    uploads: { stored: state.stored, cap: UPLOAD_CAP, unused: state.unused },
    exports: state.exports.slice(0, MAX_EXPORTS),
    paused: state.paused,
  };
}

/** The failure a scenario forces on a route, or null. */
function failureFor(name: DataScenarioName, method: string, pathname: string): Promise<Response> | null {
  if (name === 'data-offline') return Promise.reject(new TypeError('Failed to fetch'));
  if (name === 'data-unsupported') return Promise.resolve(new Response(null, { status: 404 }));
  if (name === 'data-failure' && method === 'GET') return Promise.resolve(apiError(503, 'store_unavailable'));
  const lifecycleWrite = method === 'POST' && pathname !== COLLECTOR && pathname !== EXPORT;
  if (name === 'data-busy' && method !== 'GET' && pathname !== COLLECTOR) return Promise.resolve(apiError(409, 'lifecycle_busy'));
  if (name === 'data-backup-failed' && lifecycleWrite) return Promise.resolve(apiError(500, 'backup_failed'));
  if (name === 'data-export-failed' && pathname === EXPORT) return Promise.resolve(apiError(500, 'export_failed'));
  return null;
}

const ROOT = appApiPath('/data');
const RETENTION = appApiPath('/data/retention');
const PURGE = appApiPath('/data/purge');
const EXPORT = appApiPath('/data/export');
const CLEANUP = appApiPath('/data/asset-cleanup');
const COLLECTOR = appApiPath('/collector');

const hasOnlyKey = (body: unknown, key: string): body is Record<string, unknown> => isObject(body) && Object.keys(body).length === 1 && key in body;
const isEmptyBody = (body: unknown): boolean => isObject(body) && Object.keys(body).length === 0;

function putRetention(state: Store, body: unknown): Response {
  if (!hasOnlyKey(body, 'retentionDays')) return apiError(400, 'invalid_body');
  const days = body.retentionDays;
  if (days !== null && (typeof days !== 'number' || !RETENTION_CHOICES.includes(days))) return apiError(400, 'invalid_body');
  if (state.running !== null) return apiError(409, 'lifecycle_busy');
  if (days !== state.retentionDays) {
    state.retentionDays = days;
    state.retentionChangedAtMs = clock(state);
    state.retentionRevision += 1;
  }
  return json(viewOf(state));
}

function postPurge(state: Store, body: unknown): Response {
  if (!hasOnlyKey(body, 'retentionDays')) return apiError(400, 'invalid_body');
  const days = body.retentionDays;
  if (typeof days !== 'number' || !PURGE_CHOICES.includes(days)) return apiError(400, 'invalid_body');
  if (state.retentionDays === null) return apiError(409, 'retention_not_set');
  if (days !== state.retentionDays) return apiError(409, 'retention_mismatch');
  if (state.running !== null) return apiError(409, 'lifecycle_busy');
  const preview = previewOf(days);
  const startedMs = clock(state);
  state.lastPurge = run('purge', 'completed', preview.cutoffMs, startedMs, { observations: preview.observations, quarantine: preview.quarantine, attempts: preview.attempts });
  state.horizonMs = Math.max(state.horizonMs ?? 0, preview.cutoffMs);
  return json(viewOf(state));
}

function postExport(state: Store, body: unknown): Response {
  if (!isEmptyBody(body)) return apiError(400, 'invalid_body');
  if (state.running !== null) return apiError(409, 'lifecycle_busy');
  state.exports = [exportFile(state.exports.length + 2, clock(state)), ...state.exports].slice(0, MAX_EXPORTS);
  return json(viewOf(state));
}

function postCleanup(state: Store, body: unknown): Response {
  if (!isEmptyBody(body)) return apiError(400, 'invalid_body');
  if (state.running !== null) return apiError(409, 'lifecycle_busy');
  const startedMs = clock(state);
  state.lastCleanup = run('asset-cleanup', 'completed', startedMs - 3_600_000, startedMs, { assets: state.unused });
  state.stored -= state.unused;
  state.unused = 0;
  return json(viewOf(state));
}

function postCollector(state: Store, body: unknown): Response {
  if (!hasOnlyKey(body, 'paused') || typeof body.paused !== 'boolean') return apiError(400, 'invalid_body');
  // Idempotent: the same value answers 200 with the revision and time unchanged.
  if (body.paused !== state.paused) {
    state.paused = body.paused;
    state.controlRevision += 1;
    state.controlChangedAtMs = clock(state);
  }
  const control: CollectorControlV1 = {
    contractVersion: 1,
    paused: state.paused,
    revision: state.controlRevision,
    changedAtMs: state.controlChangedAtMs,
    state: state.paused ? 'paused' : 'running',
  };
  return json(control);
}

const ROUTES: ReadonlyArray<{ method: 'GET' | 'POST'; path: string; handle: (state: Store, body: unknown) => Response }> = [
  { method: 'GET', path: ROOT, handle: (state) => json(viewOf(state)) },
  { method: 'POST', path: RETENTION, handle: putRetention },
  { method: 'POST', path: PURGE, handle: postPurge },
  { method: 'POST', path: EXPORT, handle: postExport },
  { method: 'POST', path: CLEANUP, handle: postCleanup },
  { method: 'POST', path: COLLECTOR, handle: postCollector },
];

/** Null for any path that is not a Data or collector route, so the caller can fall through. */
export function dataResponse(pathname: string, method: 'GET' | 'POST', body?: unknown): Promise<Response> | null {
  const onPath = ROUTES.filter((route) => route.path === pathname);
  if (onPath.length === 0) return null;
  const failure = failureFor(activeDataScenario(), method, pathname);
  if (failure !== null) return failure;
  const route = onPath.find((candidate) => candidate.method === method);
  if (route === undefined) return Promise.resolve(apiError(405, 'invalid_body'));
  return Promise.resolve(route.handle(current(), body));
}
