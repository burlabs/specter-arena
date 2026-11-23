import { clamp } from './geometry';
import type { NormalizedPoint } from './geometry';
import { fanDirection, fanPoints } from './laneSlots';
import { ARENA_LAYOUT } from './mapLayout';
import type { SceneEnemy, SceneModel } from './sceneModel';

export type Point = NormalizedPoint;

/**
 * Minimum spacing between two tokens of one kind, in 0..1 map units. At the default fit (a map about 700 px
 * wide and 400 px high) these are about 91 x 64 px for a Specter and 35 x 38 px for an enemy sprite, which is
 * the room each token and its always-visible text needs.
 */
export const SPECTER_CELL = { x: 0.135, y: 0.16 } as const;
export const ENEMY_CELL = { x: 0.05, y: 0.095 } as const;

const SPECTER_COLUMNS = 7;
const SPECTER_BASE_X = 0.06;
const SPECTER_BASE_Y = 0.95;
const ENEMY_COLUMNS = 17;
const ENEMY_ROWS = 5;
const ENEMY_BASE_X = 0.08;
const ENEMY_BASE_Y = 0.08;
const EDGE_MIN = 0.03;
const EDGE_MAX = 0.97;

export const SLOT_COUNT = ENEMY_COLUMNS * ENEMY_ROWS;

/** Two points are far enough apart for one cell when they differ by a whole cell in x or in y. The one spacing rule: hero placement and the layout tests both use it. */
export const apart = (a: Point, b: Point, cell: { x: number; y: number }): boolean => Math.abs(a.x - b.x) >= cell.x - 1e-9 || Math.abs(a.y - b.y) >= cell.y - 1e-9;

const clampPoint = (point: Point): Point => ({ x: clamp(point.x, EDGE_MIN, EDGE_MAX), y: clamp(point.y, EDGE_MIN, EDGE_MAX) });

function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

function distanceToPaths(point: Point): number {
  let nearest = Infinity;
  for (const path of ARENA_LAYOUT.paths) {
    for (let index = 1; index < path.points.length; index += 1) {
      nearest = Math.min(nearest, distanceToSegment(point, path.points[index - 1] as Point, path.points[index] as Point));
    }
  }
  return nearest;
}

let cachedSlots: readonly Point[] | null = null;

/**
 * A lattice above the Specter staging rows, ordered by distance to the map's paths so the first enemies stand
 * on or beside a path. Every point is at least ENEMY_CELL away from every other.
 */
export function enemySlots(): readonly Point[] {
  if (cachedSlots !== null) return cachedSlots;
  const lattice: Point[] = [];
  for (let row = 0; row < ENEMY_ROWS; row += 1) {
    for (let column = 0; column < ENEMY_COLUMNS; column += 1) {
      lattice.push({ x: ENEMY_BASE_X + column * ENEMY_CELL.x, y: ENEMY_BASE_Y + row * ENEMY_CELL.y });
    }
  }
  const ranked = lattice.map((point, index) => ({ point, index, distance: distanceToPaths(point) }));
  ranked.sort((a, b) => a.distance - b.distance || a.index - b.index);
  cachedSlots = ranked.map((entry) => clampPoint(entry.point));
  return cachedSlots;
}

/** Existing assignments survive; new ids take the lowest free slot; ids that left free theirs. Pure. */
export function assignSlots(previous: ReadonlyMap<string, number>, workIds: readonly string[], slotCount: number = SLOT_COUNT): Map<string, number> {
  const next = new Map<string, number>();
  const taken = new Set<number>();
  for (const id of workIds) {
    const slot = previous.get(id);
    if (slot !== undefined && slot < slotCount && !taken.has(slot)) {
      next.set(id, slot);
      taken.add(slot);
    }
  }
  let free = 0;
  for (const id of workIds) {
    if (next.has(id)) continue;
    while (taken.has(free)) free += 1;
    if (free >= slotCount) break;
    next.set(id, free);
    taken.add(free);
  }
  return next;
}

/**
 * The hero a task stands beside: the first hero in `engagedBy` that is drawn, or null. A task with no drawn hero keeps a lattice slot.
 */
export function ownerOf(enemy: SceneEnemy, heroPoints: ReadonlyMap<string, Point>): string | null {
  return enemy.engagedBy.find((bindingId) => heroPoints.has(bindingId)) ?? null;
}

/**
 * Which fan seat each owned task takes, per hero: existing seats survive, new tasks take the lowest free seat, and a task that
 * finds no seat (more tasks than seats) is left out and falls back to the lattice. Pure in its arguments.
 */
export function assignFans(previous: ReadonlyMap<string, number>, model: SceneModel, heroPoints: ReadonlyMap<string, Point>): Map<string, number> {
  const byOwner = new Map<string, string[]>();
  for (const enemy of model.enemies) {
    const owner = ownerOf(enemy, heroPoints);
    if (owner !== null) byOwner.set(owner, [...(byOwner.get(owner) ?? []), enemy.workId]);
  }
  const next = new Map<string, number>();
  for (const [owner, ids] of byOwner) {
    const origin = heroPoints.get(owner) as Point;
    const seats = fanPoints(origin, fanDirection(origin)).length;
    for (const [id, seat] of assignSlots(previous, ids, seats)) next.set(id, seat);
  }
  return next;
}

/** Tasks that have no fan seat take lattice slots, so none stands on another. */
export function slotIdsOf(model: SceneModel, fans: ReadonlyMap<string, number> = new Map()): string[] {
  return model.enemies.filter((enemy) => !fans.has(enemy.workId)).map((enemy) => enemy.workId);
}

export interface Placement {
  specters: Map<string, Point>;
  enemies: Map<string, Point>;
}

/** The staging cell of the nth Specter: rows of seven from the bottom of the map upwards. */
export function specterSlot(index: number): Point {
  const column = index % SPECTER_COLUMNS;
  const row = Math.floor(index / SPECTER_COLUMNS);
  return clampPoint({ x: SPECTER_BASE_X + column * SPECTER_CELL.x, y: SPECTER_BASE_Y - row * SPECTER_CELL.y });
}

/**
 * Where every Specter and enemy stands. A Specter stands on the point `heroPoints` gives it, or on its own staging cell when
 * it has none, whatever it is doing. An engagement is shown by a line to the enemy, so one position per Specter and nothing
 * here reads a role or a lane.
 */
export function placeScene(model: SceneModel, slots: ReadonlyMap<string, number>, heroPoints: ReadonlyMap<string, Point> = new Map(), fans: ReadonlyMap<string, number> = new Map()): Placement {
  const slotPoints = enemySlots();
  const center: Point = { x: 0.5, y: 0.5 };
  const specters = new Map<string, Point>();
  model.specters.forEach((specter, index) => specters.set(specter.bindingId, heroPoints.get(specter.bindingId) ?? specterSlot(index)));
  const enemies = new Map<string, Point>();
  for (const enemy of model.enemies) {
    const owner = ownerOf(enemy, specters);
    const seat = fans.get(enemy.workId);
    const origin = owner === null ? undefined : specters.get(owner);
    const fanned = origin !== undefined && seat !== undefined ? fanPoints(origin, fanDirection(origin))[seat] : undefined;
    const slot = slots.get(enemy.workId);
    enemies.set(enemy.workId, fanned ?? (slot === undefined ? center : (slotPoints[slot] ?? center)));
  }
  return { specters, enemies };
}
