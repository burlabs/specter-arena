// SPECTER-FIXTURE-ONLY: FIXTURE Specter routes for the preview harness and unit tests; never imported by ui/src.
import { appApiPath } from '../src/host/paths.ts';
import type { PortraitAssetV1, SpecterProfileV1, SpecterV1, SummoningV1 } from '../src/contracts/types.ts';
import { PERF_SPECTER_NAMES, canonicalArenaScenario } from './arena-scenarios.ts';

export const SPECTER_SCENARIO_NAMES = ['specters-none', 'specters', 'specters-empty', 'summon-failure', 'asset-failed', 'long-names', 'arena-perf-specters'] as const;
export type SpecterScenarioName = (typeof SPECTER_SCENARIO_NAMES)[number];

const FIXTURE_NOW_MS = 1794916800000;
const BINDING_LIMIT = 5;
const INSTALL_LIMIT = 20;
const WINDOW_MS = 86_400_000;
const PROMPT_VERSION = 'summon-1';
const MAX_UPLOAD_CHARS = 1_398_104;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const bindingIdOf = (n: number): string => `bnd_${'a'.repeat(20)}${n.toString(16).padStart(4, '0')}`;
const BINDING_ID = /^bnd_[0-9a-f]{24}$/;
const REQUEST_ID = /^req_[0-9a-f]{24}$/;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: readonly number[]): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: readonly number[]): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const be32 = (value: number): number[] => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];

function chunk(type: string, data: readonly number[]): number[] {
  const body = [...type].map((char) => char.charCodeAt(0)).concat(data);
  return [...be32(data.length), ...body, ...be32(crc32(body))];
}

/**
 * A valid, uncompressed RGBA PNG of one colour, built in code so no binary literal sits in a source file.
 * One stored deflate block holds at most 65,535 bytes, so `height * (width * 4 + 1)` must stay below it.
 */
export function solidPng(red: number, green: number, blue: number, width = 8, height = width): string {
  const row = [0, ...Array.from({ length: width }, () => [red, green, blue, 255]).flat()];
  const raw = Array.from({ length: height }, () => row).flat();
  const length = raw.length;
  if (length > 0xffff) throw new RangeError(`solidPng: ${width} x ${height} does not fit one stored deflate block`);
  const stored = [0x78, 0x01, 0x01, length & 0xff, length >> 8, ~length & 0xff, (~length >> 8) & 0xff, ...raw, ...be32(adler32(raw))];
  const header = [...be32(width), ...be32(height), 8, 6, 0, 0, 0];
  const bytes = [...PNG_SIGNATURE, ...chunk('IHDR', header), ...chunk('IDAT', stored), ...chunk('IEND', [])];
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.slice(start, start + 8192));
  return btoa(binary);
}

const hashHex = (text: string): string => {
  let out = '';
  for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b1]) {
    let h = seed;
    for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out;
};

interface StoredAsset {
  meta: PortraitAssetV1;
  data: string;
}

const makeAsset = (data: string, origin: 'bundled' | 'uploaded', label: string): StoredAsset => ({
  data,
  meta: {
    contractVersion: 1,
    assetId: `ast_${hashHex(data).slice(0, 24)}`,
    mediaType: 'image/png',
    width: 8,
    height: 8,
    byteLength: Math.floor((data.length * 3) / 4),
    origin,
    label,
    dataBase64: null,
  },
});

const BUNDLED: readonly StoredAsset[] = [
  makeAsset(solidPng(150, 90, 220), 'bundled', 'Violet portrait'),
  makeAsset(solidPng(70, 170, 190), 'bundled', 'Teal portrait'),
  makeAsset(solidPng(220, 150, 70), 'bundled', 'Amber portrait'),
];

const LONG_TEXT = 'A patient watcher who keeps a slow, careful ledger of small things and repeats them aloud until they feel true. '.repeat(3).trim();

const profileOf = (name: string, extra: Partial<SpecterProfileV1> = {}): SpecterProfileV1 => ({
  contractVersion: 1,
  name,
  epithet: null,
  personality: 'Quiet, exact and slightly amused.',
  appearance: 'A thin figure in a pale coat, edges of the sleeves fraying into mist.',
  mannerism: 'Tilts its head before answering.',
  signatureAction: null,
  assignmentRationale: 'Its careful pace suits how this bot works.',
  artBrief: 'A pale figure holding a small lantern.',
  ...extra,
});

