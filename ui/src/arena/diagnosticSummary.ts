import type { RosterItemV1, TaskItemV1, XpSummaryV1 } from '../contracts/types';
import { MODE } from './copy';
import type { SceneModel } from './sceneModel';
import type { ArenaSelection } from './selection';

export const SUMMARY_MAX_CHARS = 4_000;
const TRUNCATED_LINE = '[truncated]';
const REDACTED = '[removed]';

export interface DiagnosticInput {
  selection: ArenaSelection;
  model: SceneModel;
  bot: RosterItemV1 | null;
  /** Only for a task selection, from the evidence read. */
  work: TaskItemV1 | null;
  xp: XpSummaryV1 | null;
}

// Free text from the roster or the work ledger can carry anything a user typed, so the finished text is scrubbed
// as well as built from an allow-list.
const SCRUBBERS: ReadonlyArray<RegExp> = [
  /\bAuthorization\s*:\s*\S+(?:\s+\S+)?/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bBasic\s+(?=[A-Za-z0-9+/]*[0-9=+/])[A-Za-z0-9+/]{8,}={0,2}/g,
  /\b(?:Set-)?Cookie\s*:\s*[^\n]+/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+@\S+/gi,
  /\bhttps?:\/\/\S+/gi,
  // A credential word, optionally inside a longer name such as refresh_token or client_secret, then = or : and a value.
  /(?<![A-Za-z0-9])(?:[A-Za-z0-9]+[_-])*(?:token|secret|key|password|passwd|credential|session|cookie|auth)(?:[_-][A-Za-z0-9]+)*["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s"',;]+)/gi,
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{8,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?/g,
];

export function scrubSecrets(text: string): string {
  return SCRUBBERS.reduce((current, pattern) => current.replace(pattern, REDACTED), text);
}

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

const iso = (ms: number | null): string => (ms === null || !Number.isFinite(ms) ? 'unknown' : new Date(ms).toISOString());

function botLines(bot: RosterItemV1): string[] {
  return [
    `bindingId: ${bot.bindingId}`,
    `condition: ${clean(bot.condition.state)} (${clean(bot.condition.reasonCode)})`,
    `presence: ${clean(bot.presence)}`,
    `coverage: ${clean(bot.coverage.state)}, open gaps ${bot.coverage.openGapCount}`,
    `lastObservedAt: ${iso(bot.lastObservedAtMs)}`,
    `workers: running ${bot.workers.running}, seen ${bot.workers.seen}, unknown ${bot.workers.unknown}`,
  ];
}

function taskLines(task: TaskItemV1): string[] {
  return [
    `taskId: ${task.taskId}`,
    `attemptId: ${task.attemptId}`,
    `bindingId: ${task.bindingId}`,
    `kind: ${clean(task.kind)}`,
    `state: ${clean(task.state)}, closeReason ${task.closeReason === null ? 'none' : clean(task.closeReason)}, attempt ${clean(task.attemptState)}`,
    `startedAt: ${iso(task.startedAtMs)}, endedAt ${iso(task.endedAtMs)}, closedAt ${iso(task.closedAtMs)}`,
    `runMs: ${task.runMs}, sizeClass ${clean(task.sizeClass)}`,
    `xpCredited: ${task.xpCredited === null ? 'none' : task.xpCredited}, policy ${clean(task.policyVersion)}`,
  ];
}

/**
 * Plain text for a person to paste into a bug report: ids, states, labels, ISO times, counts and contract versions.
 * It carries no profile prose, name, URL or message text.
 */
export function diagnosticSummary(input: DiagnosticInput): string {
  const { selection, model, bot, work, xp } = input;
  const versions = [bot === null ? null : `roster-item v${bot.contractVersion}`, work === null ? null : `task-item v${work.contractVersion}`, xp === null ? null : `xp-summary v${xp.contractVersion}`].filter(
    (entry): entry is string => entry !== null,
  );
  const lines = [
    'Specter Arena diagnostic summary',
    `mode: ${MODE[model.mode]}`,
    `asOf: ${iso(model.asOfMs)}`,
    `selection: ${selection.kind}`,
    `coverage: ${model.coverage.gaps} bots with a gap, ${model.coverage.unknownBots} bots unknown`,
    `field: ${model.enemies.length} drawn, ${model.overflow.enemies} not drawn${model.overflow.truncated ? ', counts are a minimum' : ''}`,
    ...(bot === null ? [] : botLines(bot)),
    ...(xp === null ? [] : [`level: ${xp.level}, totalXp ${xp.totalXp}, policy ${xp.policyVersion}`]),
    ...(work === null ? [] : taskLines(work)),
    `contracts: ${versions.length === 0 ? 'none read' : versions.join(', ')}`,
  ];
  const text = scrubSecrets(lines.join('\n'));
  if (text.length <= SUMMARY_MAX_CHARS) return text;
  const room = SUMMARY_MAX_CHARS - TRUNCATED_LINE.length - 1;
  const cut = text.slice(0, room);
  return `${cut.slice(0, Math.max(0, cut.lastIndexOf('\n')))}\n${TRUNCATED_LINE}`;
}
