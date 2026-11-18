import type { RosterItemV1, SpecterV1, WorkItemV1, XpSummaryV1 } from '../contracts/types';
import type { SourceMode } from '../host';
import { nameOf } from '../observatory/model';

export const ON_FIELD_STATES: ReadonlySet<string> = new Set(['open', 'awaiting-review', 'blocked', 'reopened']);
export const ENEMY_CAP = 80;
export const DEFEATED_MAX = 12;
export const DEFEATED_WINDOW_MS = 24 * 3_600_000;

export interface SceneInputs {
  mode: SourceMode;
  nowMs: number;
  roster: readonly RosterItemV1[];
  specters: readonly SpecterV1[];
  xp: readonly XpSummaryV1[];
  work: readonly WorkItemV1[];
  /** A work stream still had a cursor after the page cap, so counts are a minimum. */
  workTruncated?: boolean;
}

export type Progress = { kind: 'milestones'; done: number; total: number } | { kind: 'unknown' };

export interface SceneSpecter {
  bindingId: string;
  displayName: string;
  specterName: string | null;
  portraitAssetId: string | null;
  condition: 'working' | 'settled' | 'unknown';
  openAttemptIds: string[];
  engagedWorkIds: string[];
  xpTotal: number;
  level: number;
}

export interface SceneEnemy {
  workId: string;
  parentId: string | null;
  title: string;
  size: 'minion' | 'encounter';
  state: WorkItemV1['state'];
  progress: Progress;
  /** Encounters only: how many parts are accepted, a count and never a health value. */
  parts: { accepted: number; total: number } | null;
  blocked: boolean;
  engagedBy: string[];
  defeated: boolean;
  committedXp: number | null;
}

export interface SceneModel {
  mode: SourceMode;
  asOfMs: number;
  specters: SceneSpecter[];
  enemies: SceneEnemy[];
  overflow: { enemies: number; truncated: boolean };
  coverage: { gaps: number; unknownBots: number };
}

const conditionOf = (item: RosterItemV1): SceneSpecter['condition'] =>
  item.condition.state === 'working' ? 'working' : item.condition.state === 'settled' ? 'settled' : 'unknown';

/** A bot-turn attempt is engaging only while the bot reports a running turn; a worker attempt only while a worker runs. */
const running = (bot: RosterItemV1, kind: string): boolean =>
  kind === 'bot-turn' ? bot.condition.state === 'working' : kind === 'worker' ? bot.workers.running > 0 : false;

const PRIORITY: Readonly<Record<string, number>> = { blocked: 0, 'awaiting-review': 1, reopened: 2, open: 3 };
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byId = <T extends { workId: string }>(a: T, b: T): number => compareText(a.workId, b.workId);
const byPriority = (a: WorkItemV1, b: WorkItemV1): number =>
  (PRIORITY[a.state] ?? 9) - (PRIORITY[b.state] ?? 9) || b.createdAtMs - a.createdAtMs || byId(a, b);

function progressOf(item: WorkItemV1): Progress {
  return item.progress === null || item.progress.total <= 0 ? { kind: 'unknown' } : { kind: 'milestones', done: item.progress.done, total: item.progress.total };
}

/** Net of corrections already written by the ledger. Containers and unrewarded items carry no XP. */
const committedXpOf = (item: WorkItemV1): number | null =>
  !item.rewardable || item.childCount > 0 ? null : item.contributors.reduce((sum, contributor) => sum + contributor.xpNet, 0);

function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, new Set([value]));
  else existing.add(value);
}

const sorted = (set: Set<string> | undefined): string[] => (set === undefined ? [] : [...set].sort());

/**
 * The single input of the scene, rail, minimap and list view. Pure: no clock, no randomness, no I/O.
 * `enemyCap` bounds how many enemies the scene draws; the list view passes Infinity so it lists them all.
 */
export function buildSceneModel(inputs: SceneInputs, enemyCap: number = ENEMY_CAP): SceneModel {
  const rosterById = new Map(inputs.roster.map((bot) => [bot.bindingId, bot]));
  const specterByBot = new Map(inputs.specters.map((specter) => [specter.bindingId, specter]));
  const xpByBot = new Map(inputs.xp.map((summary) => [summary.bindingId, summary]));

  const onField = inputs.work.filter((item) => ON_FIELD_STATES.has(item.state));
  const defeated = inputs.work
    .filter((item) => item.state === 'accepted' && item.updatedAtMs >= inputs.nowMs - DEFEATED_WINDOW_MS)
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs || byId(a, b))
    .slice(0, DEFEATED_MAX);
  const room = Math.max(0, enemyCap - defeated.length);
  const keptField = [...onField].sort(byPriority).slice(0, room);
  const kept = [...defeated, ...keptField].sort(byId);

  const engagedByWork = new Map<string, Set<string>>();
  const openByBot = new Map<string, Set<string>>();
  const engagedByBot = new Map<string, Set<string>>();
  const keptIds = new Set(kept.map((item) => item.workId));
  for (const item of onField) {
    for (const attempt of item.attempts) {
      if (!attempt.present || attempt.ended) continue;
      const bot = rosterById.get(attempt.bindingId);
      if (bot === undefined) continue;
      addTo(openByBot, bot.bindingId, attempt.attemptId);
      if (!keptIds.has(item.workId) || !running(bot, attempt.kind)) continue;
      addTo(engagedByWork, item.workId, bot.bindingId);
      addTo(engagedByBot, bot.bindingId, item.workId);
    }
  }

  const specters: SceneSpecter[] = [...inputs.roster]
    .sort((a, b) => compareText(a.bindingId, b.bindingId))
    .map((bot) => {
      const specter = specterByBot.get(bot.bindingId);
      const summary = xpByBot.get(bot.bindingId);
      return {
        bindingId: bot.bindingId,
        displayName: nameOf(bot),
        specterName: specter?.profile.name ?? null,
        portraitAssetId: specter?.portrait?.assetId ?? null,
        condition: conditionOf(bot),
        openAttemptIds: sorted(openByBot.get(bot.bindingId)),
        engagedWorkIds: sorted(engagedByBot.get(bot.bindingId)),
        xpTotal: summary?.totalXp ?? 0,
        level: summary?.level ?? 1,
      };
    });

  const enemies: SceneEnemy[] = kept.map((item) => ({
    workId: item.workId,
    parentId: item.parentId,
    title: item.title,
    size: item.childCount > 0 ? 'encounter' : 'minion',
    state: item.state,
    progress: progressOf(item),
    parts: item.childCount > 0 ? { accepted: item.childrenAccepted, total: item.childCount } : null,
    blocked: item.state === 'blocked',
    engagedBy: sorted(engagedByWork.get(item.workId)),
    defeated: item.state === 'accepted',
    committedXp: committedXpOf(item),
  }));

  return {
    mode: inputs.mode,
    asOfMs: inputs.nowMs,
    specters,
    enemies,
    overflow: { enemies: onField.length - keptField.length, truncated: inputs.workTruncated === true },
    coverage: {
      gaps: inputs.roster.filter((bot) => bot.coverage.state === 'gap').length,
      unknownBots: inputs.roster.filter((bot) => bot.coverage.state === 'unknown' || conditionOf(bot) === 'unknown').length,
    },
  };
}