const CANDIDATES: readonly SpecterProfileV1[] = [
  profileOf('Lanternwick', { epithet: 'Keeper of low light', signatureAction: 'Lifts the lantern and counts to three.' }),
  profileOf('Mossgrave', { personality: 'Slow to speak, certain once it does.', mannerism: 'Hums a note below hearing.' }),
  profileOf('Pennywhistle', { epithet: null, appearance: 'A small figure with a coat of folded paper.' }),
  profileOf('Ashbourne', { personality: 'Warm and a little formal.', artBrief: 'A figure at the edge of a lit window.' }),
];

interface RequestEntry {
  record: SummoningV1;
  polls: number;
  willFail: boolean;
}

interface FixtureState {
  scenario: SpecterScenarioName;
  specters: Map<string, SpecterV1>;
  requests: Map<string, RequestEntry>;
  uploaded: Map<string, StoredAsset>;
  started: Map<string, number>;
  counter: number;
}

let override: SpecterScenarioName | null = null;

export function setSpecterScenario(name: SpecterScenarioName | null): void {
  override = name;
}

const isSpecterScenario = (value: string | null): value is SpecterScenarioName => SPECTER_SCENARIO_NAMES.some((name) => name === value);

/** The test override, else `?scenario=` on the page URL; every other name is `specters-none`. */
export function activeSpecterScenario(): SpecterScenarioName {
  if (override !== null) return override;
  const requested = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('scenario');
  const named = canonicalArenaScenario(requested, { arena: 'specters', perf: 'arena-perf-specters', stale: 'specters', empty: 'specters-none' });
  return isSpecterScenario(named) ? named : 'specters-none';
}

const specterOf = (n: number, profile: SpecterProfileV1, portrait: StoredAsset | null): SpecterV1 => ({
  contractVersion: 1,
  specterId: `spc_${n.toString(16).padStart(24, '0')}`,
  bindingId: bindingIdOf(n),
  version: 1,
  profile,
  portrait: portrait === null ? null : portrait.meta,
  source: 'generated',
  promptVersion: PROMPT_VERSION,
  createdAtMs: FIXTURE_NOW_MS - 3_600_000,
  updatedAtMs: FIXTURE_NOW_MS - 3_600_000,
});

function seed(scenario: SpecterScenarioName): SpecterV1[] {
  const first = BUNDLED[0] ?? null;
  const second = BUNDLED[1] ?? null;
  switch (scenario) {
    case 'specters':
      return [
        specterOf(1, profileOf('Vesper', { epithet: 'Who waits at the door' }), first),
        specterOf(2, profileOf('Wren'), null),
        specterOf(3, profileOf('Thistle', { personality: LONG_TEXT, appearance: LONG_TEXT, mannerism: LONG_TEXT.slice(0, 200) }), second),
      ];
    case 'summon-failure':
      return [specterOf(1, profileOf('Vesper'), null)];
    case 'asset-failed':
      return [specterOf(1, profileOf('Vesper'), first)];
    case 'arena-perf-specters':
      return PERF_SPECTER_NAMES.map((name, index) => specterOf(index + 1, profileOf(name), null));
    case 'long-names':
      return [
        specterOf(1, profileOf('W'.repeat(40), { epithet: 'E'.repeat(60) }), null),
        specterOf(2, profileOf('M'.repeat(40)), first),
      ];
    default:
      return [];
  }
}

function freshState(scenario: SpecterScenarioName): FixtureState {
  return {
    scenario,
    specters: new Map(seed(scenario).map((specter) => [specter.bindingId, specter])),
    requests: new Map(),
    uploaded: new Map(),
    started: new Map(),
    counter: 0,
  };
}

let store: FixtureState | null = null;

export function resetSpecterFixtures(): void {
  store = null;
  override = null;
}

