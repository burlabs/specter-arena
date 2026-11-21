import { MINION_DURATIONS_MS } from './AnimatedMinion';
import type { MinionType } from './AnimatedMinion';
import { RECOIL_ONLY_IMPACT_MS, combatTimingOf } from './heroCombat';
import type { SceneModel } from './sceneModel';

/** Field-wide cap on exchanges that draw a hero effect layer. A milestone recoil with no layer does not count. */
export const MAX_CONCURRENT_EXCHANGES = 8;
export const CADENCE_MIN_MS = 2_500;
export const CADENCE_MAX_MS = 4_000;
/** A second hero waits this long after the first one's exchange on the same enemy has ended. */
export const TURN_GAP_MS = 300;

/**
 * A hero attack, a hero cast (a milestone was seen) or a recoil with nobody to cast it. All three are decorative:
 * they read facts the scene model already holds and write nothing anywhere.
 */
export type ExchangeKind = 'attack' | 'cast' | 'recoil';

/** One (hero, enemy) pairing that may attack: the hero is working and the enemy is on the field with an open attempt. */
export interface Pair {
  key: string;
  bindingId: string;
  heroId: string;
  workId: string;
  minionType: MinionType;
}

export interface Exchange {
  id: number;
  kind: ExchangeKind;
  /** Null for a recoil with no hero. */
  bindingId: string | null;
  heroId: string | null;
  workId: string;
  minionType: MinionType;
  /** All times are on the planner clock (`Date.now()` in the hook). */
  startMs: number;
  impactMs: number;
  heroEndMs: number;
  endMs: number;
  strong: boolean;
}

interface Due {
  atMs: number;
  seed: number;
}

export interface PlannerState {
  nextId: number;
  due: ReadonlyMap<string, Due>;
  active: readonly Exchange[];
  /** Enemy id to the time its last exchange ended plus the turn gap. */
  enemyFreeAtMs: ReadonlyMap<string, number>;
}

export interface PlannerInput {
  pairs: readonly Pair[];
  /** Enemies on the field that are not defeated. */
  liveWorkIds: ReadonlySet<string>;
}

export const initialPlanner = (): PlannerState => ({ nextId: 1, due: new Map(), active: [], enemyFreeAtMs: new Map() });

/** FNV-1a, 32 bit. Same seed function the export uses, so one pair always gets the same jitter sequence. */
export function seedOf(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0 || 1;
}

/** One step of the export's linear congruential generator. */
export function nextSeed(seed: number): number {
  return (Math.imul(seed >>> 0, 1_664_525) + 1_013_904_223) >>> 0;
}

/** Cadence delay for a seed, 2,500 to 4,000 ms inclusive. */
export const delayOf = (seed: number): number => CADENCE_MIN_MS + Math.floor((seed / 4_294_967_296) * (CADENCE_MAX_MS - CADENCE_MIN_MS + 1));

const minionTypeOf = (size: 'minion' | 'encounter'): MinionType => (size === 'encounter' ? 'patchbrute' : 'patchling');

/** Working heroes with a known timing row and an engaged, live enemy. `waiting`, `settled` and `unknown` heroes never attack. */
export function pairsOf(model: SceneModel): Pair[] {
  const live = new Map(model.enemies.filter((enemy) => !enemy.defeated).map((enemy) => [enemy.workId, enemy]));
  const pairs: Pair[] = [];
  for (const specter of model.specters) {
    if (specter.condition !== 'working' || specter.heroId === null || combatTimingOf(specter.heroId) === null) continue;
    for (const workId of specter.engagedWorkIds) {
      const enemy = live.get(workId);
      if (enemy !== undefined) pairs.push({ key: `${specter.bindingId}:${workId}`, bindingId: specter.bindingId, heroId: specter.heroId, workId, minionType: minionTypeOf(enemy.size) });
    }
  }
  return pairs;
}

export const plannerInputOf = (model: SceneModel): PlannerInput => ({
  pairs: pairsOf(model),
  liveWorkIds: new Set(model.enemies.filter((enemy) => !enemy.defeated).map((enemy) => enemy.workId)),
});

const layerCount = (active: readonly Exchange[]): number => active.filter((exchange) => exchange.kind !== 'recoil').length;

