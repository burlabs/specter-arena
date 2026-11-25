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

/** `roster.v2`: the same roster with the waiting condition and the context reading. */
export const rosterSignalsPath = (limit: number, cursor: string | null): string =>
  withQuery(ROSTER_PATH, { view: 'signals', limit, cursor });

export const attemptsPath = (bindingId: string, limit = 50, cursor: string | null = null): string =>
  withQuery(appApiPath(`/roster/${encodeURIComponent(bindingId)}/attempts`), { limit, cursor });

const enc = encodeURIComponent;

export const SPECTERS_PATH = appApiPath('/specters');
/** `specters.v3`: assigned bindings plus `unassignedBindingIds`. The plain path keeps its `specters.v2` body. */
export const SPECTERS_ASSIGNMENT_PATH = withQuery(SPECTERS_PATH, { view: 'assignment' });
export const HEROES_PATH = appApiPath('/heroes');
export const PORTRAITS_PATH = appApiPath('/portraits');
export const ASSETS_PATH = appApiPath('/assets');

export const specterPath = (bindingId: string): string => appApiPath(`/specters/${enc(bindingId)}`);
/** `POST {expectedVersion, heroId | null}` assigns a hero (specter.v3). */
export const specterHeroPath = (bindingId: string): string => appApiPath(`/specters/${enc(bindingId)}/hero`);
export const specterPortraitPath = (bindingId: string): string => appApiPath(`/specters/${enc(bindingId)}/portrait`);
export const assetPath = (assetId: string): string => appApiPath(`/assets/${enc(assetId)}`);
export const sceneAssetPath = (key: string): string => appApiPath(`/scene-assets/${enc(key)}`);

export const XP_PATH = appApiPath('/xp');
/**
 * The paged read of `xp-summaries.v3` (one `xp-summary.v2` per bot, both ledgers). The view name is the backend's
 * (FP-22 PR-A); `useXp` walks every page. The unpaged `GET /api/xp` and `view=paged` keep their old bodies.
 */
export const XP_SUMMARIES_VIEW = 'tasks';
export const xpPagedPath = (limit: number, cursor: string | null): string => withQuery(XP_PATH, { view: XP_SUMMARIES_VIEW, limit, cursor });

export const TASKS_PATH = appApiPath('/tasks');
export interface TasksQuery {
  state?: 'open' | 'credited' | 'not-credited' | null;
  bindingId?: string | null;
  limit: number;
  cursor: string | null;
}
/** `tasks.v1`, newest update first. A cursor only fits the query it came from. GET only. */
export const tasksPath = ({ state = null, bindingId = null, limit, cursor }: TasksQuery): string => withQuery(TASKS_PATH, { state, bindingId, limit, cursor });
export const taskPath = (taskId: string): string => appApiPath(`/tasks/${enc(taskId)}`);
export const RECAP_PATH = appApiPath('/recap');
/** `recap.v1` for one period, both ends in epoch milliseconds. GET only. */
export const recapPath = (fromMs: number, toMs: number): string => withQuery(RECAP_PATH, { fromMs, toMs });
export const xpHistoryPath = (bindingId: string, limit = 50, cursor: string | null = null): string =>
  withQuery(appApiPath(`/roster/${enc(bindingId)}/xp`), { limit, cursor });

export const DATA_PATH = appApiPath('/data');
export const DATA_RETENTION_PATH = appApiPath('/data/retention');
export const DATA_PURGE_PATH = appApiPath('/data/purge');
export const DATA_EXPORT_PATH = appApiPath('/data/export');
export const DATA_ASSET_CLEANUP_PATH = appApiPath('/data/asset-cleanup');
export const COLLECTOR_PATH = appApiPath('/collector');