function current(): FixtureState {
  const scenario = activeSpecterScenario();
  if (store === null || store.scenario !== scenario) store = freshState(scenario);
  return store;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const apiError = (status: number, error: string): Response => json({ contractVersion: 1, error }, status);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isVersion = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

const budgetOf = (state: FixtureState, bindingId: string): SummoningV1['budget'] => {
  const installUsed = [...state.started.values()].reduce((sum, count) => sum + count, 0);
  return {
    bindingRemaining: Math.max(0, BINDING_LIMIT - (state.started.get(bindingId) ?? 0)),
    bindingLimit: BINDING_LIMIT,
    installRemaining: Math.max(0, INSTALL_LIMIT - installUsed),
    installLimit: INSTALL_LIMIT,
    windowMs: WINDOW_MS,
  };
};

const view = (state: FixtureState, entry: RequestEntry): SummoningV1 => ({
  ...entry.record,
  budget: budgetOf(state, entry.record.bindingId),
});

function startSummoning(state: FixtureState, bindingId: string, body: unknown): Response {
  if (!BINDING_ID.test(bindingId)) return apiError(404, 'unknown_binding');
  if (!isObject(body) || typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)) return apiError(400, 'invalid_body');
  const existing = state.requests.get(body.requestId);
  if (existing !== undefined) return json(view(state, existing), 200);
  const inFlight = [...state.requests.values()].some(
    (entry) => entry.record.bindingId === bindingId && (entry.record.status === 'queued' || entry.record.status === 'running'),
  );
  if (inFlight) return apiError(409, 'generation_in_flight');
  if ((state.started.get(bindingId) ?? 0) >= BINDING_LIMIT) return apiError(429, 'budget_exhausted');
  const keep = Array.isArray(body.keep) ? body.keep.filter((field): field is string => typeof field === 'string') : [];
  const record: SummoningV1 = {
    contractVersion: 1,
    requestId: body.requestId,
    bindingId,
    status: 'queued',
    candidate: null,
    error: null,
    promptVersion: PROMPT_VERSION,
    keep,
    createdAtMs: FIXTURE_NOW_MS,
    finishedAtMs: null,
    budget: budgetOf(state, bindingId),
  };
  const entry: RequestEntry = { record, polls: 0, willFail: state.scenario === 'summon-failure' };
  state.requests.set(body.requestId, entry);
  return json(view(state, entry), 202);
}

function candidateFor(state: FixtureState, record: SummoningV1): SpecterProfileV1 {
  const base = CANDIDATES[state.counter % CANDIDATES.length] ?? profileOf('Candidate');
  state.counter += 1;
  const kept = state.specters.get(record.bindingId)?.profile;
  if (kept === undefined) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const field of record.keep) if (field in kept) merged[field] = (kept as unknown as Record<string, unknown>)[field];
  return merged as unknown as SpecterProfileV1;
}

function pollSummoning(state: FixtureState, requestId: string): Response {
  const entry = state.requests.get(requestId);
  if (entry === undefined) return apiError(404, 'unknown_request');
  const { record } = entry;
  if (record.status === 'queued' || record.status === 'running') {
    entry.polls += 1;
    if (record.status === 'queued') {
      record.status = 'running';
      state.started.set(record.bindingId, (state.started.get(record.bindingId) ?? 0) + 1);
    } else if (entry.willFail) {
      record.status = 'failed';
      record.error = 'timeout';
      record.finishedAtMs = FIXTURE_NOW_MS + 1000;
    } else {
      record.status = 'ready';
      record.candidate = candidateFor(state, record);
      record.finishedAtMs = FIXTURE_NOW_MS + 1000;
    }
  }
  return json(view(state, entry));
}

function cancelSummoning(state: FixtureState, requestId: string): Response {
  const entry = state.requests.get(requestId);
  if (entry === undefined) return apiError(404, 'unknown_request');
  if (['queued', 'running', 'ready'].includes(entry.record.status)) {
    entry.record.status = 'cancelled';
    entry.record.candidate = null;
    entry.record.finishedAtMs = FIXTURE_NOW_MS + 1000;
  }
  return json(view(state, entry));
}

function acceptSummoning(state: FixtureState, requestId: string, body: unknown): Response {
  const entry = state.requests.get(requestId);
  if (entry === undefined) return apiError(404, 'unknown_request');
  if (!isObject(body) || !isVersion(body.expectedVersion)) return apiError(400, 'invalid_body');
  const { record } = entry;
  if (record.status !== 'ready' || record.candidate === null) return apiError(409, 'not_ready');
  const existing = state.specters.get(record.bindingId);
  if ((existing?.version ?? 0) !== body.expectedVersion) return apiError(409, 'version_conflict');
  const specter: SpecterV1 = {
    contractVersion: 1,
    specterId: existing?.specterId ?? `spc_${hashHex(requestId).slice(0, 24)}`,
    bindingId: record.bindingId,
    version: (existing?.version ?? 0) + 1,
    profile: record.candidate,
    portrait: existing?.portrait ?? null,
    source: 'generated',
    promptVersion: record.promptVersion,
    createdAtMs: existing?.createdAtMs ?? FIXTURE_NOW_MS,
    updatedAtMs: FIXTURE_NOW_MS + 2000,
  };
  state.specters.set(record.bindingId, specter);
  record.status = 'accepted';
  for (const other of state.requests.values()) {
    if (other !== entry && other.record.bindingId === record.bindingId && other.record.status === 'ready') other.record.status = 'superseded';
  }
  return json(specter);
}

