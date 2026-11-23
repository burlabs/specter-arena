import { setArenaScenario, useAppApi } from '@kirocrew/app-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import type { RosterItemV1, TaskItemV1 } from '../contracts/types';
import { rosterPath, tasksPath } from '../host/paths';
import { ARENA_INTRINSIC } from './mapLayout';
import { placeHeroes } from './heroPlacement';
import { clearOfHero, tasksApart } from './laneSlots';
import { ENEMY_CELL, SLOT_COUNT, SPECTER_CELL, apart, assignFans, assignSlots, blockedSlots, enemySlots, fanTaskPoints, ownerOf, placeScene, slotIdsOf, specterSlot } from './sceneLayout';
import type { Point } from './sceneLayout';
import { buildSceneModel } from './sceneModel';
import { botOf, inputsOf, taskOf } from './testData';

afterEach(() => setArenaScenario(null));

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
  const tasks: TaskItemV1[] = [];
  for (const state of ['open', 'credited', 'not-credited'] as const) {
    let cursor: string | null = null;
    do {
      const page: { items: TaskItemV1[]; nextCursor: string | null } = await read(tasksPath({ state, limit: 25, cursor }));
      tasks.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
  }
  return buildSceneModel(inputsOf({ nowMs: FIXTURE_NOW_MS, roster, tasks }));
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

  it.each([['arena', 1], ['arena', 99999], ['arena-perf-1', 1], ['arena-perf-1', 99999]] as const)('%s with seeded hero points (seed %i): heroes are apart, tasks stand beside their hero or on the lattice, all inside the margins', async (scenario, seed) => {
    const model = await modelOf(scenario);
    const heroPoints = placeHeroes(new Map(), model.specters.map((specter) => specter.bindingId), seed);
    const fans = assignFans(new Map(), model, heroPoints);
    const placement = placeScene(model, assignSlots(new Map(), slotIdsOf(model, fans), undefined, blockedSlots(heroPoints.values(), fanTaskPoints(model, heroPoints, fans))), heroPoints, fans);
    expect(placement.specters.size).toBe(model.specters.length);
    expect(placement.enemies.size).toBe(model.enemies.length);
    for (const enemy of model.enemies.filter((candidate) => !fans.has(candidate.workId))) for (const hero of placement.specters.values()) {
      const at = placement.enemies.get(enemy.workId) as Point;
      // A task that found no lattice slot (arena-perf-1 has more tasks than free slots) stands at the centre, as before.
      if (at.x !== 0.5 || at.y !== 0.5) expect(clearOfHero(hero, at)).toBe(true);
    }
    // A task beside a hero never touches another task, whether that one is beside a hero or on the lattice.
    const beside = model.enemies.filter((enemy) => fans.has(enemy.workId)).map((enemy) => placement.enemies.get(enemy.workId) as Point);
    const lattice = model.enemies.filter((enemy) => !fans.has(enemy.workId)).map((enemy) => placement.enemies.get(enemy.workId) as Point).filter((p) => p.x !== 0.5 || p.y !== 0.5);
    for (let i = 0; i < beside.length; i += 1) {
      for (let j = i + 1; j < beside.length; j += 1) expect(tasksApart(beside[i]!, beside[j]!)).toBe(true);
      for (const other of lattice) expect(tasksApart(beside[i]!, other)).toBe(true);
    }
    const fanned = model.enemies.filter((enemy) => fans.has(enemy.workId));
    expect(fanned.length).toBeGreaterThan(0);
    for (const enemy of fanned) {
      const owner = ownerOf(enemy, heroPoints) as string;
      const a = placement.enemies.get(enemy.workId) as Point;
      const b = placement.specters.get(owner) as Point;
      expect(Math.hypot((a.x - b.x) * ARENA_INTRINSIC.width, (a.y - b.y) * ARENA_INTRINSIC.height)).toBeLessThan(275);
    }
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
  const work = [taskOf(1, bots[0]!), taskOf(2, bots[1]!), taskOf(3, bots[2]!, { attemptState: 'unknown' })];
  const model = buildSceneModel(inputsOf({ roster: bots, tasks: work }));
  const placement = placeScene(model, assignSlots(new Map(), slotIdsOf(model)));

  it('keeps a Specter on its own staging cell whether or not it is engaged', () => {
    expect([...placement.specters.values()]).toEqual([specterSlot(0), specterSlot(1), specterSlot(2)]);
  });

  it('gives every enemy a slot', () => {
    expect(slotIdsOf(model)).toEqual(model.enemies.map((enemy) => enemy.workId));
    expect(placement.enemies.size).toBe(3);
  });

  it('falls back to the centre for an enemy that has no slot or a slot out of range', () => {
    expect(placeScene(model, new Map()).enemies.get(work[2]!.taskId)).toEqual({ x: 0.5, y: 0.5 });
    expect(placeScene(model, new Map([[work[2]!.taskId, 9999]])).enemies.get(work[2]!.taskId)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('uses a given hero point and falls back to the staging cell for a Specter without one', () => {
    const point = { x: 0.5, y: 0.7 };
    const placed = placeScene(model, assignSlots(new Map(), slotIdsOf(model)), new Map([[model.specters[1]!.bindingId, point]]));
    expect(placed.specters.get(model.specters[1]!.bindingId)).toEqual(point);
    expect(placed.specters.get(model.specters[0]!.bindingId)).toEqual(specterSlot(0));
    expect(placed.specters.get(model.specters[2]!.bindingId)).toEqual(specterSlot(2));
  });

  it('apart means a whole cell in x or in y', () => {
    expect(apart({ x: 0, y: 0 }, { x: 0.135, y: 0 }, SPECTER_CELL)).toBe(true);
    expect(apart({ x: 0, y: 0 }, { x: 0.1, y: 0.1 }, SPECTER_CELL)).toBe(false);
    expect(apart({ x: 0, y: 0 }, { x: 0.01, y: 0.16 }, SPECTER_CELL)).toBe(true);
  });

  it('is deterministic', () => {
    expect(placeScene(model, assignSlots(new Map(), slotIdsOf(model)))).toEqual(placement);
  });
});

describe('tasks beside their hero', () => {
  const bots = [botOf(1, { state: 'working' }), botOf(2, { state: 'working' })];
  const work = [taskOf(1, bots[0]!), taskOf(2, bots[0]!), taskOf(3, bots[1]!), taskOf(4, bots[1]!, { attemptState: 'unknown' })];
  const model = buildSceneModel(inputsOf({ roster: bots, tasks: work }));
  const heroPoints = new Map<string, Point>([[model.specters[0]!.bindingId, { x: 0.3, y: 0.5 }]]);

  it('seats an owned task on the hero\'s fan and leaves a task with no drawn hero on the lattice', () => {
    const fans = assignFans(new Map(), model, heroPoints);
    const owned = model.enemies.filter((enemy) => ownerOf(enemy, heroPoints) !== null);
    expect(owned.length).toBeGreaterThan(0);
    expect([...fans.keys()].sort()).toEqual(owned.map((enemy) => enemy.workId).sort());
    expect(slotIdsOf(model, fans)).toEqual(model.enemies.filter((enemy) => !fans.has(enemy.workId)).map((enemy) => enemy.workId));
    const placed = placeScene(model, assignSlots(new Map(), slotIdsOf(model, fans)), heroPoints, fans);
    const lattice = enemySlots();
    for (const enemy of model.enemies) {
      const point = placed.enemies.get(enemy.workId) as Point;
      if (fans.has(enemy.workId)) expect(lattice.some((slot) => slot.x === point.x && slot.y === point.y)).toBe(false);
      else expect(lattice.some((slot) => slot.x === point.x && slot.y === point.y)).toBe(true);
    }
  });

  it('keeps seats across polls and gives a new task the lowest free seat', () => {
    const first = assignFans(new Map(), model, heroPoints);
    expect(assignFans(first, model, heroPoints)).toEqual(first);
    expect([...first.values()].sort()).toEqual([...new Set(first.values())].sort());
  });
});

describe('blockedSlots', () => {
  it('blocks the lattice slots a hero token would cover, and assignSlots never uses them', () => {
    expect(blockedSlots([]).size).toBe(0);
    const hero = enemySlots()[3] as Point;
    const blocked = blockedSlots([hero]);
    expect(blocked.has(3)).toBe(true);
    expect(blocked.size).toBeLessThan(SLOT_COUNT);
    const seats = assignSlots(new Map([['a', 3]]), ['a', 'b', 'c'], SLOT_COUNT, blocked);
    for (const seat of seats.values()) expect(blocked.has(seat)).toBe(false);
    expect(seats.size).toBe(3);
  });
});
