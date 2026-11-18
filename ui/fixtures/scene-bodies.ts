// SPECTER-FIXTURE-ONLY: FIXTURE scene-asset route for the preview harness and unit tests; never imported by ui/src.
import type { SceneAssetV1 } from '../src/contracts/types.ts';
import { sceneAssetPath } from '../src/host/paths.ts';
import { solidPng } from './specter-bodies.ts';

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

const SCENE_ASSETS: ReadonlyMap<string, SceneAssetV1> = new Map([
  ['arena-map', make('arena-map', solidPng(24, 32, 48, 160, 90), 160, 90)],
  ['minion-patchling-sprite', make('minion-patchling-sprite', solidPng(110, 160, 90, 64), 64, 64)],
  ['minion-patchbrute-sprite', make('minion-patchbrute-sprite', solidPng(170, 80, 70, 64), 64, 64)],
  ['minion-patchling-portrait', make('minion-patchling-portrait', solidPng(120, 170, 100, 32), 32, 32)],
  ['minion-patchbrute-portrait', make('minion-patchbrute-portrait', solidPng(180, 90, 80, 32), 32, 32)],
]);

export const SCENE_ASSET_KEYS_SERVED: readonly string[] = [...SCENE_ASSETS.keys()];

let failing = false;

export function setSceneAssetsFailing(value: boolean): void {
  failing = value;
}

export function resetSceneAssetFixtures(): void {
  failing = false;
}

/** Null for any path that is not a scene-asset route, so the caller can fall through. */
export function sceneAssetResponse(pathname: string, method: 'GET' | 'POST'): Promise<Response> | null {
  const match = SCENE_PATH.exec(pathname);
  if (match === null) return null;
  if (method !== 'GET') return Promise.resolve(apiError(405, 'invalid_body'));
  const asset = failing ? undefined : SCENE_ASSETS.get(decodeURIComponent(match[1] ?? ''));
  return Promise.resolve(asset === undefined ? apiError(404, UNKNOWN_SCENE_ASSET_CODE) : json(asset));
}
