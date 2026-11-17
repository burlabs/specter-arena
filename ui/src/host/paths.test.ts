import { describe, expect, it } from 'vitest';
import { ROSTER_PATH, attemptsPath, rosterPath } from './paths';

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