const TEXT_FIELDS = ['name', 'personality', 'appearance', 'mannerism', 'assignmentRationale', 'artBrief'] as const;
const LIMITS: Record<string, number> = { name: 40, epithet: 60, personality: 400, appearance: 400, mannerism: 200, signatureAction: 200, assignmentRationale: 300, artBrief: 400 };

function validProfile(value: unknown): value is SpecterProfileV1 {
  if (!isObject(value) || value.contractVersion !== 1) return false;
  const text = (field: string): boolean => typeof value[field] === 'string' && value[field].length >= 1 && value[field].length <= (LIMITS[field] ?? 0);
  const optional = (field: string): boolean => value[field] === null || text(field);
  return TEXT_FIELDS.every(text) && optional('epithet') && optional('signatureAction');
}

function writeSpecter(state: FixtureState, bindingId: string, body: unknown, build: (existing: SpecterV1 | undefined) => SpecterV1 | Response): Response {
  if (!BINDING_ID.test(bindingId)) return apiError(404, 'unknown_binding');
  if (!isObject(body) || !isVersion(body.expectedVersion)) return apiError(400, 'invalid_body');
  const existing = state.specters.get(bindingId);
  if ((existing?.version ?? 0) !== body.expectedVersion) return apiError(409, 'version_conflict');
  const built = build(existing);
  if (built instanceof Response) return built;
  const next = { ...built, version: (existing?.version ?? 0) + 1, updatedAtMs: FIXTURE_NOW_MS + 3000 };
  state.specters.set(bindingId, next);
  return json(next);
}

function saveManual(state: FixtureState, bindingId: string, body: unknown): Response {
  return writeSpecter(state, bindingId, body, (existing) => {
    const profile = (body as Record<string, unknown>).profile;
    if (!validProfile(profile)) return apiError(400, 'invalid_body');
    return {
      contractVersion: 1,
      specterId: existing?.specterId ?? `spc_${hashHex(bindingId).slice(0, 24)}`,
      bindingId,
      version: 0,
      profile,
      portrait: existing?.portrait ?? null,
      source: 'manual',
      promptVersion: null,
      createdAtMs: existing?.createdAtMs ?? FIXTURE_NOW_MS,
      updatedAtMs: 0,
    };
  });
}

function rename(state: FixtureState, bindingId: string, body: unknown): Response {
  return writeSpecter(state, bindingId, body, (existing) => {
    const input = body as Record<string, unknown>;
    if (existing === undefined) return apiError(404, 'no_specter');
    const profile = { ...existing.profile, name: input.name, ...('epithet' in input ? { epithet: input.epithet } : {}) };
    return validProfile(profile) ? { ...existing, profile } : apiError(400, 'invalid_body');
  });
}

const findAsset = (state: FixtureState, assetId: string): StoredAsset | undefined =>
  [...BUNDLED, ...state.uploaded.values()].find((asset) => asset.meta.assetId === assetId);

function setPortrait(state: FixtureState, bindingId: string, body: unknown): Response {
  return writeSpecter(state, bindingId, body, (existing) => {
    const assetId = (body as Record<string, unknown>).assetId;
    if (existing === undefined) return apiError(404, 'no_specter');
    if (assetId === null) return { ...existing, portrait: null };
    const asset = typeof assetId === 'string' ? findAsset(state, assetId) : undefined;
    return asset === undefined ? apiError(404, 'unknown_asset') : { ...existing, portrait: asset.meta };
  });
}

function archive(state: FixtureState, bindingId: string, body: unknown): Response {
  if (!BINDING_ID.test(bindingId)) return apiError(404, 'unknown_binding');
  if (!isObject(body) || !isVersion(body.expectedVersion)) return apiError(400, 'invalid_body');
  const existing = state.specters.get(bindingId);
  if (existing === undefined) return apiError(404, 'no_specter');
  if (existing.version !== body.expectedVersion) return apiError(409, 'version_conflict');
  state.specters.delete(bindingId);
  return json({ contractVersion: 1, archived: true });
}

