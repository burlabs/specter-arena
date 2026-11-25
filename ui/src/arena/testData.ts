import { HERO_IDS } from '../contracts/types';
import type { RosterItemV1, SpecterV2, TaskItemV1, XpSummaryV2 } from '../contracts/types';
import { sizeClassOf } from '../tasks/model';
import type { SceneInputs } from './sceneModel';

export const NOW = 1_794_916_800_000;
export const HOUR = 3_600_000;

export const botOf = (n: number, extra: Partial<RosterItemV1> & { state?: string; running?: number } = {}): RosterItemV1 => {
  const { state = 'settled', running = 0, ...rest } = extra;
  return {
    contractVersion: 1,
    bindingId: `bnd_${String(n).padStart(24, '0')}`,
    displayName: `Bot ${n}`,
    avatar: null,
    presence: 'present',
    condition: {
      state,
      reasonCode: state === 'working' ? 'running' : state === 'settled' ? 'not-running' : 'never-observed',
      basis: null,
      sourceTimeMs: null,
      observedAtMs: null,
      signals: { needsInput: false, hasOptions: false, pendingApproval: false, waitingForInput: false },
    },
    coverage: { state: 'covered', sinceMs: NOW, reasonCode: null, openGapCount: 0 },
    lastObservedAtMs: NOW,
    workers: { running, seen: running, unknown: 0 },
    ...rest,
  };
};

/** The id of the nth task, attempt or binding in a test: 24 hex digits, the way the backend writes them. */
export const taskIdOf = (n: number): string => `tsk_${n.toString(16).padStart(24, '0')}`;
export const attemptIdOf = (n: number): string => `att_${n.toString(16).padStart(24, '0')}`;

/** A task that is open and running for ten minutes unless `extra` says otherwise. `sizeClass` follows `runMs` unless given. */
export const taskOf = (n: number, bot: RosterItemV1, extra: Partial<TaskItemV1> = {}): TaskItemV1 => {
  const runMs = extra.runMs ?? 600_000;
  return {
    contractVersion: 1,
    taskId: taskIdOf(n),
    bindingId: bot.bindingId,
    attemptId: attemptIdOf(n),
    kind: 'worker',
    state: 'open',
    attemptState: 'working',
    closeReason: null,
    startedAtMs: NOW - runMs,
    endedAtMs: null,
    closedAtMs: null,
    updatedAtMs: NOW - n * 1_000,
    runMs,
    sizeClass: sizeClassOf(runMs),
    xpCredited: null,
    policyVersion: 'xp-policy-2',
    ...extra,
  };
};

/** A credited task: ended cleanly 30 minutes before NOW, XP 12. */
export const creditedOf = (n: number, bot: RosterItemV1, extra: Partial<TaskItemV1> = {}): TaskItemV1 => {
  const runMs = extra.runMs ?? 600_000;
  return taskOf(n, bot, { state: 'credited', attemptState: 'ended', closeReason: 'clean-end', runMs, endedAtMs: NOW - 30 * 60_000, startedAtMs: NOW - 30 * 60_000 - runMs, closedAtMs: NOW - 29 * 60_000, updatedAtMs: NOW - 29 * 60_000, xpCredited: 12, ...extra });
};

/** A task that closed without credit for `reason`. */
export const notCreditedOf = (n: number, bot: RosterItemV1, reason: 'unknown-terminal' | 'coverage-gap' | 'waiting-at-end' = 'coverage-gap', extra: Partial<TaskItemV1> = {}): TaskItemV1 => {
  const runMs = extra.runMs ?? 600_000;
  return taskOf(n, bot, { state: 'not-credited', attemptState: 'ended', closeReason: reason, runMs, endedAtMs: NOW - 30 * 60_000, startedAtMs: NOW - 30 * 60_000 - runMs, closedAtMs: NOW - 29 * 60_000, updatedAtMs: NOW - 29 * 60_000, ...extra });
};

const DEFAULT_PORTRAIT_ASSET = `ast_${'0'.repeat(24)}`;

/** A hero for a bot: assignment follows the bot number so each bot in a test has its own hero. */
export const specterOf = (bot: RosterItemV1, name: string, assetId: string | null = null): SpecterV2 => {
  const assignment = (Number.parseInt(bot.bindingId.slice(-4), 10) || 1) - 1;
  const heroId = HERO_IDS[assignment % HERO_IDS.length] ?? 'vell';
  return {
    contractVersion: 2,
    bindingId: bot.bindingId,
    version: assetId === null ? 0 : 1,
    heroId,
    ordinal: Math.floor(assignment / HERO_IDS.length) + 1,
    displayName: name,
    name: name.split(' ')[0] ?? name,
    epithet: 'Quiet.',
    personality: 'Quiet.',
    appearance: 'Pale.',
    portrait: { contractVersion: 1, assetId: assetId ?? DEFAULT_PORTRAIT_ASSET, mediaType: 'image/png', width: 8, height: 8, byteLength: 10, origin: 'bundled', label: 'x', dataBase64: null },
    avatarChosen: assetId !== null,
    source: 'roster',
    createdAtMs: NOW,
    updatedAtMs: NOW,
  };
};

export const xpOf = (bot: RosterItemV1, totalXp: number, level: number): XpSummaryV2 => ({
  contractVersion: 2,
  bindingId: bot.bindingId,
  totalXp,
  level,
  levelTableVersion: 'levels-1',
  levelFloorXp: 0,
  nextLevelXp: null,
  acceptedWorkCount: 1,
  creditedTaskCount: 1,
  policyVersion: 'xp-policy-2',
});

export const inputsOf = (extra: Partial<SceneInputs> = {}): SceneInputs => ({ mode: 'FIXTURE', nowMs: NOW, roster: [], specters: [], xp: [], tasks: [], ...extra });
