import { describe, expect, it } from 'vitest';
import { HERO_GAP_PX, PLACEMENT_TRIES, mulberry32, placeHeroes } from './heroPlacement';
import { REGIONS, laneSlots } from './laneSlots';
import type { Region } from './laneSlots';
import { ARENA_INTRINSIC } from './mapLayout';
import type { Point } from './sceneLayout';

const idsOf = (count: number): string[] => Array.from({ length: count }, (_, i) => `bnd_${String(i * 7 + 1).padStart(24, '0')}`);
const pairsTooClose = (points: readonly Point[]): number => {
  let bad = 0;
  for (let i = 0; i < points.length; i += 1) for (let j = i + 1; j < points.length; j += 1) if (Math.hypot(((points[i] as Point).x - (points[j] as Point).x) * ARENA_INTRINSIC.width, ((points[i] as Point).y - (points[j] as Point).y) * ARENA_INTRINSIC.height) < HERO_GAP_PX - 1e-6) bad += 1;
  return bad;
};
const slotOf = (point: Point) => laneSlots().find((slot) => Math.abs(slot.point.x - point.x) < 1e-9 && Math.abs(slot.point.y - point.y) < 1e-9);
const regionCounts = (points: Iterable<Point>): Map<Region, number> => {
  const counts = new Map<Region, number>(REGIONS.map((region) => [region, 0]));
  for (const point of points) {
    const region = slotOf(point)?.region;
    if (region !== undefined) counts.set(region, (counts.get(region) ?? 0) + 1);
  }
  return counts;
};

describe('mulberry32', () => {
  it('repeats for one seed, differs across seeds and stays in [0, 1)', () => {
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

  it('puts each of up to the slot count of heroes on its own slot, over 200 seeds', () => {
    const total = laneSlots().length;
    for (const count of [1, 3, 4, 7, 11, total]) {
      const ids = idsOf(count);
      for (let seed = 0; seed < 200; seed += 1) {
        const points = [...placeHeroes(new Map(), ids, seed * 2654435761).values()];
        expect(points).toHaveLength(count);
        expect(points.every((point) => slotOf(point) !== undefined)).toBe(true);
        expect(pairsTooClose(points)).toBe(0);
      }
    }
  });

  it('spreads across the four regions before any region doubles up', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      for (const count of [2, 3, 4]) {
        const counts = regionCounts(placeHeroes(new Map(), idsOf(count), seed * 40503).values());
        expect(Math.max(...counts.values())).toBe(1);
      }
      const eight = regionCounts(placeHeroes(new Map(), idsOf(8), seed * 40503).values());
      expect(Math.max(...eight.values())).toBe(2);
    }
  });

  it('is random: different seeds put one hero on different slots', () => {
    const id = idsOf(1);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) seen.add(JSON.stringify([...placeHeroes(new Map(), id, seed * 977).values()]));
    expect(seen.size).toBeGreaterThan(8);
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

  it('drops a previous point that is off the map or touches a neighbour, and places that hero again', () => {
    const ids = idsOf(2);
    const outside = placeHeroes(new Map([[ids[0] as string, { x: 1.5, y: 0.2 }]]), ids, 3);
    expect(slotOf(outside.get(ids[0] as string) as Point)).toBeDefined();
    const crowded = placeHeroes(new Map([[ids[0] as string, { x: 0.5, y: 0.8 }], [ids[1] as string, { x: 0.51, y: 0.81 }]]), ids, 3);
    expect(pairsTooClose([...crowded.values()])).toBe(0);
    expect(crowded.get(ids[0] as string)).toEqual({ x: 0.5, y: 0.8 });
    const nan = placeHeroes(new Map([[ids[0] as string, { x: Number.NaN, y: 0.8 }]]), ids, 3);
    expect(Number.isFinite((nan.get(ids[0] as string) as Point).x)).toBe(true);
  });

  it('past the slot count, stands near the least-used region a cell apart (20 heroes)', () => {
    const points = [...placeHeroes(new Map(), idsOf(20), 5).values()];
    expect(points).toHaveLength(20);
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
