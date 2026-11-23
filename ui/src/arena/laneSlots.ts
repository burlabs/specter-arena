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
export const FAN_RADII_PX = [100, 130, 160, 190, 220, 250] as const;
export const FAN_ANGLE_STEP_DEG = 15;
/**
 * The click boxes of the tokens on the default map (860 px wide, 0.514 px per art pixel), in art pixels around the token's anchor
 * (x to the right, y down). A task is kept only where its box touches neither its hero's box nor an earlier task's box, so
 * every token stays clickable.
 */
export const HERO_BOX_PX = { left: -53, right: 53, top: -105, bottom: 25 } as const;
export const TASK_BOX_PX = { left: -35, right: 35, top: -56, bottom: 14 } as const;
const FAN_EDGE = { min: 0.03, max: 0.97 } as const;

type Box = { left: number; right: number; top: number; bottom: number };
const boxesApart = (a: Box, ax: number, ay: number, b: Box, bx: number, by: number): boolean =>
  ax + a.right <= bx + b.left || bx + b.right <= ax + a.left || ay + a.bottom <= by + b.top || by + b.bottom <= ay + a.top;

/** Whether two tasks standing at `a` and `b` have token boxes that do not touch. */
export const tasksApart = (a: NormalizedPoint, b: NormalizedPoint): boolean => boxesApart(TASK_BOX_PX, 0, 0, TASK_BOX_PX, (b.x - a.x) * WIDTH, (b.y - a.y) * HEIGHT);

/** Whether a task standing at `task` leaves the hero at `hero` clickable (their token boxes do not touch). */
export const clearOfHero = (hero: NormalizedPoint, task: NormalizedPoint): boolean =>
  boxesApart(HERO_BOX_PX, 0, 0, TASK_BOX_PX, (task.x - hero.x) * WIDTH, (task.y - hero.y) * HEIGHT);

/**
 * Where the nth task of a hero stands, as normalized map points in fan order. A candidate is kept when it is on the map and its
 * token box is clear of the hero's and of every box kept before it, so the list can hold fewer points than the rings offer.
 * Pure in its arguments.
 */
export function fanPoints(origin: NormalizedPoint, toward: { x: number; y: number }): NormalizedPoint[] {
  const points: NormalizedPoint[] = [];
  const offsets: { x: number; y: number }[] = [];
  const angles: number[] = [0];
  for (let degrees = FAN_ANGLE_STEP_DEG; degrees <= 90; degrees += FAN_ANGLE_STEP_DEG) angles.push(degrees, -degrees);
  for (const radius of FAN_RADII_PX) {
    for (const degrees of angles) {
      const angle = (degrees * Math.PI) / 180;
      const x = (toward.x * Math.cos(angle) - toward.y * Math.sin(angle)) * radius;
      const y = (toward.x * Math.sin(angle) + toward.y * Math.cos(angle)) * radius;
      const candidate = { x: origin.x + x / WIDTH, y: origin.y + y / HEIGHT };
      const onMap = candidate.x >= FAN_EDGE.min && candidate.x <= FAN_EDGE.max && candidate.y >= FAN_EDGE.min && candidate.y <= FAN_EDGE.max;
      if (onMap && boxesApart(HERO_BOX_PX, 0, 0, TASK_BOX_PX, x, y) && offsets.every((kept) => boxesApart(TASK_BOX_PX, kept.x, kept.y, TASK_BOX_PX, x, y))) {
        points.push(candidate);
        offsets.push({ x, y });
      }
    }
  }
  return points;
}

/** The direction from a point toward the far base: where tasks fan when the hero stands off the slot list. */
const towardFarBase = (point: NormalizedPoint): { x: number; y: number } => {
  const far = toPx(ARENA_LAYOUT.farBase);
  const here = toPx(point);
  return unit(far.x - here.x, far.y - here.y);
};

/** Which way tasks fan from a hero at `point`: the slot's own direction, or toward the far base when the hero stands off the slot list. */
export function fanDirection(point: NormalizedPoint): { x: number; y: number } {
  const slot = laneSlots().find((candidate) => Math.abs(candidate.point.x - point.x) < 1e-9 && Math.abs(candidate.point.y - point.y) < 1e-9);
  return slot?.toward ?? towardFarBase(point);
}
