export const APP_API_PREFIX = '/apps/specter-arena/api';

export function appApiPath(suffix: `/${string}`): string {
  return `${APP_API_PREFIX}${suffix}`;
}

export const PING_PATH = appApiPath('/ping');

export const ROSTER_PATH = appApiPath('/roster');

function withQuery(path: string, params: Record<string, string | number | null | undefined>): string {
  const query = Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
  return query === '' ? path : `${path}?${query}`;
}

export const rosterPath = (limit: number, cursor: string | null): string => withQuery(ROSTER_PATH, { limit, cursor });

export const attemptsPath = (bindingId: string, limit = 50, cursor: string | null = null): string =>
  withQuery(appApiPath(`/roster/${encodeURIComponent(bindingId)}/attempts`), { limit, cursor });

const enc = encodeURIComponent;

export const SPECTERS_PATH = appApiPath('/specters');
export const PORTRAITS_PATH = appApiPath('/portraits');
export const ASSETS_PATH = appApiPath('/assets');

export const specterPath = (bindingId: string): string => appApiPath(`/specters/${enc(bindingId)}`);
export const summoningsPath = (bindingId: string): string => appApiPath(`/specters/${enc(bindingId)}/summonings`);
export const specterActionPath = (bindingId: string, action: 'manual' | 'name' | 'portrait' | 'archive'): string =>
  appApiPath(`/specters/${enc(bindingId)}/${action}`);
export const summoningPath = (requestId: string): string => appApiPath(`/summonings/${enc(requestId)}`);
export const summoningActionPath = (requestId: string, action: 'cancel' | 'accept'): string =>
  appApiPath(`/summonings/${enc(requestId)}/${action}`);
export const assetPath = (assetId: string): string => appApiPath(`/assets/${enc(assetId)}`);
