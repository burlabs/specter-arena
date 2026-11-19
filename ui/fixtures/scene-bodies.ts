// SPECTER-FIXTURE-ONLY: FIXTURE scene-asset route for the preview harness and unit tests; never imported by ui/src.
import type { SceneAssetV1 } from '../src/contracts/types.ts';
import { sceneAssetPath } from '../src/host/paths.ts';
import roster from '../../backend/specter_arena/specters/heroes.json';
import { HERO_COLOURS, pngSize, solidPng } from './specter-bodies.ts';

const UNKNOWN_SCENE_ASSET_CODE = 'unknown_scene_asset';
const SCENE_PATH = new RegExp(`^${sceneAssetPath('')}([^/]*)$`);

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const apiError = (status: number, error: string): Response => json({ contractVersion: 1, error }, status);

const hashHex = (text: string): string => {
  let out = '';
  for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b1, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c]) {
    let h = seed;
    for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out;
};

function make(key: string, data: string, width: number, height: number): SceneAssetV1 {
  return {
    contractVersion: 1,
    key,
    mediaType: 'image/png',
    width,
    height,
    sha256: hashHex(data),
    byteLength: atob(data).length,
    dataBase64: data,
  };
}

interface Placeholder {
  readonly width: number;
  readonly height: number;
  readonly rgb: readonly [number, number, number];
}

const HERO_SPRITE_SIDE = 512;
const HERO_THUMBNAIL_SIDE = 96;
const FALLBACK_RGB: readonly [number, number, number] = [128, 128, 128];

/** The five base keys, then each hero's sprite and thumbnail in roster order; the order is pinned by a test. */
const PLACEHOLDERS: ReadonlyMap<string, Placeholder> = new Map<string, Placeholder>([
  ['arena-map', { width: 160, height: 90, rgb: [24, 32, 48] }],
  ['minion-patchling-sprite', { width: 64, height: 64, rgb: [110, 160, 90] }],
  ['minion-patchbrute-sprite', { width: 64, height: 64, rgb: [170, 80, 70] }],
  ['minion-patchling-portrait', { width: 32, height: 32, rgb: [120, 170, 100] }],
  ['minion-patchbrute-portrait', { width: 32, height: 32, rgb: [180, 90, 80] }],
  ...roster.heroes.flatMap((hero, index): Array<[string, Placeholder]> => {
    const rgb = HERO_COLOURS[index] ?? FALLBACK_RGB;
    return [
      [hero.spriteKey, { width: HERO_SPRITE_SIDE, height: HERO_SPRITE_SIDE, rgb }],
      [hero.thumbnailKey, { width: HERO_THUMBNAIL_SIDE, height: HERO_THUMBNAIL_SIDE, rgb }],
    ];
  }),
]);

export const SCENE_ASSET_KEYS_SERVED: readonly string[] = [...PLACEHOLDERS.keys()];

const built = new Map<string, SceneAssetV1>();
let registered: ReadonlyMap<string, SceneAssetV1> = new Map();

/** Preview only, from `real-art.ts`: replace a key's placeholder with a real PNG (a `data:` URL) and read its size from the PNG header. Keys outside the served set are ignored. */
export function installSceneArt(art: Readonly<Record<string, string>>): void {
  const next = new Map(registered);
  for (const [key, dataUrl] of Object.entries(art)) {
    if (!PLACEHOLDERS.has(key)) continue;
    const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const { width, height } = pngSize(data);
    next.set(key, make(key, data, width, height));
  }
  registered = next;
}

/** A solid image of a chosen size for one key, so a test can serve a map-sized body without real art. */
export function installSceneFixture(key: string, width: number, height: number, rgb: readonly [number, number, number] = [24, 32, 48]): void {
  registered = new Map([...registered, [key, make(key, solidPng(rgb[0], rgb[1], rgb[2], width, height), width, height)]]);
}

function assetOf(key: string): SceneAssetV1 | undefined {
  const real = registered.get(key);
  if (real !== undefined) return real;
  const cached = built.get(key);
  if (cached !== undefined) return cached;
  const spec = PLACEHOLDERS.get(key);
  if (spec === undefined) return undefined;
  const asset = make(key, solidPng(spec.rgb[0], spec.rgb[1], spec.rgb[2], spec.width, spec.height), spec.width, spec.height);
  built.set(key, asset);
  return asset;
}

let failing = false;

const requestedScenario = (): string | null =>
  typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('scenario');

export function setSceneAssetsFailing(value: boolean): void {
  failing = value;
}

export function resetSceneAssetFixtures(): void {
  failing = false;
  registered = new Map();
  built.clear();
}

/** Null for any path that is not a scene-asset route, so the caller can fall through. */
export function sceneAssetResponse(pathname: string, method: 'GET' | 'POST'): Promise<Response> | null {
  const match = SCENE_PATH.exec(pathname);
  if (match === null) return null;
  if (method !== 'GET') return Promise.resolve(apiError(405, 'invalid_body'));
  const asset = failing || requestedScenario() === 'arena-no-art' ? undefined : assetOf(decodeURIComponent(match[1] ?? ''));
  return Promise.resolve(asset === undefined ? apiError(404, UNKNOWN_SCENE_ASSET_CODE) : json(asset));
}