function uploadAsset(state: FixtureState, body: unknown): Response {
  if (!isObject(body) || typeof body.dataBase64 !== 'string') return apiError(400, 'invalid_body');
  if (body.mediaType !== 'image/png') return apiError(415, 'unsupported_media');
  if (body.dataBase64.length > MAX_UPLOAD_CHARS) return apiError(413, 'asset_too_large');
  let bytes: string;
  try {
    bytes = atob(body.dataBase64);
  } catch {
    return apiError(422, 'invalid_image');
  }
  if (!PNG_SIGNATURE.every((value, index) => bytes.charCodeAt(index) === value)) return apiError(422, 'invalid_image');
  const label = typeof body.label === 'string' && body.label !== '' ? body.label : 'Uploaded portrait';
  const asset = makeAsset(body.dataBase64, 'uploaded', label);
  state.uploaded.set(asset.meta.assetId, asset);
  return json(asset.meta, 201);
}

function getAsset(state: FixtureState, assetId: string): Response {
  const asset = state.scenario === 'asset-failed' ? undefined : findAsset(state, assetId);
  return asset === undefined ? apiError(404, 'unknown_asset') : json({ ...asset.meta, dataBase64: asset.data });
}

const SEGMENT = '([^/]+)';
const routes: ReadonlyArray<{ pattern: RegExp; method: 'GET' | 'POST'; handle: (state: FixtureState, match: RegExpExecArray, body: unknown) => Response }> = [
  { pattern: new RegExp(`^${appApiPath('/specters')}$`), method: 'GET', handle: (state) => json({ contractVersion: 1, items: [...state.specters.values()] }) },
  {
    pattern: new RegExp(`^${appApiPath('/specters')}/${SEGMENT}$`),
    method: 'GET',
    handle: (state, match) => {
      const found = state.specters.get(decodeURIComponent(match[1] ?? ''));
      return found === undefined ? apiError(404, 'no_specter') : json(found);
    },
  },
  { pattern: new RegExp(`^${appApiPath('/specters')}/${SEGMENT}/summonings$`), method: 'POST', handle: (state, match, body) => startSummoning(state, decodeURIComponent(match[1] ?? ''), body) },
  { pattern: new RegExp(`^${appApiPath('/specters')}/${SEGMENT}/manual$`), method: 'POST', handle: (state, match, body) => saveManual(state, decodeURIComponent(match[1] ?? ''), body) },
  { pattern: new RegExp(`^${appApiPath('/specters')}/${SEGMENT}/name$`), method: 'POST', handle: (state, match, body) => rename(state, decodeURIComponent(match[1] ?? ''), body) },
  { pattern: new RegExp(`^${appApiPath('/specters')}/${SEGMENT}/portrait$`), method: 'POST', handle: (state, match, body) => setPortrait(state, decodeURIComponent(match[1] ?? ''), body) },
  { pattern: new RegExp(`^${appApiPath('/specters')}/${SEGMENT}/archive$`), method: 'POST', handle: (state, match, body) => archive(state, decodeURIComponent(match[1] ?? ''), body) },
  { pattern: new RegExp(`^${appApiPath('/summonings')}/${SEGMENT}$`), method: 'GET', handle: (state, match) => pollSummoning(state, decodeURIComponent(match[1] ?? '')) },
  { pattern: new RegExp(`^${appApiPath('/summonings')}/${SEGMENT}/cancel$`), method: 'POST', handle: (state, match) => cancelSummoning(state, decodeURIComponent(match[1] ?? '')) },
  { pattern: new RegExp(`^${appApiPath('/summonings')}/${SEGMENT}/accept$`), method: 'POST', handle: (state, match, body) => acceptSummoning(state, decodeURIComponent(match[1] ?? ''), body) },
  {
    pattern: new RegExp(`^${appApiPath('/portraits')}$`),
    method: 'GET',
    handle: (state) => json({ contractVersion: 1, items: [...BUNDLED, ...state.uploaded.values()].map((asset) => asset.meta) }),
  },
  { pattern: new RegExp(`^${appApiPath('/assets')}$`), method: 'POST', handle: (state, _match, body) => uploadAsset(state, body) },
  { pattern: new RegExp(`^${appApiPath('/assets')}/${SEGMENT}$`), method: 'GET', handle: (state, match) => getAsset(state, decodeURIComponent(match[1] ?? '')) },
];

/** Null for any path that is not a Specter route, so the caller can fall through. */
export function specterResponse(pathname: string, method: 'GET' | 'POST', body?: unknown): Promise<Response> | null {
  for (const route of routes) {
    const match = route.pattern.exec(pathname);
    if (match === null) continue;
    if (route.method !== method) return Promise.resolve(apiError(405, 'invalid_body'));
    return Promise.resolve(route.handle(current(), match, body));
  }
  return null;
}
