import { clamp } from './geometry';
import type { NormalizedPoint } from './geometry';
import { ARENA_LAYOUT } from './mapLayout';
import type { SceneModel } from './sceneModel';

export type Point = NormalizedPoint;

export const SLOT_COUNT = 84;
const SAMPLES_PER_PATH = 26;
/** Coprime with 26, so the first few enemies spread along each path instead of bunching at its start. */
const SAMPLE_STRIDE = 9;
const EDGE_MIN = 0.03;
const EDGE_MAX = 0.97;
const RING_RADIUS = 0.035;
const ENGAGE_GAP = 0.055;
const ENGAGE_SPREAD = 0.03;
const STAGING_COLUMNS = 4;
const STAGING_STEP_X = 0.037;
const STAGING_STEP_Y = 0.052;

const clampPoint = (point: Point): Point => ({ x: clamp(point.x, EDGE_MIN, EDGE_MAX), y: clamp(point.y, EDGE_MIN, EDGE_MAX) });

/** The point at fraction `t` of the polyline's length. */
export function pointAlongPath(points: readonly Point[], t: number): Point {
  const first = points[0];
  if (first === undefined) return { x: 0.5, y: 0.5 };
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1] as Point;
    const to = points[index] as Point;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    lengths.push(length);
    total += length;
  }
  let remaining = clamp(t, 0, 1) * total;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] as number;
    if (remaining <= length || index === lengths.length - 1) {
      const from = points[index] as Point;
      const to = points[index + 1] as Point;
      const fraction = length === 0 ? 0 : clamp(remaining / length, 0, 1);
      return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
    }
    remaining -= length;
  }
  return first;
}

let cachedSlots: readonly Point[] | null = null;

/** 3 paths x 26 samples (0.10 to 0.90), taken in a spread order and interleaved round-robin, then the three clearings and the three crossings. */
export function enemySlots(): readonly Point[] {
  if (cachedSlots !== null) return cachedSlots;
  const slots: Point[] = [];
  for (let step = 0; step < SAMPLES_PER_PATH; step += 1) {
    const sample = (step * SAMPLE_STRIDE) % SAMPLES_PER_PATH;
    const t = 0.1 + (0.8 * sample) / (SAMPLES_PER_PATH - 1);
    for (const path of ARENA_LAYOUT.paths) slots.push(clampPoint(pointAlongPath(path.points, t)));
  }
  for (const site of [...ARENA_LAYOUT.clearings, ...ARENA_LAYOUT.crossings]) slots.push(clampPoint(site));
  cachedSlots = slots;
  return slots;
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

/** Enemies that take a map slot: everything whose parent is not itself on the field. */
export function slotIdsOf(model: SceneModel): string[] {
  const onField = new Set(model.enemies.map((enemy) => enemy.workId));
  return model.enemies.filter((enemy) => enemy.parentId === null || !onField.has(enemy.parentId)).map((enemy) => enemy.workId);
}

export interface Placement {
  specters: Map<string, Point>;
  enemies: Map<string, Point>;
}

/** Specters standing on staging are placed row by row up from the allied base. */
function stagingPoint(index: number): Point {
  const column = index % STAGING_COLUMNS;
  const row = Math.floor(index / STAGING_COLUMNS);
  return clampPoint({
    x: ARENA_LAYOUT.alliedBase.x + column * STAGING_STEP_X - 0.04,
    y: ARENA_LAYOUT.alliedBase.y - row * STAGING_STEP_Y,
  });
}

/** Where every Specter and enemy stands. One position per Specter; nothing here reads a role or a lane. */
export function placeScene(model: SceneModel, slots: ReadonlyMap<string, number>): Placement {
  const slotPoints = enemySlots();
  const center: Point = { x: 0.5, y: 0.5 };
  const enemies = new Map<string, Point>();
  const onField = new Set(model.enemies.map((enemy) => enemy.workId));
  const siblings = new Map<string, number>();
  for (const enemy of model.enemies) {
    const parentOnField = enemy.parentId !== null && onField.has(enemy.parentId);
    if (!parentOnField) {
      const slot = slots.get(enemy.workId);
      enemies.set(enemy.workId, slot === undefined ? center : (slotPoints[slot] ?? center));
    }
  }
  const parentOf = new Map(model.enemies.map((enemy) => [enemy.workId, enemy.parentId]));
  const depthOf = (workId: string): number => {
    let depth = 0;
    let cursor = parentOf.get(workId) ?? null;
    while (cursor !== null && onField.has(cursor) && depth <= model.enemies.length) {
      depth += 1;
      cursor = parentOf.get(cursor) ?? null;
    }
    return depth;
  };
  const children = model.enemies.filter((enemy) => enemy.parentId !== null && onField.has(enemy.parentId)).sort((a, b) => depthOf(a.workId) - depthOf(b.workId));
  for (const enemy of children) {
    if (enemy.parentId === null) continue;
    const parent = enemies.get(enemy.parentId) ?? center;
    const index = siblings.get(enemy.parentId) ?? 0;
    siblings.set(enemy.parentId, index + 1);
    const angle = (index * Math.PI * 2) / 6 + Math.PI / 6;
    enemies.set(enemy.workId, clampPoint({ x: parent.x + Math.cos(angle) * RING_RADIUS, y: parent.y + Math.sin(angle) * RING_RADIUS * 1.4 }));
  }

  const specters = new Map<string, Point>();
  const rankByTarget = new Map<string, number>();
  let stagingIndex = 0;
  for (const specter of model.specters) {
    const target = specter.engagedWorkIds.find((id) => enemies.has(id));
    const targetPoint = target === undefined ? undefined : enemies.get(target);
    if (target === undefined || targetPoint === undefined) {
      specters.set(specter.bindingId, stagingPoint(stagingIndex));
      stagingIndex += 1;
      continue;
    }
    const rank = rankByTarget.get(target) ?? 0;
    rankByTarget.set(target, rank + 1);
    const dx = ARENA_LAYOUT.alliedBase.x - targetPoint.x;
    const dy = ARENA_LAYOUT.alliedBase.y - targetPoint.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    specters.set(
      specter.bindingId,
      clampPoint({
        x: targetPoint.x + ux * ENGAGE_GAP - uy * rank * ENGAGE_SPREAD,
        y: targetPoint.y + uy * ENGAGE_GAP + ux * rank * ENGAGE_SPREAD,
      }),
    );
  }
  return { specters, enemies };
}
