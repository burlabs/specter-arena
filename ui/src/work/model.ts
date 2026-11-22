import type { RosterItemV1, XpHistoryV1, XpSummariesV3, XpSummaryV1, XpSummaryV2 } from '../contracts/types';
import { nameOf } from '../observatory/model';

export const shortId = (id: string): string => (id.length <= 12 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`);

export class ShapeError extends Error {}
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isText = (value: unknown): value is string => typeof value === 'string';

const isSummary = (value: unknown): value is XpSummaryV1 =>
  isObject(value) && isText(value.bindingId) && typeof value.totalXp === 'number' && typeof value.level === 'number' && isText(value.levelTableVersion);

const isSummaryV2 = (value: unknown): value is XpSummaryV2 =>
  isSummary(value) &&
  value.contractVersion === 2 &&
  typeof (value as { creditedTaskCount?: unknown }).creditedTaskCount === 'number' &&
  Number.isInteger((value as unknown as XpSummaryV2).creditedTaskCount) &&
  (value as unknown as XpSummaryV2).creditedTaskCount >= 0;

/** One page of `xp-summaries.v3` (items are `xp-summary.v2`). Fails closed on any other contract version. */
export function parseXpSummariesPage(body: unknown): XpSummariesV3 {
  const page = body as Partial<XpSummariesV3> | null;
  if (
    page === null ||
    typeof page !== 'object' ||
    page.contractVersion !== 3 ||
    !Array.isArray(page.items) ||
    page.items.length > 200 ||
    !page.items.every(isSummaryV2) ||
    (page.nextCursor != null && !isText(page.nextCursor))
  ) {
    throw new ShapeError('unexpected xp body');
  }
  return { contractVersion: 3, items: page.items, nextCursor: page.nextCursor ?? null, asOfMs: page.asOfMs ?? 0 };
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
