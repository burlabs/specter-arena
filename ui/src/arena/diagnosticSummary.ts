import type { RosterItemV1, WorkItemV1, XpSummaryV1 } from '../contracts/types';
import { MODE } from './copy';
import type { SceneModel } from './sceneModel';
import type { ArenaSelection } from './selection';

export const SUMMARY_MAX_CHARS = 4_000;
export const SUMMARY_TITLE_MAX_CHARS = 120;
const TRUNCATED_LINE = '[truncated]';
const RECENT_DECISIONS = 5;
const REDACTED = '[removed]';

export interface DiagnosticInput {
  selection: ArenaSelection;
  model: SceneModel;
  bot: RosterItemV1 | null;
  /** Only for a work selection, from the evidence read. */
  work: WorkItemV1 | null;
  xp: XpSummaryV1 | null;
}

// Free text from the roster or the work ledger can carry anything a user typed, so the finished text is scrubbed
// as well as built from an allow-list.
const SCRUBBERS: ReadonlyArray<RegExp> = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bhttps?:\/\/\S+/gi,
  /\b(?:token|key|auth|secret|password|passwd|api[_-]?key|access[_-]?token|session)\s*[=:]\s*\S+/gi,
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

const limited = (title: string): string => {
  const text = clean(title);
  return text.length <= SUMMARY_TITLE_MAX_CHARS ? text : `${text.slice(0, SUMMARY_TITLE_MAX_CHARS - 1)}…`;
};

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

function workLines(work: WorkItemV1): string[] {
  const lines = [
    `workId: ${work.workId}`,
    `parentId: ${work.parentId ?? 'none'}`,
    `title: ${limited(work.title)}`,
    `state: ${clean(work.state)}`,
    `progress: ${work.progress === null ? 'unknown' : `${work.progress.done} of ${work.progress.total} milestones`}`,
    `evidenceRevision: ${work.evidenceRevision}`,
    `blockers: ${work.review.blockers.length === 0 ? 'none' : work.review.blockers.map(clean).join(', ')}`,
    `attempts: ${work.attempts.length}`,
    ...work.attempts.map((attempt) => `attempt ${attempt.attemptId}: ${clean(attempt.kind)}, ${attempt.present ? (attempt.ended ? 'ended' : 'open') : 'not found'}`),
    ...work.contributors.map((contributor) => `contributor ${contributor.bindingId}: ${contributor.attemptCount} attempts, xpNet ${contributor.xpNet}`),
  ];
  const recent = [...work.decisions].sort((a, b) => b.seq - a.seq).slice(0, RECENT_DECISIONS);
  for (const decision of recent) lines.push(`decision ${decision.seq}: ${clean(decision.action)} ${clean(decision.fromState)}>${clean(decision.toState)} at ${iso(decision.atMs)}`);
  return lines;
}

/**
 * Plain text for a person to paste into a bug report: ids, states, labels, ISO times, counts and contract versions.
 * It carries no decision note, acceptance condition, milestone label, profile prose, name, URL or message text.
 */
export function diagnosticSummary(input: DiagnosticInput): string {
  const { selection, model, bot, work, xp } = input;
  const versions = [bot === null ? null : `roster-item v${bot.contractVersion}`, work === null ? null : `work-item v${work.contractVersion}`, xp === null ? null : `xp-summary v${xp.contractVersion}`].filter(
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
    ...(work === null ? [] : workLines(work)),
    `contracts: ${versions.length === 0 ? 'none read' : versions.join(', ')}`,
  ];
  const text = scrubSecrets(lines.join('\n'));
  if (text.length <= SUMMARY_MAX_CHARS) return text;
  const room = SUMMARY_MAX_CHARS - TRUNCATED_LINE.length - 1;
  const cut = text.slice(0, room);
  return `${cut.slice(0, Math.max(0, cut.lastIndexOf('\n')))}\n${TRUNCATED_LINE}`;
}
