import type { PortraitAssetV1 } from '../contracts/types';
import { assetPath } from '../host';
import type { HostApi } from '../host';

export const MAX_CACHE_ENTRIES = 64;
export const MAX_IN_FLIGHT = 4;
const MAX_BASE64_CHARS = 1_500_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const cache = new Map<string, Promise<string>>();
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

async function fetchUrl(api: HostApi, assetId: string): Promise<string> {
  await acquire();
  try {
    const body = await api.getJson<PortraitAssetV1>(assetPath(assetId));
    const data = body?.dataBase64;
    if (body?.mediaType !== 'image/png' || typeof data !== 'string' || data.length > MAX_BASE64_CHARS || !BASE64.test(data)) {
      throw new Error('unusable asset');
    }
    return `data:image/png;base64,${data}`;
  } finally {
    release();
  }
}

/** Assets are content addressed, so a cached entry never goes stale. Failures are not cached. */
export function loadAssetUrl(api: HostApi, assetId: string): Promise<string> {
  const known = cache.get(assetId);
  if (known !== undefined) return known;
  const pending = fetchUrl(api, assetId);
  cache.set(assetId, pending);
  pending.catch(() => {
    if (cache.get(assetId) === pending) cache.delete(assetId);
  });
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return pending;
}

export function clearAssetCache(): void {
  cache.clear();
  waiting.length = 0;
  inFlight = 0;
}
