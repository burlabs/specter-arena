import { describe, expect, it } from 'vitest';
import {
  ASSETS_PATH,
  PORTRAITS_PATH,
  ROSTER_PATH,
  HEROES_PATH,
  SPECTERS_PATH,
  WORK_PATH,
  XP_PATH,
  assetPath,
  sceneAssetPath,
  attemptsPath,
  rosterPath,
  specterPath,
  specterPortraitPath,
  workAttemptsPath,
  workDecisionsPath,
  workListPath,
  workMilestonesPath,
  workPath,
  xpHistoryPath,
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

describe('work and xp paths', () => {
  it('names the two collection paths', () => {
    expect(WORK_PATH).toBe('/apps/specter-arena/api/work');
    expect(XP_PATH).toBe('/apps/specter-arena/api/xp');
  });

  it('omits a null state and cursor and encodes a cursor', () => {
    expect(workListPath(null, 25, null)).toBe(`${WORK_PATH}?limit=25`);
    expect(workListPath('awaiting-review', 25, 'a b/c')).toBe(`${WORK_PATH}?state=awaiting-review&limit=25&cursor=a%20b%2Fc`);
  });

  it('encodes the work id in every item path', () => {
    expect(workPath('a/b')).toBe(`${WORK_PATH}/a%2Fb`);
    expect(workAttemptsPath('wrk_1')).toBe(`${WORK_PATH}/wrk_1/attempts`);
    expect(workMilestonesPath('wrk_1')).toBe(`${WORK_PATH}/wrk_1/milestones`);
    expect(workDecisionsPath('wrk_1')).toBe(`${WORK_PATH}/wrk_1/decisions`);
  });

  it('builds the xp history path with a default limit and an encoded id and cursor', () => {
    expect(xpHistoryPath('a/b')).toBe('/apps/specter-arena/api/roster/a%2Fb/xp?limit=50');
    expect(xpHistoryPath('bnd_1', 10, 'c 1')).toBe('/apps/specter-arena/api/roster/bnd_1/xp?limit=10&cursor=c%201');
  });
});
