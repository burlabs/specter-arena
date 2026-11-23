import { describe, expect, it } from 'vitest';
import {
  CADENCE_MAX_MS,
  CADENCE_MIN_MS,
  MAX_CONCURRENT_EXCHANGES,
  TURN_GAP_MS,
  advance,
  delayOf,
  initialPlanner,
  nextSeed,
  pairsOf,
  plannerInputOf,
  requestCast,
  seedOf,
  signatureOf,
  snapshotOf,
} from './exchangePlanner';
import type { PlannerInput } from './exchangePlanner';
import { COUNTER_GAP_MS, FLINCH_MS, HERO_COMBAT, MINION_COUNTER } from './heroCombat';
import type { SceneEnemy, SceneModel, SceneSpecter } from './sceneModel';

const specter = (id: string, over: Partial<SceneSpecter> = {}): SceneSpecter => ({
  bindingId: id,
  displayName: id,
  specterName: id,
  heroId: 'vell',
  portraitAssetId: null,
  condition: 'working',
  openAttemptIds: [],
  engagedWorkIds: [],
  xpTotal: 0,
  level: 1,
  xpReading: 'ready',
  waitingReason: null,
  ...over,
});
const enemy = (id: string, over: Partial<SceneEnemy> = {}): SceneEnemy => ({
  workId: id,
  parentId: null,
  title: id,
  size: 'minion',
  state: 'open',
  sizeClass: 'medium',
  runMs: 300_000,
  progress: { kind: 'unknown' },
  parts: null,
  blocked: false,
  engagedBy: [],
  defeated: false,
  committedXp: null,
  ...over,
});
const model = (specters: SceneSpecter[], enemies: SceneEnemy[]): SceneModel => ({ mode: 'FIXTURE', asOfMs: 1, specters, enemies, overflow: { enemies: 0, truncated: false }, coverage: { gaps: 0, unknownBots: 0 } });
const one = (): PlannerInput => plannerInputOf(model([specter('a', { engagedWorkIds: ['w1'] })], [enemy('w1')]));

describe('seeds and cadence', () => {
  it('derives the same delay sequence for the same pair, always inside 2.5 to 4 s', () => {
    let seed = seedOf('a:w1');
    const first = Array.from({ length: 50 }, () => {
      seed = nextSeed(seed);
      return delayOf(seed);
    });
    seed = seedOf('a:w1');
    const again = Array.from({ length: 50 }, () => {
      seed = nextSeed(seed);
      return delayOf(seed);
    });
    expect(again).toEqual(first);
    expect(Math.min(...first)).toBeGreaterThanOrEqual(CADENCE_MIN_MS);
    expect(Math.max(...first)).toBeLessThanOrEqual(CADENCE_MAX_MS);
    expect(new Set(first).size).toBeGreaterThan(10);
    expect(seedOf('')).toBe(2_166_136_261);
    expect(seedOf('b:w1')).not.toBe(seedOf('a:w1'));
  });

  it('never returns a zero seed', () => {
    expect(seedOf('x')).toBeGreaterThan(0);
  });
});

describe('pairsOf', () => {
  it('pairs only working heroes with a timing row and a live engaged enemy', () => {
    const m = model(
      [
        specter('a', { engagedWorkIds: ['w1', 'gone', 'done'] }),
        specter('b', { condition: 'waiting', engagedWorkIds: ['w1'] }),
        specter('c', { condition: 'settled', engagedWorkIds: ['w1'] }),
        specter('d', { condition: 'unknown', engagedWorkIds: ['w1'] }),
        specter('e', { heroId: null, engagedWorkIds: ['w1'] }),
        specter('f', { heroId: 'newcomer' as SceneSpecter['heroId'], engagedWorkIds: ['w1'] }),
      ],
      [enemy('w1', { size: 'encounter' }), enemy('done', { defeated: true })],
    );
    expect(pairsOf(m)).toEqual([{ key: 'a:w1', bindingId: 'a', heroId: 'vell', workId: 'w1', minionType: 'patchbrute' }]);
  });
});

