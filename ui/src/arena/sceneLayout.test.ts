import { describe, expect, it } from 'vitest';
import { ARENA_INTRINSIC, ARENA_LAYOUT } from './mapLayout';
import { SLOT_COUNT, assignSlots, enemySlots, placeScene, pointAlongPath, slotIdsOf } from './sceneLayout';
import { buildSceneModel } from './sceneModel';
import { attemptOf, botOf, inputsOf, workOf } from './testData';

describe('slots', () => {
  it('offers 84 distinct points inside the map margins', () => {
    const slots = enemySlots();
    expect(slots).toHaveLength(SLOT_COUNT);
    expect(new Set(slots.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`)).size).toBe(SLOT_COUNT);
    for (const p of slots) {
      expect(p.x).toBeGreaterThanOrEqual(0.03);
      expect(p.x).toBeLessThanOrEqual(0.97);
      expect(p.y).toBeGreaterThanOrEqual(0.03);
      expect(p.y).toBeLessThanOrEqual(0.97);
    }
    expect(enemySlots()).toBe(slots);
  });

  it('keeps the map aspect', () => {
    expect(ARENA_INTRINSIC.width / ARENA_INTRINSIC.height).toBeCloseTo(1672 / 941, 5);
  });

  it('assigns distinct slots, keeps existing ones and reuses freed ones', () => {
    const first = assignSlots(new Map(), ['a', 'b', 'c']);
    expect([...first.values()]).toEqual([0, 1, 2]);
    const second = assignSlots(first, ['a', 'c', 'd']);
    expect(second.get('a')).toBe(0);
    expect(second.get('c')).toBe(2);
    expect(second.get('d')).toBe(1);
    expect(assignSlots(second, ['a', 'c', 'd'])).toEqual(second);
  });

  it('stops when slots run out and ignores a stale out-of-range slot', () => {
    const ids = Array.from({ length: 5 }, (_, i) => `w${i}`);
    expect(assignSlots(new Map(), ids, 3).size).toBe(3);
    expect(assignSlots(new Map([['w0', 99]]), ['w0'], 3).get('w0')).toBe(0);
    const duplicate = assignSlots(new Map([['a', 1], ['b', 1]]), ['a', 'b'], 3);
    expect(new Set(duplicate.values()).size).toBe(2);
  });

  it('keeps 80 enemies on 80 distinct slots', () => {
    const ids = Array.from({ length: 80 }, (_, i) => `w${i}`);
    expect(new Set(assignSlots(new Map(), ids).values()).size).toBe(80);
  });
});

describe('pointAlongPath', () => {
  it('walks a polyline by length and survives degenerate input', () => {
    const line = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    expect(pointAlongPath(line, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAlongPath(line, 0.5)).toEqual({ x: 1, y: 0 });
    expect(pointAlongPath(line, 1)).toEqual({ x: 1, y: 1 });
    expect(pointAlongPath(line, 7)).toEqual({ x: 1, y: 1 });
    expect(pointAlongPath([], 0.5)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointAlongPath([{ x: 0.2, y: 0.2 }], 0.5)).toEqual({ x: 0.2, y: 0.2 });
    expect(pointAlongPath([{ x: 0.2, y: 0.2 }, { x: 0.2, y: 0.2 }], 0.5)).toEqual({ x: 0.2, y: 0.2 });
  });
});

describe('nested and cyclic parents', () => {
  const rootId = workOf(3).workId;
  const childId = workOf(2).workId;
  const nested = buildSceneModel(inputsOf({ work: [workOf(1, { parentId: childId }), workOf(2, { parentId: rootId }), workOf(3)] }));

  it('rings a grandchild around its parent even when the grandchild sorts first', () => {
    const placement = placeScene(nested, assignSlots(new Map(), slotIdsOf(nested)));
    const child = placement.enemies.get(childId)!;
    const grandchild = placement.enemies.get(workOf(1).workId)!;
    expect(Math.hypot(grandchild.x - child.x, (grandchild.y - child.y) / 1.4)).toBeCloseTo(0.035, 2);
  });

  it('survives data where two items name each other as parent', () => {
    const cycle = buildSceneModel(inputsOf({ work: [workOf(1, { parentId: workOf(2).workId }), workOf(2, { parentId: workOf(1).workId })] }));
    expect(placeScene(cycle, assignSlots(new Map(), slotIdsOf(cycle))).enemies.size).toBe(2);
  });
});

describe('placeScene', () => {
  const bots = [botOf(1, { state: 'working' }), botOf(2, { state: 'working' }), botOf(3)];
  const work = [
    workOf(1, { childCount: 2, attempts: [attemptOf(bots[0]!, 1), attemptOf(bots[1]!, 2)] }),
    workOf(2, { parentId: workOf(1).workId }),
    workOf(3, { parentId: workOf(1).workId, attempts: [attemptOf(bots[0]!, 3)] }),
    workOf(4),
  ];
  const model = buildSceneModel(inputsOf({ roster: bots, work }));
  const placement = placeScene(model, assignSlots(new Map(), slotIdsOf(model)));

  it('gives every specter and enemy one position inside the margins', () => {
    expect(placement.specters.size).toBe(3);
    expect(placement.enemies.size).toBe(4);
    for (const p of [...placement.specters.values(), ...placement.enemies.values()]) {
      expect(p.x).toBeGreaterThanOrEqual(0.03);
      expect(p.y).toBeLessThanOrEqual(0.97);
    }
  });

  it('gives slots only to enemies whose parent is not on the field', () => {
    expect(slotIdsOf(model)).toEqual([work[0]!.workId, work[3]!.workId].sort());
  });

  it('rings children around their parent', () => {
    const parent = placement.enemies.get(work[0]!.workId)!;
    const child = placement.enemies.get(work[1]!.workId)!;
    expect(Math.hypot(child.x - parent.x, (child.y - parent.y) / 1.4)).toBeCloseTo(0.035, 2);
  });

  it('stands an engaged specter short of its enemy and fans out specters sharing one', () => {
    const target = placement.enemies.get(model.specters[0]!.engagedWorkIds[0]!)!;
    const a = placement.specters.get(bots[0]!.bindingId)!;
    const b = placement.specters.get(bots[1]!.bindingId)!;
    expect(Math.hypot(a.x - target.x, a.y - target.y)).toBeGreaterThan(0.02);
    expect(a).not.toEqual(b);
  });

  it('stages specters with no engagement on a grid at the allied base', () => {
    const rest = placement.specters.get(bots[2]!.bindingId)!;
    expect(Math.abs(rest.x - ARENA_LAYOUT.alliedBase.x)).toBeLessThan(0.15);
  });

  it('falls back to the centre for an enemy that has no slot, and a child whose parent has none', () => {
    const lonely = placeScene(model, new Map());
    expect(lonely.enemies.get(work[3]!.workId)).toEqual({ x: 0.5, y: 0.5 });
    const outOfRange = placeScene(model, new Map([[work[3]!.workId, 9999]]));
    expect(outOfRange.enemies.get(work[3]!.workId)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('stages specters of a model with no enemies', () => {
    const empty = placeScene(buildSceneModel(inputsOf({ roster: bots })), new Map());
    expect(empty.specters.size).toBe(3);
  });

  it('is deterministic', () => {
    expect(placeScene(model, assignSlots(new Map(), slotIdsOf(model)))).toEqual(placement);
  });
});
