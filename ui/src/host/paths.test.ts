import { describe, expect, it } from 'vitest';
import {
  ASSETS_PATH,
  PORTRAITS_PATH,
  ROSTER_PATH,
  SPECTERS_PATH,
  assetPath,
  attemptsPath,
  rosterPath,
  specterActionPath,
  specterPath,
  summoningActionPath,
  summoningPath,
  summoningsPath,
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
    expect(PORTRAITS_PATH).toBe('/apps/specter-arena/api/portraits');
    expect(ASSETS_PATH).toBe('/apps/specter-arena/api/assets');
  });

  it('builds the per-bot and per-request paths', () => {
    expect(specterPath('bnd_1')).toBe('/apps/specter-arena/api/specters/bnd_1');
    expect(summoningsPath('bnd_1')).toBe('/apps/specter-arena/api/specters/bnd_1/summonings');
    expect(specterActionPath('bnd_1', 'portrait')).toBe('/apps/specter-arena/api/specters/bnd_1/portrait');
    expect(summoningPath('req_1')).toBe('/apps/specter-arena/api/summonings/req_1');
    expect(summoningActionPath('req_1', 'accept')).toBe('/apps/specter-arena/api/summonings/req_1/accept');
    expect(assetPath('ast_1')).toBe('/apps/specter-arena/api/assets/ast_1');
  });

  it('encodes every id so a slash cannot add a path segment', () => {
    expect(specterPath('a/b')).toBe('/apps/specter-arena/api/specters/a%2Fb');
    expect(summoningsPath('a/b')).toBe('/apps/specter-arena/api/specters/a%2Fb/summonings');
    expect(specterActionPath('a/b', 'name')).toBe('/apps/specter-arena/api/specters/a%2Fb/name');
    expect(summoningPath('a/b')).toBe('/apps/specter-arena/api/summonings/a%2Fb');
    expect(summoningActionPath('a/b', 'cancel')).toBe('/apps/specter-arena/api/summonings/a%2Fb/cancel');
    expect(assetPath('a/b')).toBe('/apps/specter-arena/api/assets/a%2Fb');
  });
});
