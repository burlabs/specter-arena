import type { RosterItemV1, SpecterV1, WorkAttemptV1, WorkItemV1, XpSummaryV1 } from '../contracts/types';
import { itemOf } from '../work/testData';
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

export const attemptOf = (bot: RosterItemV1, n: number, extra: Partial<WorkAttemptV1> = {}): WorkAttemptV1 => ({
  attemptId: `att_${String(n).padStart(24, '0')}`,
  bindingId: bot.bindingId,
  kind: 'bot-turn',
  startedMs: NOW - HOUR,
  endedMs: null,
  endSignal: null,
  ended: false,
  present: true,
  ...extra,
});

export const workOf = (n: number, extra: Partial<WorkItemV1> = {}): WorkItemV1 =>
  itemOf({ workId: `wrk_${String(n).padStart(24, '0')}`, title: `Task ${n}`, createdAtMs: NOW - n * 1_000, updatedAtMs: NOW - n * 1_000, ...extra });

export const specterOf = (bot: RosterItemV1, name: string, assetId: string | null = null): SpecterV1 => ({
  contractVersion: 1,
  specterId: `spc_${bot.bindingId.slice(4)}`,
  bindingId: bot.bindingId,
  version: 1,
  profile: {
    contractVersion: 1,
    name,
    epithet: null,
    personality: 'Quiet.',
    appearance: 'Pale.',
    mannerism: 'Nods.',
    signatureAction: null,
    assignmentRationale: 'Fits.',
    artBrief: 'A figure.',
  },
  portrait: assetId === null ? null : { contractVersion: 1, assetId, mediaType: 'image/png', width: 8, height: 8, byteLength: 10, origin: 'bundled', label: 'x', dataBase64: null },
  source: 'generated',
  promptVersion: null,
  createdAtMs: NOW,
  updatedAtMs: NOW,
});

export const xpOf = (bot: RosterItemV1, totalXp: number, level: number): XpSummaryV1 => ({
  contractVersion: 1,
  bindingId: bot.bindingId,
  totalXp,
  level,
  levelTableVersion: 'levels-1',
  levelFloorXp: 0,
  nextLevelXp: null,
  acceptedWorkCount: 1,
  policyVersion: 'xp-policy-1',
});

export const inputsOf = (extra: Partial<SceneInputs> = {}): SceneInputs => ({ mode: 'FIXTURE', nowMs: NOW, roster: [], specters: [], xp: [], work: [], ...extra });
