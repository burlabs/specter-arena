import { clamp } from './geometry';
import type { NormalizedPoint } from './geometry';
import { ARENA_INTRINSIC, ARENA_LAYOUT } from './mapLayout';

/**
 * Where a hero may stand, and which way its tasks fan out. A slot is a point on one of the map's three paths or on one of
 * its three clearings. The `region` only keeps the spread even; it is never shown, never a role, a team, a capability or
 * progress, and nothing outside the placement code reads it.
 */
export type Region = 'path-1' | 'path-2' | 'path-3' | 'clearings';
export const REGIONS: readonly Region[] = ['path-1', 'path-2', 'path-3', 'clearings'];

export interface Slot {
  point: NormalizedPoint;
  region: Region;
  /** Unit vector, in art pixels, toward the enemy side of the map. */
  toward: { x: number; y: number };
}

/** Arc length between neighbouring path slots, in art pixels (map 1672 x 941). */
export const SLOT_SPACING_PX = 160;
/** Path slots start and stop this far from the two junctions the three paths share. */
export const JUNCTION_MARGIN_PX = 110;
/** No two slots stand closer than this, in art pixels. */
export const MIN_SLOT_GAP_PX = 105;

const WIDTH = ARENA_INTRINSIC.width;
const HEIGHT = ARENA_INTRINSIC.height;
const toPx = (point: NormalizedPoint) => ({ x: point.x * WIDTH, y: point.y * HEIGHT });
const unit = (dx: number, dy: number) => {
  const length = Math.hypot(dx, dy);
  return length === 0 ? { x: 1, y: 0 } : { x: dx / length, y: dy / length };
};

function pathSlots(region: Region, points: readonly NormalizedPoint[]): Slot[] {
  const pixels = points.map(toPx);
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < pixels.length; index += 1) {
    const from = pixels[index - 1] as { x: number; y: number };
    const to = pixels[index] as { x: number; y: number };
    total += Math.hypot(to.x - from.x, to.y - from.y);
    lengths.push(total);
  }
  const slots: Slot[] = [];
  for (let at = JUNCTION_MARGIN_PX; at <= total - JUNCTION_MARGIN_PX + 1e-9; at += SLOT_SPACING_PX) {
    let segment = lengths.findIndex((end) => end >= at);
    if (segment === -1) segment = lengths.length - 1;
    const from = pixels[segment] as { x: number; y: number };
    const to = pixels[segment + 1] as { x: number; y: number };
    const start = segment === 0 ? 0 : (lengths[segment - 1] as number);
    const t = clamp((at - start) / ((lengths[segment] as number) - start), 0, 1);
    slots.push({
      point: { x: (from.x + (to.x - from.x) * t) / WIDTH, y: (from.y + (to.y - from.y) * t) / HEIGHT },
      region,
      toward: unit(to.x - from.x, to.y - from.y),
    });
  }
  return slots;
}

let cached: readonly Slot[] | null = null;

/** The fixed slot list, in a stable order: path 1, path 2, path 3, then the clearings. Pure and cached. */
export function laneSlots(): readonly Slot[] {
  if (cached !== null) return cached;
  const far = toPx(ARENA_LAYOUT.farBase);
  const slots: Slot[] = [];
  const [first, second, third] = ARENA_LAYOUT.paths;
  slots.push(...pathSlots('path-1', first.points), ...pathSlots('path-2', second.points), ...pathSlots('path-3', third.points));
  for (const clearing of ARENA_LAYOUT.clearings) {
    const here = toPx(clearing);
    slots.push({ point: { x: clearing.x, y: clearing.y }, region: 'clearings', toward: unit(far.x - here.x, far.y - here.y) });
  }
  // Clearings are kept; a path slot within MIN_SLOT_GAP_PX of one already kept is dropped, so every pair of slots is that far apart.
  const kept: Slot[] = slots.filter((slot) => slot.region === 'clearings');
  for (const slot of slots) {
    if (slot.region !== 'clearings' && kept.every((other) => Math.hypot(toPx(slot.point).x - toPx(other.point).x, toPx(slot.point).y - toPx(other.point).y) >= MIN_SLOT_GAP_PX)) kept.push(slot);
  }
  cached = [...kept.filter((slot) => slot.region !== 'clearings'), ...kept.filter((slot) => slot.region === 'clearings')];
  return cached;
}

/**
 * Candidate rings for the tasks beside a hero, in art pixels, nearest ring first. An angle is measured from "toward the enemy
 * side"; the order inside a ring is 0, +step, -step, +2 step, and so on.
 */
export const FAN_RINGS: readonly { radius: number; angles: readonly number[] }[] = [
  { radius: 100, angles: [0, 45, -45, 90, -90] },
  { radius: 180, angles: [0, 20, -20, 40, -40, 60, -60, 80, -80] },
  { radius: 260, angles: [0, 15, -15, 30, -30, 45, -45, 60, -60] },
];
/** A task needs this much room from every other task and from its hero, in x or in y (art pixels): a large minion is about 70 px wide on the default map. */
export const FAN_BOX_PX = 80;
const FAN_EDGE = { min: 0.03, max: 0.97 } as const;

const boxApart = (a: NormalizedPoint, b: NormalizedPoint): boolean => Math.abs(a.x - b.x) * WIDTH >= FAN_BOX_PX - 1e-9 || Math.abs(a.y - b.y) * HEIGHT >= FAN_BOX_PX - 1e-9;

/**
 * Where the nth task of a hero stands, as normalized map points in fan order. A candidate is kept when it is on the map and
 * a box apart from the hero and from every point kept before it, so the list can hold fewer points than the rings offer.
 * Pure in its arguments.
 */
export function fanPoints(origin: NormalizedPoint, toward: { x: number; y: number }): NormalizedPoint[] {
  const points: NormalizedPoint[] = [];
  for (const ring of FAN_RINGS) {
    for (const degrees of ring.angles) {
      const angle = (degrees * Math.PI) / 180;
      const dx = toward.x * Math.cos(angle) - toward.y * Math.sin(angle);
      const dy = toward.x * Math.sin(angle) + toward.y * Math.cos(angle);
      const candidate = { x: origin.x + (dx * ring.radius) / WIDTH, y: origin.y + (dy * ring.radius) / HEIGHT };
      const onMap = candidate.x >= FAN_EDGE.min && candidate.x <= FAN_EDGE.max && candidate.y >= FAN_EDGE.min && candidate.y <= FAN_EDGE.max;
      if (onMap && boxApart(candidate, origin) && points.every((kept) => boxApart(candidate, kept))) points.push(candidate);
    }
  }
  return points;
}

/** The direction from a point toward the far base: where tasks fan when the hero stands off the slot list. */
export const towardFarBase = (point: NormalizedPoint): { x: number; y: number } => {
  const far = toPx(ARENA_LAYOUT.farBase);
  const here = toPx(point);
  return unit(far.x - here.x, far.y - here.y);
};

/** Which way tasks fan from a hero at `point`: the slot's own direction, or toward the far base when the hero stands off the slot list. */
export function fanDirection(point: NormalizedPoint): { x: number; y: number } {
  const slot = laneSlots().find((candidate) => Math.abs(candidate.point.x - point.x) < 1e-9 && Math.abs(candidate.point.y - point.y) < 1e-9);
  return slot?.toward ?? towardFarBase(point);
}
