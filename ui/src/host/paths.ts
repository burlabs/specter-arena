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
