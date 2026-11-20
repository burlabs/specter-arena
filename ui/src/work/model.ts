import type { RosterItemV1, WorkItemV1, WorkItemsV2, WorkListItemV1, WorkListOrderV2, XpHistoryV1, XpSummariesV2, XpSummaryV1 } from '../contracts/types';
import { nameOf } from '../observatory/model';
import { PROGRESS } from './copy';

/** Display limits that mirror SC8-2; the server is the authority and answers invalid_body or limit_reached. */
export const LIMITS = { title: 120, condition: 280, note: 280, milestoneLabel: 80, milestones: 8, attempts: 16 } as const;

export type Tone = 'open' | 'review' | 'blocked' | 'rejected' | 'cancelled' | 'accepted';
export interface StateView {
  tone: Tone;
  label: string;
  reason: string;
}

/** A token outside this table is shown as "Unknown state (token)" with no actions. */
export const STATE_VIEWS: Readonly<Record<string, StateView>> = {
  open: { tone: 'open', label: 'Open', reason: 'Being worked on. Nothing has been reviewed.' },
  'awaiting-review': { tone: 'review', label: 'Awaiting your review', reason: 'Sent for review. Only you can accept or reject it.' },
  blocked: { tone: 'blocked', label: 'Blocked', reason: 'You marked this blocked.' },
  rejected: { tone: 'rejected', label: 'Rejected', reason: 'You rejected this. No XP was awarded.' },
  cancelled: { tone: 'cancelled', label: 'Cancelled', reason: 'You cancelled this. It cannot be reopened.' },
  accepted: { tone: 'accepted', label: 'Accepted', reason: 'You accepted this as the app owner.' },
  reopened: { tone: 'open', label: 'Reopened', reason: 'You reopened this. Any XP it earned was taken back.' },
};

export const stateView = (state: string): StateView =>
  STATE_VIEWS[state] ?? { tone: 'open', label: `Unknown state (${state})`, reason: 'This app version does not know this state, so it offers no actions.' };

export type DecisionAction = 'submit' | 'accept' | 'reject' | 'block' | 'unblock' | 'cancel' | 'reopen';

/** Which buttons to show. Display only: the server owns the transition table and answers invalid_transition. */
export const ACTIONS_BY_STATE: Readonly<Record<string, readonly DecisionAction[]>> = {
  open: ['submit', 'block', 'cancel'],
  reopened: ['submit', 'block', 'cancel'],
  'awaiting-review': ['accept', 'reject', 'block', 'cancel'],
  blocked: ['unblock', 'cancel'],
  rejected: ['reopen', 'cancel'],
  accepted: ['reopen'],
  cancelled: [],
};

export const actionsFor = (state: string): readonly DecisionAction[] => ACTIONS_BY_STATE[state] ?? [];
export type ConfirmAction = 'accept' | 'reject' | 'cancel' | 'reopen';
export const CONFIRMED: readonly DecisionAction[] = ['accept', 'reject', 'cancel', 'reopen'];
export const isConfirmed = (action: DecisionAction): action is ConfirmAction => CONFIRMED.includes(action);
export const needsEvidence = (action: DecisionAction): boolean => action === 'accept' || action === 'reject';
export const isTerminalForLinks = (state: string): boolean => state === 'accepted' || state === 'cancelled';