describe('advance', () => {
  it('schedules the first attack 2.5 to 4 s after the pair is first seen and starts nothing before then', () => {
    const input = one();
    const first = advance(initialPlanner(), input, 10_000);
    expect(first.state.active).toEqual([]);
    expect(first.nextWakeMs).not.toBeNull();
    expect(first.nextWakeMs! - 10_000).toBeGreaterThanOrEqual(CADENCE_MIN_MS);
    expect(first.nextWakeMs! - 10_000).toBeLessThanOrEqual(CADENCE_MAX_MS);
    const fired = advance(first.state, input, first.nextWakeMs!);
    expect(fired.state.active).toHaveLength(1);
    const exchange = fired.state.active[0]!;
    expect(exchange).toMatchObject({ kind: 'attack', bindingId: 'a', workId: 'w1', strong: false });
    const timing = HERO_COMBAT.vell;
    expect(exchange.impactMs - exchange.startMs).toBe(timing.attackImpact);
    expect(exchange.heroEndMs - exchange.startMs).toBe(timing.attack);
    expect(exchange.hitEndMs - exchange.impactMs).toBe(320);
    expect(exchange.counterStartMs - exchange.hitEndMs).toBe(COUNTER_GAP_MS);
    expect(exchange.counterImpactMs - exchange.counterStartMs).toBe(MINION_COUNTER.patchling.impact);
    expect(exchange.counterEndMs - exchange.counterStartMs).toBe(MINION_COUNTER.patchling.attack);
    expect(exchange.flinchEndMs - exchange.counterImpactMs).toBe(FLINCH_MS);
    expect(exchange.endMs).toBe(Math.max(exchange.counterEndMs, exchange.flinchEndMs));
  });

  it('walks through the hero impact and end, then waits 2.5 to 4 s after the hero ends', () => {
    const input = one();
    let result = advance(initialPlanner(), input, 0);
    result = advance(result.state, input, result.nextWakeMs!);
    const started = result.state.active[0]!;
    const seen: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      seen.push(result.nextWakeMs!);
      result = advance(result.state, input, result.nextWakeMs!);
    }
    const phases = [started.impactMs, started.heroEndMs, started.hitEndMs, started.counterStartMs, started.counterImpactMs, started.counterEndMs, started.flinchEndMs];
    expect(seen).toEqual([...new Set([...phases, started.endMs])].sort((a, b) => a - b).slice(0, 7));
    expect(result.state.active).toEqual([]);
    expect(result.nextWakeMs! - started.heroEndMs).toBeGreaterThanOrEqual(CADENCE_MIN_MS);
    expect(result.nextWakeMs! - started.heroEndMs).toBeLessThanOrEqual(CADENCE_MAX_MS);
  });

  it('is idle with nothing to attack', () => {
    const none = plannerInputOf(model([specter('a')], [enemy('w1')]));
    expect(advance(initialPlanner(), none, 5)).toEqual({ state: expect.objectContaining({ active: [] }), nextWakeMs: null });
  });

  it('makes heroes take turns on one enemy and keeps a gap', () => {
    const input = plannerInputOf(model([specter('a', { engagedWorkIds: ['w1'] }), specter('b', { engagedWorkIds: ['w1'] })], [enemy('w1')]));
    let result = advance(initialPlanner(), input, 0);
    const startedAt: number[] = [];
    const ends = new Map<number, number>();
    for (let i = 0; i < 40 && result.nextWakeMs !== null; i += 1) {
      const now = result.nextWakeMs;
      const before = result.state.active.length;
      result = advance(result.state, input, now);
      expect(result.state.active.length).toBeLessThanOrEqual(1);
      for (const exchange of result.state.active) if (!ends.has(exchange.id)) {
        ends.set(exchange.id, exchange.endMs);
        startedAt.push(exchange.startMs);
      }
      void before;
    }
    expect(ends.size).toBeGreaterThan(3);
    const sortedEnds = [...ends.values()].sort((a, b) => a - b);
    startedAt.sort((a, b) => a - b);
    for (let i = 1; i < startedAt.length; i += 1) expect(startedAt[i]! - sortedEnds[i - 1]!).toBeGreaterThanOrEqual(TURN_GAP_MS);
  });

  it('does not start a second attack for a hero that is still animating on another enemy', () => {
    const input = plannerInputOf(model([specter('a', { engagedWorkIds: ['w1', 'w2'] })], [enemy('w1'), enemy('w2')]));
    let result = advance(initialPlanner(), input, 0);
    for (let i = 0; i < 60 && result.nextWakeMs !== null; i += 1) {
      result = advance(result.state, input, result.nextWakeMs);
      const heroes = result.state.active.filter((exchange) => exchange.bindingId === 'a' && exchange.heroEndMs > result.nextWakeMs! - 1);
      expect(heroes.length).toBeLessThanOrEqual(2);
      const live = result.state.active.filter((exchange) => exchange.heroEndMs > 0);
      expect(new Set(live.map((exchange) => exchange.workId)).size).toBe(live.length);
    }
  });

  it('caps hero layers at 8 and pushes the rest to their next jittered slot', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `b${String(i).padStart(2, '0')}`);
    const input = plannerInputOf(model(ids.map((id) => specter(id, { engagedWorkIds: [`w-${id}`] })), ids.map((id) => enemy(`w-${id}`))));
    let result = advance(initialPlanner(), input, 0);
    let peak = 0;
    for (let i = 0; i < 400 && result.nextWakeMs !== null && result.nextWakeMs < 40_000; i += 1) {
      result = advance(result.state, input, result.nextWakeMs);
      peak = Math.max(peak, result.state.active.filter((exchange) => exchange.kind !== 'recoil').length);
    }
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT_EXCHANGES);
  });

  it('drops exchanges and slots when the enemy is defeated or the hero stops working', () => {
    const input = one();
    let result = advance(initialPlanner(), input, 0);
    result = advance(result.state, input, result.nextWakeMs!);
    expect(result.state.active).toHaveLength(1);
    const defeated = plannerInputOf(model([specter('a', { engagedWorkIds: ['w1'] })], [enemy('w1', { defeated: true })]));
    const after = advance(result.state, defeated, result.state.active[0]!.startMs + 10);
    expect(after.state.active).toEqual([]);
    expect(after.state.due.size).toBe(0);
    expect(after.nextWakeMs).toBeNull();
    const waiting = plannerInputOf(model([specter('a', { condition: 'waiting', engagedWorkIds: ['w1'] })], [enemy('w1')]));
    expect(advance(result.state, waiting, result.state.active[0]!.startMs + 10).state.active).toEqual([]);
  });

  it('re-seeds from now after a restart: a fresh planner never fires at once', () => {
    const input = one();
    const result = advance(initialPlanner(), input, 1_000_000);
    expect(result.state.active).toEqual([]);
    expect(result.nextWakeMs! - 1_000_000).toBeGreaterThanOrEqual(CADENCE_MIN_MS);
  });

  it('keeps an existing pair slot when a later poll still has the pair', () => {
    const input = one();
    const first = advance(initialPlanner(), input, 0);
    const later = advance(first.state, input, 100);
    expect(later.nextWakeMs).toBe(first.nextWakeMs);
  });
});

