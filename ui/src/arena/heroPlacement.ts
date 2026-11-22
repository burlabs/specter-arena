import { seedOf } from './exchangePlanner';
import type { Point } from './sceneLayout';
import { SPECTER_CELL, apart, specterSlot } from './sceneLayout';

/** Where a hero may stand: the lower band of the map, below the enemy lattice (its lowest row is y 0.46). */
export const HERO_REGION = { xMin: 0.06, xMax: 0.94, yMin: 0.6, yMax: 0.95 } as const;
export const PLACEMENT_TRIES = 12;
/** Three staging rows of seven: y 0.95, 0.79 and 0.63, all inside `HERO_REGION`. */
export const STAGING_CELLS = 21;

/** mulberry32: a 32-bit seeded generator that returns numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const clear = (point: Point, placed: readonly Point[]): boolean => placed.every((other) => apart(point, other, SPECTER_CELL));

const freeStagingCells = (placed: readonly Point[]): number => {
  let free = 0;
  for (let index = 0; index < STAGING_CELLS; index += 1) if (clear(specterSlot(index), placed)) free += 1;
  return free;
};

const inRegion = (point: Point): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= HERO_REGION.xMin && point.x <= HERO_REGION.xMax && point.y >= HERO_REGION.yMin && point.y <= HERO_REGION.yMax;

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Where each hero stands. Pure in `(previous, bindingIds, visitSeed)`: a hero that already has a valid point keeps it,
 * and each new one is drawn from its own stream `mulberry32(seedOf(seed:id))` (the arena's shared FNV-1a hash), so the result does not depend on the order
 * heroes arrive in. Nothing here reads a role, a lane, a condition or progress.
 */
export function placeHeroes(previous: ReadonlyMap<string, Point>, bindingIds: readonly string[], visitSeed: number): Map<string, Point> {
  const ids = [...new Set(bindingIds)].sort(compareText);
  const next = new Map<string, Point>();
  const placed: Point[] = [];
  for (const id of ids) {
    const kept = previous.get(id);
    if (kept !== undefined && inRegion(kept) && clear(kept, placed)) {
      next.set(id, kept);
      placed.push(kept);
    }
  }
  const fresh = ids.filter((id) => !next.has(id));
  fresh.forEach((id, index) => {
    const remaining = fresh.length - 1 - index;
    const random = mulberry32(seedOf(`${visitSeed >>> 0}:${id}`));
    const freeBefore = freeStagingCells(placed);
    let chosen: Point | null = null;
    for (let attempt = 0; attempt < PLACEMENT_TRIES && chosen === null; attempt += 1) {
      const candidate = {
        x: HERO_REGION.xMin + random() * (HERO_REGION.xMax - HERO_REGION.xMin),
        y: HERO_REGION.yMin + random() * (HERO_REGION.yMax - HERO_REGION.yMin),
      };
      if (clear(candidate, placed) && freeStagingCells([...placed, candidate]) >= Math.min(remaining, freeBefore - 1)) chosen = candidate;
    }
    if (chosen === null) {
      const scan = STAGING_CELLS + placed.length;
      for (let slot = 0; slot < scan && chosen === null; slot += 1) {
        const cell = specterSlot(slot);
        if (clear(cell, placed)) chosen = cell;
      }
    }
    const point = chosen ?? specterSlot(placed.length);
    next.set(id, point);
    placed.push(point);
  });
  return next;
}
