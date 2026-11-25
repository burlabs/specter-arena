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

/** FP-22 profile: 100 open tasks (30 on real working attempts, 70 no longer observed) and 12 credited inside the last 24 h. */
export const ARENA_PERF_1 = {
  bots: 20,
  workingBots: 12,
  settledBots: 6,
  unknownBots: 2,
  openTasks: 100,
  recentlyCredited: 12,
  workingAttempts: 30,
  specters: 20,
} as const;

const BOT_NAMES: readonly string[] = [
  'Atlas', 'Brindle', 'Cinder', 'Dune', 'Ember', 'Fenn', 'Garnet', 'Hollis', 'Ivory', 'Juniper',
  'Kestrel', 'Linden', 'Maple', 'Nettle', 'Orrin', 'Pike', 'Quill', 'Rowan', 'Sable', 'Thorn',
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

export interface PerfTask {
  n: number;
  bot: number;
  /** Credited tasks only: minutes since the task ended. */
  ageMinutes: number;
  /** Minutes the task has run (open) or ran (credited). Spread over all three size classes. */
  runMinutes: number;
  credited: boolean;
  /** The real working attempt this task is built from as `[bot, index]`; null for a synthetic one. */
  workingAttempt: readonly [number, number] | null;
}

const RUN_MINUTES: readonly number[] = [1, 4, 20];

/**
 * n 1..100 open tasks, 101..112 credited. The first 30 open tasks sit on the 30 real working attempts of the perf roster;
 * the other 70 are synthetic attempts that are no longer observed, held by the eight bots that are not working (13 to 20). Run time cycles small, medium, large by n.
 */
export function perfTasks(): PerfTask[] {
  const workingAttempts: Array<readonly [number, number]> = [];
  for (let bot = 1; bot <= ARENA_PERF_1.workingBots; bot += 1) {
    for (let index = 0; index < workingAttemptCount(bot); index += 1) workingAttempts.push([bot, index]);
  }
  const tasks: PerfTask[] = [];
  for (let n = 1; n <= ARENA_PERF_1.openTasks; n += 1) {
    const real = workingAttempts[n - 1] ?? null;
    tasks.push({ n, bot: real === null ? 13 + (n % 8) : real[0], ageMinutes: 0, runMinutes: RUN_MINUTES[n % 3] ?? 4, credited: false, workingAttempt: real });
  }
  for (let k = 0; k < ARENA_PERF_1.recentlyCredited; k += 1) {
    const n = ARENA_PERF_1.openTasks + 1 + k;
    tasks.push({ n, bot: 1 + (k % ARENA_PERF_1.bots), ageMinutes: 20 + k * 3, runMinutes: RUN_MINUTES[n % 3] ?? 4, credited: true, workingAttempt: null });
  }
  return tasks;
}
