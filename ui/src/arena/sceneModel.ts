import type { HeroId, RosterItemV1, TaskItemV1, TaskSizeClassV1, TaskStateV1, XpSummaryV1 } from '../contracts/types';
import type { SourceMode } from '../host';
import { nameOf } from '../observatory/model';
import { taskTitle } from '../tasks/copy';
import type { ArenaSpecter } from './specterShape';

export const ENEMY_CAP = 80;
export const DEFEATED_MAX = 12;
export const DEFEATED_WINDOW_MS = 24 * 3_600_000;

export interface SceneInputs {
  mode: SourceMode;
  nowMs: number;
  roster: readonly RosterItemV1[];
  specters: readonly ArenaSpecter[];
  xp: readonly XpSummaryV1[];
  /** The tasks the arena read: open ones, and the latest credited and not-credited pages. */
  tasks: readonly TaskItemV1[];
  /** The open-task stream still had a cursor after the page cap, so counts are a minimum. */
  tasksTruncated?: boolean;
  /** Whether the XP ledger has been read. While it has not, a bot's level and XP are unknown, never "Level 1" and "0 XP". Default `ready`. */
  xpStatus?: XpReading;
}

export type XpReading = 'ready' | 'loading' | 'failed';
export type WaitingReason = 'approval-pending' | 'question-pending';

export type Progress = { kind: 'milestones'; done: number; total: number } | { kind: 'unknown' };

export interface SceneSpecter {
  bindingId: string;
  displayName: string;
  /** The hero's display name ("Vell II"), or null before the assignment shows up in a poll. */
  specterName: string | null;
  heroId: HeroId | null;
  portraitAssetId: string | null;
  condition: 'working' | 'settled' | 'waiting' | 'unknown';
  openAttemptIds: string[];
  engagedWorkIds: string[];
  xpTotal: number;
  level: number;
  /** `loading` or `failed` means `xpTotal` and `level` are placeholders and must not be shown as numbers. */
  xpReading: XpReading;
  /** Crew's row flag behind a `waiting` condition, or null. A reading from Crew, not something this app checked. */
  waitingReason: WaitingReason | null;
}

/**
 * One enemy is one automatically built task. `workId` holds the task id (the name is kept so the drawing code does not
 * change). `sizeClass` and `runMs` are presentation only: they never mean progress, health, remaining effort or XP.
 */
export interface SceneEnemy {
  workId: string;
  parentId: string | null;
  title: string;
  size: 'minion' | 'encounter';
  state: TaskStateV1;
  sizeClass: TaskSizeClassV1;
  runMs: number;
  progress: Progress;
  /** Always null for a task. Kept for the encounter shape. */
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

const waitingReasonOf = (item: RosterItemV1): WaitingReason | null =>
  item.condition.state === 'waiting' && (item.condition.reasonCode === 'approval-pending' || item.condition.reasonCode === 'question-pending') ? item.condition.reasonCode : null;

const conditionOf = (item: RosterItemV1): SceneSpecter['condition'] => {
  const state = item.condition.state;
  return state === 'working' || state === 'settled' || state === 'waiting' ? state : 'unknown';
};

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byId = <T extends { workId: string }>(a: T, b: T): number => compareText(a.workId, b.workId);
const byUpdated = (a: TaskItemV1, b: TaskItemV1): number => b.updatedAtMs - a.updatedAtMs || compareText(b.taskId, a.taskId);

/** The award a credited task wrote, or null. Containers do not exist for tasks. */
export const committedXpOf = (task: Pick<TaskItemV1, 'state' | 'xpCredited'>): number | null => (task.state === 'credited' ? task.xpCredited : null);

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

  const onField = inputs.tasks.filter((task) => task.state === 'open');
  const defeated = inputs.tasks
    .filter((task) => task.state === 'credited' && (task.closedAtMs ?? task.updatedAtMs) >= inputs.nowMs - DEFEATED_WINDOW_MS)
    .sort((a, b) => (b.closedAtMs ?? b.updatedAtMs) - (a.closedAtMs ?? a.updatedAtMs) || compareText(a.taskId, b.taskId))
    .slice(0, DEFEATED_MAX);
  const room = Math.max(0, enemyCap - defeated.length);
  // The newest-updated open tasks stay when the cap drops some.
  const keptField = [...onField].sort(byUpdated).slice(0, room);
  const kept = [...defeated, ...keptField];
  const keptIds = new Set(kept.map((task) => task.taskId));

  const engagedByTask = new Map<string, Set<string>>();
  const openByBot = new Map<string, Set<string>>();
  const engagedByBot = new Map<string, Set<string>>();
  for (const task of onField) {
    const bot = rosterById.get(task.bindingId);
    if (bot === undefined || task.attemptState === 'ended') continue;
    addTo(openByBot, bot.bindingId, task.attemptId);
    if (!keptIds.has(task.taskId) || task.attemptState !== 'working') continue;
    addTo(engagedByTask, task.taskId, bot.bindingId);
    addTo(engagedByBot, bot.bindingId, task.taskId);
  }

  const specters: SceneSpecter[] = [...inputs.roster]
    .sort((a, b) => compareText(a.bindingId, b.bindingId))
    .map((bot) => {
      const specter = specterByBot.get(bot.bindingId);
      const summary = xpByBot.get(bot.bindingId);
      return {
        bindingId: bot.bindingId,
        displayName: nameOf(bot),
        specterName: specter?.displayName ?? null,
        heroId: specter?.heroId ?? null,
        portraitAssetId: specter?.portrait.assetId ?? null,
        condition: conditionOf(bot),
        openAttemptIds: sorted(openByBot.get(bot.bindingId)),
        engagedWorkIds: sorted(engagedByBot.get(bot.bindingId)),
        xpTotal: summary?.totalXp ?? 0,
        level: summary?.level ?? 1,
        xpReading: summary === undefined ? (inputs.xpStatus ?? 'ready') : 'ready',
        waitingReason: waitingReasonOf(bot),
      };
    });

  const enemyOf = (task: TaskItemV1, engagedBy: string[]): SceneEnemy => ({
    workId: task.taskId,
    parentId: null,
    title: taskTitle(task),
    size: 'minion',
    state: task.state,
    sizeClass: task.sizeClass,
    runMs: task.runMs,
    progress: { kind: 'unknown' },
    parts: null,
    blocked: false,
    engagedBy,
    defeated: task.state === 'credited',
    committedXp: committedXpOf(task),
  });
  const enemies = kept.map((task) => enemyOf(task, sorted(engagedByTask.get(task.taskId)))).sort(byId);

  return {
    mode: inputs.mode,
    asOfMs: inputs.nowMs,
    specters,
    enemies,
    overflow: { enemies: onField.length - keptField.length, truncated: inputs.tasksTruncated === true },
    coverage: {
      gaps: inputs.roster.filter((bot) => bot.coverage.state === 'gap').length,
      unknownBots: inputs.roster.filter((bot) => bot.coverage.state === 'unknown' || conditionOf(bot) === 'unknown').length,
    },
  };
}
