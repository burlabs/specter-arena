import { describe, expect, it } from 'vitest';
import {
  ASSETS_PATH,
  PORTRAITS_PATH,
  RECAP_PATH,
  ROSTER_PATH,
  HEROES_PATH,
  SPECTERS_ASSIGNMENT_PATH,
  SPECTERS_PATH,
  TASKS_PATH,
  XP_SUMMARIES_VIEW,
  XP_PATH,
  assetPath,
  sceneAssetPath,
  attemptsPath,
  recapPath,
  rosterPath,
  specterPath,
  specterHeroPath,
  specterPortraitPath,
  taskPath,
  tasksPath,
  xpHistoryPath,
  xpPagedPath,
} from './paths';

describe('roster and attempts paths', () => {
  it('appends limit and cursor to the roster path, and omits a null cursor', () => {
    expect(rosterPath(200, null)).toBe(`${ROSTER_PATH}?limit=200`);
    expect(rosterPath(200, 'abc_-')).toBe(`${ROSTER_PATH}?limit=200&cursor=abc_-`);
  });

  it('encodes the binding id so a slash cannot add a path segment', () => {
    expect(attemptsPath('a/b')).toBe('/apps/specter-arena/api/roster/a%2Fb/attempts?limit=50');
  });

  it('appends a cursor and a custom limit to the attempts path', () => {
    expect(attemptsPath('bnd_1', 10, 'c1')).toBe('/apps/specter-arena/api/roster/bnd_1/attempts?limit=10&cursor=c1');
  });
});

describe('specter paths', () => {
  it('builds the fixed collection paths under the app prefix', () => {
    expect(SPECTERS_PATH).toBe('/apps/specter-arena/api/specters');
    expect(SPECTERS_ASSIGNMENT_PATH).toBe('/apps/specter-arena/api/specters?view=assignment');
    expect(specterHeroPath('bnd_1')).toBe('/apps/specter-arena/api/specters/bnd_1/hero');
    expect(specterHeroPath('a/b')).toBe('/apps/specter-arena/api/specters/a%2Fb/hero');
    expect(HEROES_PATH).toBe('/apps/specter-arena/api/heroes');
    expect(PORTRAITS_PATH).toBe('/apps/specter-arena/api/portraits');
    expect(ASSETS_PATH).toBe('/apps/specter-arena/api/assets');
  });

  it('builds the per-bot paths', () => {
    expect(specterPath('bnd_1')).toBe('/apps/specter-arena/api/specters/bnd_1');
    expect(specterPortraitPath('bnd_1')).toBe('/apps/specter-arena/api/specters/bnd_1/portrait');
    expect(assetPath('ast_1')).toBe('/apps/specter-arena/api/assets/ast_1');
    expect(sceneAssetPath('arena-map')).toBe('/apps/specter-arena/api/scene-assets/arena-map');
  });

  it('encodes every id so a slash cannot add a path segment', () => {
    expect(specterPath('a/b')).toBe('/apps/specter-arena/api/specters/a%2Fb');
    expect(specterPortraitPath('a/b')).toBe('/apps/specter-arena/api/specters/a%2Fb/portrait');
    expect(assetPath('a/b')).toBe('/apps/specter-arena/api/assets/a%2Fb');
  });
});

describe('task and xp paths', () => {
  it('builds the fixed collection paths under the app prefix', () => {
    expect(TASKS_PATH).toBe('/apps/specter-arena/api/tasks');
    expect(XP_PATH).toBe('/apps/specter-arena/api/xp');
  });

  it('builds the tasks list path with an optional state and bot and an omitted null cursor', () => {
    expect(tasksPath({ limit: 25, cursor: null })).toBe(`${TASKS_PATH}?limit=25`);
    expect(tasksPath({ state: 'not-credited', limit: 25, cursor: 'a b/c' })).toBe(`${TASKS_PATH}?state=not-credited&limit=25&cursor=a%20b%2Fc`);
    expect(tasksPath({ state: 'open', bindingId: 'bnd_1', limit: 10, cursor: null })).toBe(`${TASKS_PATH}?state=open&bindingId=bnd_1&limit=10`);
  });

  it('builds the recap path with both ends as plain integers', () => {
    expect(RECAP_PATH).toBe('/apps/specter-arena/api/recap');
    expect(recapPath(1_800_000_000_000, 1_800_000_600_000)).toBe(`${RECAP_PATH}?fromMs=1800000000000&toMs=1800000600000`);
  });

  it('encodes the task id in the item path', () => {
    expect(taskPath('a/b')).toBe(`${TASKS_PATH}/a%2Fb`);
  });

  it('names the xp-summaries.v3 view and omits a null cursor', () => {
    expect(XP_SUMMARIES_VIEW).toBe('tasks');
    expect(xpPagedPath(200, null)).toBe(`${XP_PATH}?view=tasks&limit=200`);
    expect(xpPagedPath(200, 'b_x y')).toBe(`${XP_PATH}?view=tasks&limit=200&cursor=b_x%20y`);
  });

  it('builds the xp history path with a default limit and an encoded id and cursor', () => {
    expect(xpHistoryPath('a/b')).toBe('/apps/specter-arena/api/roster/a%2Fb/xp?limit=50');
    expect(xpHistoryPath('bnd_1', 10, 'c 1')).toBe('/apps/specter-arena/api/roster/bnd_1/xp?limit=10&cursor=c%201');
  });
});