describe('requestCast', () => {
  it('plays one strong cast from the first working hero in sorted order and replaces an attack on that enemy', () => {
    const input = plannerInputOf(model([specter('b', { engagedWorkIds: ['w1'] }), specter('a', { engagedWorkIds: ['w1'], heroId: 'bur' })], [enemy('w1')]));
    const state = requestCast(initialPlanner(), input, 'w1', 500);
    expect(state.active).toHaveLength(1);
    expect(state.active[0]).toMatchObject({ kind: 'cast', bindingId: 'a', heroId: 'bur', strong: true, impactMs: 500 + HERO_COMBAT.bur.castImpact, heroEndMs: 500 + HERO_COMBAT.bur.cast });
    const again = requestCast(state, input, 'w1', 600);
    expect(again.active).toHaveLength(1);
    expect(again.active[0]!.id).not.toBe(state.active[0]!.id);
  });

  it('plays a recoil alone when nobody is engaged, the enemy is gone, or all layer slots are in use', () => {
    const alone = plannerInputOf(model([], [enemy('w1', { size: 'encounter' })]));
    const recoil = requestCast(initialPlanner(), alone, 'w1', 0);
    expect(recoil.active[0]).toMatchObject({ kind: 'recoil', bindingId: null, strong: true, minionType: 'patchling', impactMs: 280 });
    expect(requestCast(initialPlanner(), alone, 'missing', 0).active).toEqual([]);
    const ids = Array.from({ length: 9 }, (_, i) => `b${i}`);
    const crowd = plannerInputOf(model([...ids.map((id) => specter(id, { engagedWorkIds: [`w-${id}`] })), specter('z', { engagedWorkIds: ['target'] })], [...ids.map((id) => enemy(`w-${id}`)), enemy('target')]));
    let state = initialPlanner();
    for (const id of ids.slice(0, 8)) state = requestCast(state, crowd, `w-${id}`, 0);
    expect(state.active.filter((exchange) => exchange.kind === 'cast')).toHaveLength(8);
    state = requestCast(state, crowd, 'target', 0);
    expect(state.active.find((exchange) => exchange.workId === 'target')?.kind).toBe('recoil');
  });

  it('skips a hero that is busy on another enemy', () => {
    const input = plannerInputOf(model([specter('a', { engagedWorkIds: ['w1', 'w2'] })], [enemy('w1'), enemy('w2')]));
    let state = requestCast(initialPlanner(), input, 'w1', 0);
    state = requestCast(state, input, 'w2', 10);
    expect(state.active.find((exchange) => exchange.workId === 'w2')?.kind).toBe('recoil');
  });
});

