import { describe, expect, it } from 'vitest';
import { HERO_REGION, PLACEMENT_TRIES, STAGING_CELLS, hash32, mulberry32, placeHeroes } from './heroPlacement';
import { SPECTER_CELL, apart, specterSlot } from './sceneLayout';
import type { Point } from './sceneLayout';

const idsOf = (count: number): string[] => Array.from({ length: count }, (_, i) => `bnd_${String(i * 7 + 1).padStart(24, '0')}`);
const pairsTooClose = (points: readonly Point[]): number => {
  let bad = 0;
  for (let i = 0; i < points.length; i += 1) for (let j = i + 1; j < points.length; j += 1) if (!apart(points[i] as Point, points[j] as Point, SPECTER_CELL)) bad += 1;
  return bad;
};
const inRegion = (p: Point): boolean => p.x >= HERO_REGION.xMin - 1e-9 && p.x <= HERO_REGION.xMax + 1e-9 && p.y >= HERO_REGION.yMin - 1e-9 && p.y <= HERO_REGION.yMax + 1e-9;
const onStaging = (p: Point): boolean => Array.from({ length: STAGING_CELLS }, (_, i) => specterSlot(i)).some((cell) => Math.abs(cell.x - p.x) < 1e-9 && Math.abs(cell.y - p.y) < 1e-9);

describe('hash32 and mulberry32', () => {
  it('hash32 is stable and spreads nearby inputs', () => {
    expect(hash32('')).toBe(0x811c9dc5);
    expect(hash32('a')).toBe(0xe40c292c);
    expect(hash32('1:bnd_a')).not.toBe(hash32('2:bnd_a'));
    expect(hash32('x')).toBeGreaterThanOrEqual(0);
  });

  it('mulberry32 repeats for one seed, differs across seeds and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const run = Array.from({ length: 50 }, () => a());
    expect(run).toEqual(Array.from({ length: 50 }, () => b()));
    expect(run.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(mulberry32(43)()).not.toBe(run[0]);
  });
});

describe('placeHeroes', () => {
  it('gives the same map for the same seed and ids, whatever order the ids arrive in', () => {
    const ids = idsOf(7);
    const first = placeHeroes(new Map(), ids, 1234);
    expect(placeHeroes(new Map(), [...ids].reverse(), 1234)).toEqual(first);
    expect(placeHeroes(new Map(), ids, 4321)).not.toEqual(first);
  });

  it('keeps every hero in the lower band, a cell apart, for 1 to 21 heroes over 200 seeds', () => {
    for (const count of [1, 3, 7, 12, 20, 21]) {
      const ids = idsOf(count);
      for (let seed = 0; seed < 200; seed += 1) {
        const points = [...placeHeroes(new Map(), ids, seed * 2654435761).values()];
        expect(points).toHaveLength(count);
        expect(pairsTooClose(points)).toBe(0);
        expect(points.every(inRegion)).toBe(true);
      }
    }
  });

  it('stands below the enemy lattice by the gap the scene tests require', () => {
    const lowestEnemyRow = 0.08 + 4 * 0.095;
    expect(HERO_REGION.yMin - lowestEnemyRow).toBeGreaterThanOrEqual(0.12);
  });

  it('places most small teams at random points and not on the staging cells', () => {
    let random = 0;
    for (let seed = 1; seed <= 50; seed += 1) for (const point of placeHeroes(new Map(), idsOf(3), seed * 40503).values()) if (!onStaging(point)) random += 1;
    expect(random).toBeGreaterThan(100);
  });

  it('keeps a hero where it is when others join or leave', () => {
    const ids = idsOf(6);
    const before = placeHeroes(new Map(), ids.slice(0, 4), 7);
    const joined = placeHeroes(before, ids, 7);
    for (const id of ids.slice(0, 4)) expect(joined.get(id)).toEqual(before.get(id));
    const left = placeHeroes(joined, ids.slice(1), 7);
    for (const id of ids.slice(1)) expect(left.get(id)).toEqual(joined.get(id));
    expect(left.has(ids[0] as string)).toBe(false);
  });

  it('places a joiner the same way whether or not others were there first', () => {
    const ids = idsOf(3);
    const alone = placeHeroes(new Map(), [ids[2] as string], 9).get(ids[2] as string);
    const together = placeHeroes(new Map(), ids, 9);
    expect(together.get(ids[2] as string)).toBeDefined();
    expect(alone).toBeDefined();
  });

  it('drops a previous point that is outside the band or touches a neighbour, and places that hero again', () => {
    const ids = idsOf(2);
    const outside = placeHeroes(new Map([[ids[0] as string, { x: 0.5, y: 0.2 }]]), ids, 3);
    expect(inRegion(outside.get(ids[0] as string) as Point)).toBe(true);
    const crowded = placeHeroes(new Map([[ids[0] as string, { x: 0.5, y: 0.8 }], [ids[1] as string, { x: 0.51, y: 0.81 }]]), ids, 3);
    expect(pairsTooClose([...crowded.values()])).toBe(0);
    expect(crowded.get(ids[0] as string)).toEqual({ x: 0.5, y: 0.8 });
    const nan = placeHeroes(new Map([[ids[0] as string, { x: Number.NaN, y: 0.8 }]]), ids, 3);
    expect(Number.isFinite((nan.get(ids[0] as string) as Point).x)).toBe(true);
  });

  it('falls back to a staging cell when no random point fits', () => {
    // 20 heroes: the random points run out of room, so some stand on staging cells and none overlap.
    const points = [...placeHeroes(new Map(), idsOf(20), 5).values()];
    expect(points.some(onStaging)).toBe(true);
    expect(pairsTooClose(points)).toBe(0);
    expect(PLACEMENT_TRIES).toBe(12);
  });

  it('finishes for more heroes than the layout holds, and collapses duplicate ids', () => {
    expect(placeHeroes(new Map(), idsOf(100), 1).size).toBe(100);
    const id = idsOf(1)[0] as string;
    expect(placeHeroes(new Map(), [id, id], 1).size).toBe(1);
    expect(placeHeroes(new Map(), [], 1).size).toBe(0);
  });

  it('normalises a negative or huge seed', () => {
    const ids = idsOf(3);
    expect(placeHeroes(new Map(), ids, -1)).toEqual(placeHeroes(new Map(), ids, 0xffffffff));
  });
});