function build(id: number, kind: ExchangeKind, pair: Pair | null, workId: string, minionType: MinionType, nowMs: number, strong: boolean): Exchange {
  const timing = pair === null ? null : combatTimingOf(pair.heroId);
  const length = timing === null ? 0 : kind === 'cast' ? timing.cast : timing.attack;
  const impact = timing === null ? RECOIL_ONLY_IMPACT_MS : kind === 'cast' ? timing.castImpact : timing.attackImpact;
  return {
    id,
    kind: timing === null ? 'recoil' : kind,
    bindingId: timing === null ? null : (pair?.bindingId ?? null),
    heroId: timing === null ? null : (pair?.heroId ?? null),
    workId,
    minionType,
    startMs: nowMs,
    impactMs: nowMs + impact,
    heroEndMs: nowMs + length,
    endMs: nowMs + impact + MINION_DURATIONS_MS[minionType].hit,
    strong,
  };
}

/** Drops what no longer holds: pairs that vanished, finished exchanges, and exchanges whose hero or enemy left the field. */
function reconcile(state: PlannerState, input: PlannerInput, nowMs: number): PlannerState {
  const keys = new Set(input.pairs.map((pair) => pair.key));
  const heroes = new Set(input.pairs.map((pair) => pair.bindingId));
  const kept = state.active.filter(
    (exchange) => exchange.endMs > nowMs && input.liveWorkIds.has(exchange.workId) && (exchange.bindingId === null || heroes.has(exchange.bindingId)) && (exchange.kind === 'recoil' || keys.has(`${exchange.bindingId}:${exchange.workId}`)),
  );
  const free = new Map(state.enemyFreeAtMs);
  for (const exchange of state.active) if (!kept.includes(exchange)) free.set(exchange.workId, Math.max(free.get(exchange.workId) ?? 0, Math.min(exchange.endMs, nowMs) + TURN_GAP_MS));
  const due = new Map<string, Due>();
  for (const pair of input.pairs) {
    const existing = state.due.get(pair.key);
    if (existing !== undefined) due.set(pair.key, existing);
    else {
      // A new pair gets its first slot from "now": no catch-up burst after a resume.
      const seed = nextSeed(seedOf(pair.key));
      due.set(pair.key, { atMs: nowMs + delayOf(seed), seed });
    }
  }
  return { nextId: state.nextId, due, active: kept, enemyFreeAtMs: free };
}

export interface Advance {
  state: PlannerState;
  /** When to wake next, or null when nothing is scheduled. */
  nextWakeMs: number | null;
}

/** Starts every exchange that is due, applying turn-taking and the cap, then reports the next time something changes. */
export function advance(previous: PlannerState, input: PlannerInput, nowMs: number): Advance {
  let state = reconcile(previous, input, nowMs);
  const due = new Map(state.due);
  const free = new Map(state.enemyFreeAtMs);
  let active = [...state.active];
  let nextId = state.nextId;
  const pairByKey = new Map(input.pairs.map((pair) => [pair.key, pair]));
  const ready = [...due.entries()].filter(([, slot]) => slot.atMs <= nowMs).sort((a, b) => a[1].atMs - b[1].atMs || (a[0] < b[0] ? -1 : 1));
  for (const [key, slot] of ready) {
    const pair = pairByKey.get(key);
    if (pair === undefined) continue;
    const enemyBusyUntil = Math.max(free.get(pair.workId) ?? 0, ...active.filter((exchange) => exchange.workId === pair.workId).map((exchange) => exchange.endMs + TURN_GAP_MS));
    const heroBusyUntil = Math.max(0, ...active.filter((exchange) => exchange.bindingId === pair.bindingId).map((exchange) => exchange.heroEndMs));
    if (enemyBusyUntil > nowMs || heroBusyUntil > nowMs) {
      due.set(key, { atMs: Math.max(enemyBusyUntil, heroBusyUntil, nowMs + 1), seed: slot.seed });
      continue;
    }
    if (layerCount(active) >= MAX_CONCURRENT_EXCHANGES) {
      const seed = nextSeed(slot.seed);
      due.set(key, { atMs: nowMs + delayOf(seed), seed });
      continue;
    }
    const exchange = build(nextId, 'attack', pair, pair.workId, pair.minionType, nowMs, false);
    nextId += 1;
    active = [...active, exchange];
    const seed = nextSeed(slot.seed);
    due.set(key, { atMs: exchange.heroEndMs + delayOf(seed), seed });
  }
  state = { nextId, due, active, enemyFreeAtMs: free };
  return { state, nextWakeMs: nextWake(state, nowMs) };
}

