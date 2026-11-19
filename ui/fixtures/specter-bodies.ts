// SPECTER-FIXTURE-ONLY: FIXTURE Specter routes for the preview harness and unit tests; never imported by ui/src.
import { appApiPath } from '../src/host/paths.ts';
import type { PortraitAssetV1, SpecterV2 } from '../src/contracts/types.ts';
import roster from '../../backend/specter_arena/specters/heroes.json';
import { canonicalArenaScenario } from './arena-scenarios.ts';

export const SPECTER_SCENARIO_NAMES = ['specters-none', 'specters', 'asset-failed', 'heroes-wrapped', 'arena-perf-specters'] as const;
export type SpecterScenarioName = (typeof SPECTER_SCENARIO_NAMES)[number];

const FIXTURE_NOW_MS = 1794916800000;
const MAX_UPLOAD_CHARS = 1_398_104;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const bindingIdOf = (n: number): string => `bnd_${'a'.repeat(20)}${n.toString(16).padStart(4, '0')}`;
const BINDING_ID = /^bnd_[0-9a-f]{24}$/;

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

const HEROES = roster.heroes;

const HERO_COLOURS: ReadonlyArray<readonly [number, number, number]> = [
  [150, 90, 220],
  [120, 190, 160],
  [90, 70, 150],
  [60, 40, 110],
  [230, 170, 90],
  [170, 150, 230],
  [180, 140, 230],
  [70, 120, 200],
  [240, 200, 100],
  [110, 170, 100],
  [225, 220, 245],
];

/** One bundled portrait per hero, in roster order, as the backend's gallery lists them. */
const BUNDLED: readonly StoredAsset[] = HEROES.map((hero, index) => {
  const [red, green, blue] = HERO_COLOURS[index] ?? [128, 128, 128];
  return makeAsset(solidPng(red, green, blue), 'bundled', `${hero.name} portrait`);
});

/** Bindings per scenario; a test pins these against the roster fixture. */
export const FIXTURE_BOT_COUNT: Record<SpecterScenarioName, number> = {
  'specters-none': 0,
  specters: 7,
  'asset-failed': 7,
  'heroes-wrapped': 13,
  'arena-perf-specters': 20,
};

const ROMAN: ReadonlyArray<readonly [number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** Same rule as the backend: ordinal 1 is bare, 2..3999 Roman, above that digits. */
export function displayNameOf(name: string, ordinal: number): string {
  if (ordinal === 1) return name;
  if (ordinal > 3999) return `${name} ${ordinal}`;
  let rest = ordinal;
  let numeral = '';
  for (const [value, glyph] of ROMAN) {
    while (rest >= value) {
      numeral += glyph;
      rest -= value;
    }
  }
  return `${name} ${numeral}`;
}

interface FixtureState {
  scenario: SpecterScenarioName;
  specters: Map<string, SpecterV2>;
  uploaded: Map<string, StoredAsset>;
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

/** Assignment n: hero n mod 11, ordinal n div 11 + 1, for the n-th binding (n starts at 1). */
function specterOf(n: number, avatar: StoredAsset | null): SpecterV2 {
  const assignmentNo = n - 1;
  const index = assignmentNo % HEROES.length;
  const hero = HEROES[index] ?? HEROES[0];
  const own = BUNDLED[index] ?? BUNDLED[0];
  const portrait = (avatar ?? own)?.meta;
  if (hero === undefined || portrait === undefined) throw new Error('fixture roster is empty');
  const ordinal = Math.floor(assignmentNo / HEROES.length) + 1;
  return {
    contractVersion: 2,
    bindingId: bindingIdOf(n),
    version: avatar === null ? 0 : 1,
    heroId: hero.id as SpecterV2['heroId'],
    ordinal,
    displayName: displayNameOf(hero.name, ordinal),
    name: hero.name,
    epithet: hero.epithet,
    personality: hero.personality,
    appearance: hero.appearance,
    portrait,
    avatarChosen: avatar !== null,
    source: 'roster',
    createdAtMs: FIXTURE_NOW_MS - 3_600_000,
    updatedAtMs: FIXTURE_NOW_MS - 3_600_000,
  };
}

function seed(scenario: SpecterScenarioName): SpecterV2[] {
  const count = FIXTURE_BOT_COUNT[scenario];
  const chosen = scenario === 'specters' ? new Map<number, StoredAsset | null>([[2, BUNDLED[10] ?? null]]) : new Map<number, StoredAsset | null>();
  return Array.from({ length: count }, (_, index) => specterOf(index + 1, chosen.get(index + 1) ?? null));
}

function freshState(scenario: SpecterScenarioName): FixtureState {
  return { scenario, specters: new Map(seed(scenario).map((specter) => [specter.bindingId, specter])), uploaded: new Map() };
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

const findAsset = (state: FixtureState, assetId: string): StoredAsset | undefined =>
  [...BUNDLED, ...state.uploaded.values()].find((asset) => asset.meta.assetId === assetId);

const heroIndexOf = (specter: SpecterV2): number => HEROES.findIndex((hero) => hero.id === specter.heroId);

/** `version` is the avatar revision. `assetId: null` resets to the hero's own bundled portrait. A same-avatar write is a no-op. */
function setPortrait(state: FixtureState, bindingId: string, body: unknown): Response {
  if (!BINDING_ID.test(bindingId)) return apiError(404, 'unknown_binding');
  if (!isObject(body) || Object.keys(body).length !== 2 || !('assetId' in body) || !isVersion(body.expectedVersion)) {
    return apiError(400, 'invalid_body');
  }
  const existing = state.specters.get(bindingId);
  if (existing === undefined) return apiError(404, 'unknown_binding');
  if (existing.version !== body.expectedVersion) return apiError(409, 'version_conflict');
  const assetId = body.assetId;
  if (assetId !== null && typeof assetId !== 'string') return apiError(400, 'invalid_body');
  const chosen = typeof assetId === 'string' ? findAsset(state, assetId) : undefined;
  if (typeof assetId === 'string' && chosen === undefined) return apiError(404, 'unknown_asset');
  const portrait = (chosen ?? BUNDLED[heroIndexOf(existing)])?.meta;
  if (portrait === undefined) return apiError(404, 'unknown_asset');
  const same = chosen === undefined ? !existing.avatarChosen : existing.avatarChosen && existing.portrait.assetId === portrait.assetId;
  if (same) return json(existing);
  const next: SpecterV2 = { ...existing, version: existing.version + 1, portrait, avatarChosen: chosen !== undefined, updatedAtMs: existing.updatedAtMs + 1 };
  state.specters.set(bindingId, next);
  return json(next);
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
  { pattern: new RegExp(`^${appApiPath('/specters')}$`), method: 'GET', handle: (state) => json({ contractVersion: 2, items: [...state.specters.values()] }) },
  {
    pattern: new RegExp(`^${appApiPath('/specters')}/${SEGMENT}$`),
    method: 'GET',
    handle: (state, match) => {
      const found = state.specters.get(decodeURIComponent(match[1] ?? ''));
      return found === undefined ? apiError(404, 'unknown_binding') : json(found);
    },
  },
  { pattern: new RegExp(`^${appApiPath('/specters')}/${SEGMENT}/portrait$`), method: 'POST', handle: (state, match, body) => setPortrait(state, decodeURIComponent(match[1] ?? ''), body) },
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
