import type { SceneAssetV1 } from '../contracts/types';
import { sceneAssetPath } from '../host';
import type { HostApi } from '../host';

/**
 * Blob URLs are never revoked, so eviction would leak the blob of every entry it drops. The backend allowlist
 * (`scene/*.png`, 27 keys) must stay at or below this bound so eviction never runs; `sceneAssetCache.bound.test.ts` fails when it does not.
 */
export const MAX_CACHE_ENTRIES = 32;
export const MAX_IN_FLIGHT = 4;
/** The 4 MiB file limit of scene-asset.v1 as base64, plus slack for padding. */
export const MAX_BASE64_CHARS = 5_700_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface SceneArt {
  url: string;
  width: number;
  height: number;
}

const cache = new Map<string, Promise<SceneArt>>();
let inFlight = 0;
const waiting: Array<() => void> = [];

function acquire(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiting.push(() => {
      inFlight += 1;
      resolve();
    });
  });
}

function release(): void {
  inFlight -= 1;
  waiting.shift()?.();
}

/**
 * A blob URL, because Chromium resolves a custom property that holds a data URL above 2 MiB to `none` and the
 * arena map is 2.8 MB as base64. The data URL is the fallback where `createObjectURL` is missing or refuses.
 * Blob URLs are not revoked: the key set is bounded by the backend allowlist, and an `<img>` may still show an evicted entry.
 */
function urlOf(data: string): string {
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  } catch {
    return `data:image/png;base64,${data}`;
  }
}

const isSize = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

async function fetchArt(api: HostApi, key: string): Promise<SceneArt> {
  await acquire();
  try {
    const body = await api.getJson<SceneAssetV1>(sceneAssetPath(key));
    const data = body?.dataBase64;
    if (
      body?.key !== key ||
      body.mediaType !== 'image/png' ||
      typeof data !== 'string' ||
      data.length > MAX_BASE64_CHARS ||
      !BASE64.test(data) ||
      !isSize(body.width) ||
      !isSize(body.height)
    ) {
      throw new Error('unusable scene asset');
    }
    return { url: urlOf(data), width: body.width, height: body.height };
  } finally {
    release();
  }
}

/** Scene art is content pinned by hash on the backend, so a cached entry never goes stale. Failures are not cached. */
export function loadSceneArt(api: HostApi, key: string): Promise<SceneArt> {
  const known = cache.get(key);
  if (known !== undefined) return known;
  const pending = fetchArt(api, key);
  cache.set(key, pending);
  pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key);
  });
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return pending;
}

export function clearSceneArtCache(): void {
  cache.clear();
  waiting.length = 0;
  inFlight = 0;
}
