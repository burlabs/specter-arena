import { seedOf } from './exchangePlanner';
import { ARENA_INTRINSIC } from './mapLayout';
import { REGIONS, laneSlots } from './laneSlots';
import type { Region, Slot } from './laneSlots';
import type { Point } from './sceneLayout';
import { specterSlot } from './sceneLayout';

/** The one seed heroes are placed from, so a hero stands on the same spot at every visit. */
export const PLACEMENT_SEED = 0x5eed;
export const PLACEMENT_TRIES = 12;
/** Three staging rows of seven (FP-23): the last resort when no jittered point is clear. */
export const STAGING_CELLS = 21;
/** A hero that stands off the slot list is jittered this far from a slot of the least-used region (map units). */
export const FALLBACK_JITTER = 0.04;
/** Two heroes on slots or jitter points stand at least this far apart, in art pixels (map 1672 x 941); about 51 px on an 860 px map. */
export const HERO_GAP_PX = 100;

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

const gapPx = (a: Point, b: Point): number => Math.hypot((a.x - b.x) * ARENA_INTRINSIC.width, (a.y - b.y) * ARENA_INTRINSIC.height);
const clear = (point: Point, placed: readonly Point[]): boolean => placed.every((other) => gapPx(point, other) >= HERO_GAP_PX);
const onMap = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0.03 && point.x <= 0.97 && point.y >= 0.03 && point.y <= 0.97;
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const same = (a: Point, b: Point): boolean => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

/** The region of a point that is exactly a slot, or null for a fallback point. */
const regionOf = (point: Point, slots: readonly Slot[]): Region | null => slots.find((slot) => same(slot.point, point))?.region ?? null;

/**
 * Where each hero stands. Pure in `(previous, bindingIds, seed)`; the page always passes `PLACEMENT_SEED`, so the same bots stand on the same spots at every visit. A hero that already has a valid point keeps it. Each new
 * hero, in sorted id order, draws from its own stream `mulberry32(seedOf(seed:id))`: it takes a region that holds the fewest
 * heroes so far (a tie is broken by its own draw), then a random free slot of that region. When the region has no free slot
 * the hero stands near a slot of the least-used region, and last of all on a staging cell. The region is a spread rule only:
 * nothing here reads a role, a condition or progress, and no region name leaves this function.
 */
export function placeHeroes(previous: ReadonlyMap<string, Point>, bindingIds: readonly string[], seed: number = PLACEMENT_SEED): Map<string, Point> {
  const slots = laneSlots();
  const ids = [...new Set(bindingIds)].sort(compareText);
  const next = new Map<string, Point>();
  const placed: Point[] = [];
  const counts = new Map<Region, number>(REGIONS.map((region) => [region, 0]));
  const count = (point: Point) => {
    const region = regionOf(point, slots);
    if (region !== null) counts.set(region, (counts.get(region) ?? 0) + 1);
  };
  for (const id of ids) {
    const kept = previous.get(id);
    if (kept !== undefined && onMap(kept) && clear(kept, placed)) {
      next.set(id, kept);
      placed.push(kept);
      count(kept);
    }
  }
  for (const id of ids.filter((candidate) => !next.has(candidate))) {
    const random = mulberry32(seedOf(`${seed >>> 0}:${id}`));
    const free = (region: Region) => slots.filter((slot) => slot.region === region && clear(slot.point, placed));
    const open = REGIONS.filter((region) => free(region).length > 0);
    let chosen: Point | null = null;
    if (open.length > 0) {
      const fewest = Math.min(...open.map((region) => counts.get(region) ?? 0));
      const tied = open.filter((region) => (counts.get(region) ?? 0) === fewest);
      const region = tied[Math.floor(random() * tied.length)] as Region;
      const options = free(region);
      chosen = (options[Math.floor(random() * options.length)] as Slot).point;
    } else {
      const fewest = Math.min(...REGIONS.map((region) => counts.get(region) ?? 0));
      const tied = REGIONS.filter((region) => (counts.get(region) ?? 0) === fewest);
      const region = tied[Math.floor(random() * tied.length)] as Region;
      const near = slots.filter((slot) => slot.region === region);
      for (let attempt = 0; attempt < PLACEMENT_TRIES && chosen === null; attempt += 1) {
        const anchor = (near[Math.floor(random() * near.length)] as Slot).point;
        const candidate = { x: anchor.x + (random() * 2 - 1) * FALLBACK_JITTER, y: anchor.y + (random() * 2 - 1) * FALLBACK_JITTER };
        if (onMap(candidate) && clear(candidate, placed)) chosen = candidate;
      }
      for (let slot = 0; slot < STAGING_CELLS && chosen === null; slot += 1) {
        const cell = specterSlot(slot);
        if (clear(cell, placed)) chosen = cell;
      }
    }
    const point = chosen ?? specterSlot(placed.length);
    next.set(id, point);
    placed.push(point);
    count(point);
  }
  return next;
}