function nextWake(state: PlannerState, nowMs: number): number | null {
  const times: number[] = [];
  for (const slot of state.due.values()) times.push(slot.atMs);
  for (const exchange of state.active) times.push(exchange.heroEndMs, exchange.impactMs, exchange.endMs);
  const upcoming = times.filter((time) => time > nowMs);
  return upcoming.length === 0 ? null : Math.min(...upcoming);
}

/**
 * A milestone count rose for `workId` between two visible polls: one strong recoil, cast by the first working hero in
 * sorted order that is engaged on it. With no hero, or with every layer slot in use, the recoil plays alone.
 */
export function requestCast(previous: PlannerState, input: PlannerInput, workId: string, nowMs: number): PlannerState {
  const state = reconcile(previous, input, nowMs);
  if (!input.liveWorkIds.has(workId)) return state;
  const candidates = input.pairs.filter((pair) => pair.workId === workId).sort((a, b) => (a.bindingId < b.bindingId ? -1 : a.bindingId > b.bindingId ? 1 : 0));
  const withoutThisEnemy = state.active.filter((exchange) => exchange.workId !== workId);
  const hero = candidates.find((pair) => !withoutThisEnemy.some((exchange) => exchange.bindingId === pair.bindingId && exchange.heroEndMs > nowMs));
  const kind: ExchangeKind = hero !== undefined && layerCount(withoutThisEnemy) < MAX_CONCURRENT_EXCHANGES ? 'cast' : 'recoil';
  const minionType = candidates[0]?.minionType ?? 'patchling';
  const exchange = build(state.nextId, kind, kind === 'cast' ? (hero ?? null) : null, workId, minionType, nowMs, true);
  const due = new Map(state.due);
  if (kind === 'cast' && hero !== undefined) due.set(hero.key, { atMs: exchange.heroEndMs + delayOf(nextSeed(state.due.get(hero.key)?.seed ?? seedOf(hero.key))), seed: nextSeed(state.due.get(hero.key)?.seed ?? seedOf(hero.key)) });
  return { nextId: state.nextId + 1, due, active: [...withoutThisEnemy, exchange], enemyFreeAtMs: state.enemyFreeAtMs };
}

/** What the scene draws at one instant. A hero animates until `heroEndMs`; an enemy recoils from `impactMs` to `endMs`. */
export interface HeroView {
  exchangeId: number;
  kind: 'attack' | 'cast';
  workId: string;
}
export interface EnemyView {
  exchangeId: number;
  strong: boolean;
  /** The hero the recoil is away from, or null for a recoil with no hero. */
  bindingId: string | null;
}
export interface ExchangeSnapshot {
  heroes: ReadonlyMap<string, HeroView>;
  enemies: ReadonlyMap<string, EnemyView>;
  /** Exchanges drawing a hero layer right now. */
  layers: number;
}

export const EMPTY_SNAPSHOT: ExchangeSnapshot = { heroes: new Map(), enemies: new Map(), layers: 0 };

export function snapshotOf(state: PlannerState, nowMs: number): ExchangeSnapshot {
  const heroes = new Map<string, HeroView>();
  const enemies = new Map<string, EnemyView>();
  let layers = 0;
  for (const exchange of state.active) {
    if (exchange.kind !== 'recoil' && exchange.bindingId !== null && nowMs >= exchange.startMs && nowMs < exchange.heroEndMs) {
      heroes.set(exchange.bindingId, { exchangeId: exchange.id, kind: exchange.kind, workId: exchange.workId });
      layers += 1;
    }
    if (nowMs >= exchange.impactMs && nowMs < exchange.endMs) enemies.set(exchange.workId, { exchangeId: exchange.id, strong: exchange.strong, bindingId: exchange.bindingId });
  }
  return { heroes, enemies, layers };
}

/** A stable text form, so the hook can skip a render when nothing the scene draws has changed. */
export const signatureOf = (snapshot: ExchangeSnapshot): string =>
  [...snapshot.heroes].map(([id, view]) => `h${id}=${view.exchangeId}`).join(',') + '|' + [...snapshot.enemies].map(([id, view]) => `e${id}=${view.exchangeId}`).join(',');