export const shortId = (id: string): string => (id.length <= 12 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`);

export const progressWords = (progress: { done: number; total: number } | null): string =>
  progress === null ? PROGRESS.unknown : PROGRESS.done(progress.done, progress.total);

export function newWorkRequestId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `wrq_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export class ShapeError extends Error {}
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isText = (value: unknown): value is string => typeof value === 'string';

export function isWorkItem(value: unknown): value is WorkItemV1 {
  if (!isObject(value)) return false;
  return (
    isText(value.workId) &&
    isText(value.title) &&
    isText(value.state) &&
    typeof value.version === 'number' &&
    isText(value.evidenceRevision) &&
    Array.isArray(value.attempts) &&
    Array.isArray(value.contributors) &&
    Array.isArray(value.milestones) &&
    Array.isArray(value.decisions) &&
    isObject(value.review) &&
    Array.isArray((value.review as { blockers?: unknown }).blockers)
  );
}

export function parseWorkItem(body: unknown): WorkItemV1 {
  if (!isWorkItem(body)) throw new ShapeError('unexpected work item body');
  return body;
}

/**
 * What a list row, the arena scene and the Work list read: the list fields only. A `WorkListItemV1` and a full
 * `WorkItemV1` both satisfy it, so display code that needs nothing more never has to know which one it got.
 */
export type WorkRowV1 = Pick<
  WorkItemV1,
  'workId' | 'parentId' | 'title' | 'rewardable' | 'bountyXp' | 'state' | 'version' | 'createdAtMs' | 'updatedAtMs' | 'attempts' | 'contributors' | 'progress' | 'childCount' | 'childrenAccepted'
>;

const isNumber = (value: unknown): value is number => typeof value === 'number';

export function isWorkListItem(value: unknown): value is WorkListItemV1 {
  if (!isObject(value)) return false;
  return (
    isText(value.workId) &&
    isText(value.title) &&
    isText(value.state) &&
    isNumber(value.version) &&
    isNumber(value.createdAtMs) &&
    isNumber(value.updatedAtMs) &&
    isNumber(value.childCount) &&
    isNumber(value.childrenAccepted) &&
    typeof value.rewardable === 'boolean' &&
    typeof value.everAccepted === 'boolean' &&
    Array.isArray(value.attempts) &&
    Array.isArray(value.contributors) &&
    (value.progress === null || isObject(value.progress))
  );
}

/** A write response is a full item; the list holds the list projection of it until the next poll catches up. */
export function listItemOf(item: WorkItemV1): WorkListItemV1 {
  return {
    contractVersion: 1,
    workId: item.workId,
    parentId: item.parentId,
    title: item.title,
    rewardable: item.rewardable,
    bountyXp: item.bountyXp,
    state: item.state,
    version: item.version,
    createdAtMs: item.createdAtMs,
    updatedAtMs: item.updatedAtMs,
    attempts: item.attempts,
    contributors: item.contributors,
    progress: item.progress,
    childCount: item.childCount,
    childrenAccepted: item.childrenAccepted,
    everAccepted: item.decisions.some((decision) => decision.action === 'accept'),
  };
}

/** `work-items.v2`. Fails closed on any other contract version, a different order than the one asked for, or an old full-item body. */
export function parseWorkListPage(body: unknown, order: WorkListOrderV2): WorkItemsV2 {
  const page = body as Partial<WorkItemsV2> | null;
  if (
    page === null ||
    typeof page !== 'object' ||
    page.contractVersion !== 2 ||
    page.order !== order ||
    !Array.isArray(page.items) ||
    page.items.length > 25 ||
    !page.items.every(isWorkListItem) ||
    (page.nextCursor != null && !isText(page.nextCursor))
  ) {
    throw new ShapeError('unexpected work list body');
  }
  return { contractVersion: 2, order, items: page.items, nextCursor: page.nextCursor ?? null, asOfMs: page.asOfMs ?? 0 };
}

const isSummary = (value: unknown): value is XpSummaryV1 =>
  isObject(value) && isText(value.bindingId) && typeof value.totalXp === 'number' && typeof value.level === 'number' && isText(value.levelTableVersion);

/** One page of `xp-summaries.v2`. */
export function parseXpSummariesPage(body: unknown): XpSummariesV2 {
  const page = body as Partial<XpSummariesV2> | null;
  if (
    page === null ||
    typeof page !== 'object' ||
    page.contractVersion !== 2 ||
    !Array.isArray(page.items) ||
    page.items.length > 200 ||
    !page.items.every(isSummary) ||
    (page.nextCursor != null && !isText(page.nextCursor))
  ) {
    throw new ShapeError('unexpected xp body');
  }
  return { contractVersion: 2, items: page.items, nextCursor: page.nextCursor ?? null, asOfMs: page.asOfMs ?? 0 };
}

export function parseXpHistory(body: unknown): XpHistoryV1 {
  const page = body as Partial<XpHistoryV1> | null;
  if (
    page === null ||
    !isSummary(page.summary) ||
    !Array.isArray(page.items) ||
    page.items.length > 50 ||
    !page.items.every((entry) => isObject(entry) && isText(entry.entryId) && typeof entry.amount === 'number')
  ) {
    throw new ShapeError('unexpected xp history body');
  }
  return { contractVersion: 1, bindingId: page.bindingId ?? '', summary: page.summary, items: page.items, nextCursor: page.nextCursor ?? null, asOfMs: page.asOfMs ?? 0 };
}

/** The item with the highest version wins; on a tie the first argument wins (the freshest source goes first). */
export function newest(...items: ReadonlyArray<WorkItemV1 | null | undefined>): WorkItemV1 | null {
  let best: WorkItemV1 | null = null;
  for (const item of items) if (item != null && (best === null || item.version > best.version)) best = item;
  return best;
}

/** Newest first; workId descending breaks ties so a poll never reorders equals. */
export const byCreated = (a: WorkRowV1, b: WorkRowV1): number => b.createdAtMs - a.createdAtMs || (a.workId < b.workId ? 1 : a.workId > b.workId ? -1 : 0);

export function botNameOf(bots: readonly RosterItemV1[], bindingId: string): string {
  const bot = bots.find((item) => item.bindingId === bindingId);
  return bot === undefined ? `Unknown bot (${shortId(bindingId)})` : nameOf(bot);
}

/** Level meter numbers from the summary only. span is null at the top level. */
export function levelSpan(summary: XpSummaryV1): { into: number; span: number | null } {
  const into = Math.max(0, summary.totalXp - summary.levelFloorXp);
  const span = summary.nextLevelXp === null ? null : summary.nextLevelXp - summary.levelFloorXp;
  return { into, span: span !== null && span > 0 ? span : null };
}

export const amountWords = (amount: number): string => `${amount > 0 ? '+' : amount < 0 ? '-' : ''}${Math.abs(amount)} XP`;
