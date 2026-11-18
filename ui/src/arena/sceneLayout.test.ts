import { setArenaScenario, useAppApi } from '@kirocrew/app-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import type { RosterItemV1, WorkItemV1 } from '../contracts/types';
import { rosterPath, workListPath } from '../host/paths';
import { ARENA_INTRINSIC } from './mapLayout';
import { ENEMY_CELL, SLOT_COUNT, SPECTER_CELL, assignSlots, enemySlots, placeScene, slotIdsOf, specterSlot } from './sceneLayout';
import type { Point } from './sceneLayout';
import { buildSceneModel } from './sceneModel';
import { attemptOf, botOf, inputsOf, workOf } from './testData';

afterEach(() => setArenaScenario(null));

const apart = (a: Point, b: Point, cell: { x: number; y: number }): boolean => Math.abs(a.x - b.x) >= cell.x - 1e-9 || Math.abs(a.y - b.y) >= cell.y - 1e-9;

function pairsTooClose(points: readonly Point[], cell: { x: number; y: number }): number[][] {
  const bad: number[][] = [];
  for (let i = 0; i < points.length; i += 1) for (let j = i + 1; j < points.length; j += 1) if (!apart(points[i] as Point, points[j] as Point, cell)) bad.push([i, j]);
  return bad;
}

const FIXTURE_NOW_MS = 1794916800000;
const client = useAppApi();
const read = async <T>(path: string): Promise<T> => (await ((await client.get(path)) as Response).json()) as T;

async function modelOf(scenario: 'arena' | 'arena-perf-1') {
  setArenaScenario(scenario);
  const roster = (await read<{ items: RosterItemV1[] }>(rosterPath(100, null))).items;
  const work: WorkItemV1[] = [];
  for (const state of ['open', 'awaiting-review', 'blocked', 'reopened', 'accepted']) {
    let cursor: string | null = null;
    do {
      const page: { items: WorkItemV1[]; nextCursor: string | null } = await read(workListPath(state, 25, cursor));
      work.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
  }
  return buildSceneModel(inputsOf({ nowMs: FIXTURE_NOW_MS, roster, work }));
}

describe('slots', () => {
  it('offers 85 distinct lattice points inside the margins, none closer than one enemy cell', () => {
    const slots = enemySlots();
    expect(slots).toHaveLength(SLOT_COUNT);
    expect(pairsTooClose(slots, ENEMY_CELL)).toEqual([]);
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

describe('staging', () => {
  it('gives the first Specters a full row of seven, then the next row up', () => {
    const first = specterSlot(0);
    expect(specterSlot(6).y).toBe(first.y);
    expect(specterSlot(7).y).toBeCloseTo(first.y - SPECTER_CELL.y);
    expect(specterSlot(7).x).toBe(first.x);
    expect(pairsTooClose(Array.from({ length: 21 }, (_, i) => specterSlot(i)), SPECTER_CELL)).toEqual([]);
  });
});

describe('placeScene on the demo scenarios', () => {
  it.each(['arena', 'arena-perf-1'] as const)('%s: no two Specters and no two enemies are closer than their cell, and enemies stay above the staging rows', async (scenario) => {
    const model = await modelOf(scenario);
    const placement = placeScene(model, assignSlots(new Map(), slotIdsOf(model)));
    expect(placement.specters.size).toBe(model.specters.length);
    expect(placement.enemies.size).toBe(model.enemies.length);
    expect(pairsTooClose([...placement.specters.values()], SPECTER_CELL)).toEqual([]);
    expect(pairsTooClose([...placement.enemies.values()], ENEMY_CELL)).toEqual([]);
    const lowestEnemy = Math.max(...[...placement.enemies.values()].map((p) => p.y));
    const highestSpecter = Math.min(...[...placement.specters.values()].map((p) => p.y));
    expect(highestSpecter - lowestEnemy).toBeGreaterThanOrEqual(0.12);
    for (const p of [...placement.specters.values(), ...placement.enemies.values()]) {
      expect(p.x).toBeGreaterThanOrEqual(0.03);
      expect(p.x).toBeLessThanOrEqual(0.97);
      expect(p.y).toBeGreaterThanOrEqual(0.03);
      expect(p.y).toBeLessThanOrEqual(0.97);
    }
  });

  it('draws 20 Specters and 80 enemies for arena-perf-1', async () => {
    const model = await modelOf('arena-perf-1');
    expect(model.specters).toHaveLength(20);
    expect(model.enemies).toHaveLength(80);
  });
});

describe('placeScene', () => {
  const bots = [botOf(1, { state: 'working' }), botOf(2, { state: 'working' }), botOf(3)];
  const work = [workOf(1, { childCount: 1, attempts: [attemptOf(bots[0]!, 1), attemptOf(bots[1]!, 2)] }), workOf(2, { parentId: workOf(1).workId }), workOf(3)];
  const model = buildSceneModel(inputsOf({ roster: bots, work }));
  const placement = placeScene(model, assignSlots(new Map(), slotIdsOf(model)));

  it('keeps a Specter on its own staging cell whether or not it is engaged', () => {
    expect([...placement.specters.values()]).toEqual([specterSlot(0), specterSlot(1), specterSlot(2)]);
  });

  it('gives every enemy a slot, children included', () => {
    expect(slotIdsOf(model)).toEqual(model.enemies.map((enemy) => enemy.workId));
    expect(placement.enemies.size).toBe(3);
  });

  it('falls back to the centre for an enemy that has no slot or a slot out of range', () => {
    expect(placeScene(model, new Map()).enemies.get(work[2]!.workId)).toEqual({ x: 0.5, y: 0.5 });
    expect(placeScene(model, new Map([[work[2]!.workId, 9999]])).enemies.get(work[2]!.workId)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('is deterministic', () => {
    expect(placeScene(model, assignSlots(new Map(), slotIdsOf(model)))).toEqual(placement);
  });
});