describe('snapshotOf', () => {
  it('shows the hero until its end, the enemy from impact to end, and signs the result', () => {
    const input = one();
    const state = requestCast(initialPlanner(), input, 'w1', 0);
    const x = state.active[0]!;
    const early = snapshotOf(state, 10);
    expect(early.heroes.get('a')).toMatchObject({ kind: 'cast', workId: 'w1' });
    expect(early.enemies.size).toBe(0);
    expect(early.layers).toBe(1);
    const mid = snapshotOf(state, x.impactMs);
    expect(mid.enemies.get('w1')).toMatchObject({ strong: true, bindingId: 'a' });
    const late = snapshotOf(state, x.heroEndMs);
    expect(late.heroes.size).toBe(0);
    expect(late.layers).toBe(0);
    expect(snapshotOf(state, x.endMs).enemies.size).toBe(0);
    expect(signatureOf(early)).not.toBe(signatureOf(mid));
    expect(signatureOf({ heroes: new Map(), enemies: new Map(), counters: new Map(), flinches: new Map(), layers: 0 })).toBe('|||');
  });
});

describe('two-way exchange', () => {
  const input = plannerInputOf(model([specter('a', { engagedWorkIds: ['w1'] })], [enemy('w1')]));
  const started = () => {
    const first = advance(initialPlanner(), input, 0);
    return advance(first.state, input, first.nextWakeMs!).state;
  };

  it('plays hero strike, minion hit, minion strike, hero flinch, in that order', () => {
    const state = started();
    const x = state.active[0]!;
    const order = (at: number) => {
      const view = snapshotOf(state, at);
      return { hero: view.heroes.has('a'), hit: view.enemies.has('w1'), counter: view.counters.has('w1'), flinch: view.flinches.has('a') };
    };
    expect(order(x.startMs)).toEqual({ hero: true, hit: false, counter: false, flinch: false });
    expect(order(x.impactMs)).toMatchObject({ hit: true, counter: false, flinch: false });
    expect(order(x.hitEndMs)).toEqual({ hero: false, hit: false, counter: false, flinch: false });
    expect(order(x.counterStartMs)).toEqual({ hero: false, hit: false, counter: true, flinch: false });
    expect(order(x.counterImpactMs)).toEqual({ hero: false, hit: false, counter: true, flinch: true });
    expect(order(x.counterEndMs)).toMatchObject({ counter: false });
    expect(order(x.flinchEndMs)).toEqual({ hero: false, hit: false, counter: false, flinch: false });
    expect(x.hitEndMs).toBeLessThan(x.counterStartMs);
    expect(x.counterImpactMs).toBeLessThan(x.flinchEndMs);
  });

  it('keeps the hero from starting another exchange until its flinch ends', () => {
    const state = started();
    const x = state.active[0]!;
    const result = advance({ ...state, due: new Map([['a:w1', { atMs: x.counterImpactMs, seed: 1 }]]) }, input, x.counterImpactMs);
    expect(result.state.active).toHaveLength(1);
    expect(result.state.due.get('a:w1')!.atMs).toBeGreaterThanOrEqual(x.flinchEndMs);
  });

  it('gives a recoil with no hero no counter and no flinch', () => {
    const lone = plannerInputOf(model([], [enemy('w1')]));
    const state = requestCast(initialPlanner(), lone, 'w1', 0);
    const x = state.active[0]!;
    expect(x.kind).toBe('recoil');
    expect(x.counterStartMs).toBe(x.hitEndMs);
    expect(x.endMs).toBe(x.hitEndMs);
    for (let at = 0; at <= x.endMs; at += 20) {
      const view = snapshotOf(state, at);
      expect(view.counters.size + view.flinches.size).toBe(0);
    }
  });

  it('counts the whole exchange against the cap of 8', () => {
    const many = plannerInputOf(model(Array.from({ length: 12 }, (_, i) => specter(`h${i}`, { engagedWorkIds: [`w${i}`] })), Array.from({ length: 12 }, (_, i) => enemy(`w${i}`))));
    let result = advance(initialPlanner(), many, 0);
    let peak = 0;
    for (let i = 0; i < 400 && result.nextWakeMs !== null; i += 1) {
      result = advance(result.state, many, result.nextWakeMs);
      const view = snapshotOf(result.state, result.nextWakeMs ?? 0);
      peak = Math.max(peak, result.state.active.length, view.layers);
    }
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT_EXCHANGES);
  });
});
