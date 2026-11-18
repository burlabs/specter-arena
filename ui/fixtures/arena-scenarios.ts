// SPECTER-FIXTURE-ONLY: arena scenario names and the deterministic arena-perf-1 plan; never imported by ui/src.
import type { BotSpec } from './monitoring-bodies.ts';

export const ARENA_SCENARIO_NAMES = ['arena', 'arena-no-art', 'arena-perf-1', 'arena-stale', 'arena-empty'] as const;
export type ArenaScenarioName = (typeof ARENA_SCENARIO_NAMES)[number];

export const isArenaScenario = (name: string | null): name is ArenaScenarioName => ARENA_SCENARIO_NAMES.some((known) => known === name);

/** The module-internal scenario each fixture module answers for one arena scenario name. */
export interface ArenaAliases<T extends string> {
  arena: T;
  perf: T;
  stale: T;
  empty: T;
}

/** Maps a `?scenario=` value to the module's own name; any non-arena value is returned unchanged. */
export function canonicalArenaScenario<T extends string>(requested: string | null, aliases: ArenaAliases<T>): string | null {
  if (requested === 'arena' || requested === 'arena-no-art') return aliases.arena;
  if (requested === 'arena-perf-1') return aliases.perf;
  if (requested === 'arena-stale') return aliases.stale;
  if (requested === 'arena-empty') return aliases.empty;
  return requested;
}

/** SC10-8 profile. 10 + 10 x 4 + 50 = 100 on-field items; 12 more are accepted inside the last 24 h. */
export const ARENA_PERF_1 = {
  bots: 20,
  workingBots: 12,
  settledBots: 6,
  unknownBots: 2,
  containers: 10,
  childrenPerContainer: 4,
  standaloneLeaves: 50,
  recentlyAccepted: 12,
  workingAttempts: 30,
  specters: 14,
} as const;

const BOT_NAMES: readonly string[] = [
  'Atlas', 'Brindle', 'Cinder', 'Dune', 'Ember', 'Fenn', 'Garnet', 'Hollis', 'Ivory', 'Juniper',
  'Kestrel', 'Linden', 'Maple', 'Nettle', 'Orrin', 'Pike', 'Quill', 'Rowan', 'Sable', 'Thorn',
];

export const PERF_SPECTER_NAMES: readonly string[] = [
  'Vesper', 'Wren', 'Thistle', 'Lanternwick', 'Mossgrave', 'Pennywhistle', 'Ashbourne',
  'Cobalt', 'Dapple', 'Eventide', 'Fathom', 'Gossamer', 'Halcyon', 'Ibis',
];

/** Bots 1..6 run three attempts, bots 7..12 run two: 18 + 12 = 30. */
export const workingAttemptCount = (bot: number): number => (bot >= 1 && bot <= 6 ? 3 : bot >= 7 && bot <= 12 ? 2 : 0);

const MINUTE_MS = 60_000;

export function perfBots(): BotSpec[] {
  return BOT_NAMES.map((name, index) => {
    const n = index + 1;
    if (n <= ARENA_PERF_1.workingBots) {
      const count = workingAttemptCount(n);
      return {
        n,
        name,
        state: 'working',
        reason: 'running',
        attempts: Array.from({ length: count }, (_, attempt) => ({
          kind: attempt === 0 ? ('bot-turn' as const) : ('worker' as const),
          state: 'working' as const,
          reason: 'running',
          startedAgoMs: (attempt + 1) * 5 * MINUTE_MS,
        })),
        coveredMs: 6_800_000,
      };
    }
    if (n <= ARENA_PERF_1.workingBots + ARENA_PERF_1.settledBots) return { n, name, state: 'settled', reason: 'not-running', coveredMs: 6_800_000 };
    return { n, name, state: 'unknown', reason: 'never-observed' };
  });
}

export type PerfState = 'open' | 'awaiting-review' | 'blocked' | 'reopened' | 'accepted';

export interface PerfItem {
  n: number;
  parent: number | null;
  title: string;
  state: PerfState;
  ageMinutes: number;
  /** The real working attempt this item links as `[bot, index]`; null when it links an ended synthetic attempt. */
  workingAttempt: readonly [number, number] | null;
  bot: number;
  milestones: boolean;
}

const LEAF_PATTERN: readonly PerfState[] = [
  'open', 'open', 'open', 'open', 'open', 'open', 'open', 'open', 'open',
  'awaiting-review', 'awaiting-review', 'awaiting-review',
  'blocked', 'blocked',
  'reopened',
];

const pad = (n: number, width = 3): string => String(n).padStart(width, '0');

/**
 * n 1..10 containers (open), 11..50 children (container = 1 + floor((n - 11) / 4)), 51..100 standalone leaves,
 * 101..112 accepted. Leaf state by index i over children then standalone: i % 15 picks open (54), awaiting-review
 * (18), blocked (12) or reopened (6). The first 30 open leaves link one real working attempt each.
 */
export function perfItems(): PerfItem[] {
  const workingAttempts: Array<readonly [number, number]> = [];
  for (let bot = 1; bot <= ARENA_PERF_1.workingBots; bot += 1) {
    for (let index = 0; index < workingAttemptCount(bot); index += 1) workingAttempts.push([bot, index]);
  }
  const items: PerfItem[] = [];
  for (let n = 1; n <= ARENA_PERF_1.containers; n += 1) {
    items.push({ n, parent: null, title: `Perf encounter ${pad(n, 2)}`, state: 'open', ageMinutes: 200 + n, workingAttempt: null, bot: n, milestones: false });
  }
  let assigned = 0;
  for (let i = 0; i < 90; i += 1) {
    const n = 11 + i;
    const state = LEAF_PATTERN[i % 15] ?? 'open';
    const real = state === 'open' ? (workingAttempts[assigned] ?? null) : null;
    if (real !== null) assigned += 1;
    items.push({
      n,
      parent: n <= 50 ? 1 + Math.floor((n - 11) / 4) : null,
      title: `Perf task ${pad(n)}`,
      state,
      ageMinutes: 100 + (90 - i),
      workingAttempt: real,
      bot: 1 + (n % ARENA_PERF_1.bots),
      milestones: i % 9 === 0,
    });
  }
  for (let k = 0; k < ARENA_PERF_1.recentlyAccepted; k += 1) {
    const n = 101 + k;
    items.push({ n, parent: null, title: `Perf done ${pad(n)}`, state: 'accepted', ageMinutes: 20 + k * 3, workingAttempt: null, bot: 1 + (k % ARENA_PERF_1.bots), milestones: false });
  }
  return items;
}
