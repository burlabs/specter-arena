import { describe, expect, it } from 'vitest';
import { rosterBody } from '@kirocrew/app-sdk';
import {
  ACTIONS_BY_STATE,
  STATE_VIEWS,
  ShapeError,
  actionsFor,
  amountWords,
  botNameOf,
  byCreated,
  isConfirmed,
  isTerminalForLinks,
  levelSpan,
  needsEvidence,
  newWorkRequestId,
  newest,
  parseWorkItem,
  parseWorkItems,
  parseXpHistory,
  parseXpSummaries,
  progressWords,
  shortId,
  stateView,
} from './model';
import { ATLAS, itemOf, listOf, summaryOf } from './testData';

describe('states and actions (M-1, M-2)', () => {
  it('words all seven states and flags an unknown token with no actions', () => {
    expect(Object.keys(STATE_VIEWS).sort()).toEqual(['accepted', 'awaiting-review', 'blocked', 'cancelled', 'open', 'rejected', 'reopened']);
    expect(stateView('awaiting-review').label).toBe('Awaiting your review');
    expect(stateView('reopened')).toMatchObject({ label: 'Reopened', tone: 'open' });
    expect(stateView('mystery').label).toBe('Unknown state (mystery)');
    expect(actionsFor('mystery')).toEqual([]);
  });

  it('offers the transition table of the backend and nothing for a cancelled item', () => {
    expect(ACTIONS_BY_STATE).toEqual({
      open: ['submit', 'block', 'cancel'],
      reopened: ['submit', 'block', 'cancel'],
      'awaiting-review': ['accept', 'reject', 'block', 'cancel'],
      blocked: ['unblock', 'cancel'],
      rejected: ['reopen', 'cancel'],
      accepted: ['reopen'],
      cancelled: [],
    });
  });

  it('knows which actions need a confirm step, which carry evidence and which states stop linking', () => {
    expect(['submit', 'accept', 'reject', 'block', 'unblock', 'cancel', 'reopen'].filter((action) => isConfirmed(action as never))).toEqual(['accept', 'reject', 'cancel', 'reopen']);
    expect(needsEvidence('accept') && needsEvidence('reject') && !needsEvidence('cancel')).toBe(true);
    expect(isTerminalForLinks('accepted') && isTerminalForLinks('cancelled') && !isTerminalForLinks('open')).toBe(true);
  });
});

describe('words and ids (M-3, M-9)', () => {
  it('words progress from milestone counts only', () => {
    expect(progressWords(null)).toBe('Progress unknown');
    expect(progressWords({ done: 1, total: 3 })).toBe('1 of 3 milestones done');
    expect(progressWords({ done: 0, total: 1 })).not.toMatch(/%/);
  });

  it('shortens long ids and leaves short ones', () => {
    expect(shortId('att_0123456789abcdef01234567')).toBe('att_0123…4567');
    expect(shortId('short')).toBe('short');
  });

  it('makes request ids that match the contract pattern and differ', () => {
    const first = newWorkRequestId();
    expect(first).toMatch(/^wrq_[0-9a-f]{24}$/);
    expect(first).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(newWorkRequestId()).not.toBe(first);
  });

  it('prints signed XP amounts', () => {
    expect(amountWords(50)).toBe('+50 XP');
    expect(amountWords(-100)).toBe('-100 XP');
    expect(amountWords(0)).toBe('0 XP');
  });
});

describe('parsers (M-4)', () => {
  it('accept valid bodies', () => {
    expect(parseWorkItem(itemOf()).title).toBe('Migrate the nightly report');
    expect(parseWorkItems(listOf(itemOf())).items).toHaveLength(1);
    expect(parseWorkItems({ items: [] })).toMatchObject({ nextCursor: null, asOfMs: 0 });
    expect(parseXpSummaries({ items: [summaryOf()] }).items).toHaveLength(1);
    expect(parseXpSummaries({ items: [] })).toMatchObject({ asOfMs: 0 });
    const history = parseXpHistory({ bindingId: ATLAS, summary: summaryOf(), items: [{ entryId: 'xpe_1', amount: -5 }] });
    expect(history.items).toHaveLength(1);
    expect(parseXpHistory({ summary: summaryOf(), items: [] })).toMatchObject({ bindingId: '', nextCursor: null, asOfMs: 0 });
  });

  it('throw a ShapeError for anything else', () => {
    const bad = { ...itemOf(), review: { canAccept: true } };
    for (const body of [null, 4, {}, { ...itemOf(), attempts: null }, bad]) expect(() => parseWorkItem(body)).toThrow(ShapeError);
    for (const body of [null, {}, { items: [{}] }, { items: Array.from({ length: 26 }, () => itemOf()) }]) expect(() => parseWorkItems(body)).toThrow(ShapeError);
    for (const body of [null, {}, { items: [{}] }, { items: Array.from({ length: 501 }, () => summaryOf()) }]) expect(() => parseXpSummaries(body)).toThrow(ShapeError);
    for (const body of [null, {}, { summary: summaryOf(), items: [{}] }, { summary: summaryOf(), items: Array.from({ length: 51 }, () => ({ entryId: 'x', amount: 1 })) }, { summary: {}, items: [] }]) {
      expect(() => parseXpHistory(body)).toThrow(ShapeError);
    }
  });
});

describe('ordering and names (M-5, M-6, M-7)', () => {
  it('picks the highest version and keeps the first on a tie', () => {
    const a = itemOf({ version: 2, title: 'A' });
    const b = itemOf({ version: 3, title: 'B' });
    const c = itemOf({ version: 3, title: 'C' });
    expect(newest(a, b)?.title).toBe('B');
    expect(newest(b, c)?.title).toBe('B');
    expect(newest(null, undefined, a)?.title).toBe('A');
    expect(newest(null, undefined)).toBeNull();
  });

  it('sorts newest first with the work id as a stable tiebreak', () => {
    const early = itemOf({ workId: 'wrk_a', createdAtMs: 1 });
    const lateA = itemOf({ workId: 'wrk_a', createdAtMs: 2 });
    const lateB = itemOf({ workId: 'wrk_b', createdAtMs: 2 });
    expect([early, lateA, lateB].sort(byCreated).map((item) => item.workId)).toEqual(['wrk_b', 'wrk_a', 'wrk_a']);
    expect(byCreated(lateA, { ...lateA })).toBe(0);
  });

  it('names a bot from the roster and never guesses for an unknown id', () => {
    const bots = rosterBody('default').items;
    expect(botNameOf(bots, ATLAS)).toBe('Atlas');
    expect(botNameOf(bots, 'bnd_ffffffffffffffffffffffff')).toBe('Unknown bot (bnd_ffff…ffff)');
  });
});

describe('level span (M-8)', () => {
  it('reads the position inside a level', () => {
    expect(levelSpan(summaryOf())).toEqual({ into: 50, span: 150 });
  });

  it('has no span at the top level or for a zero-width span, and never goes negative', () => {
    expect(levelSpan(summaryOf({ nextLevelXp: null }))).toEqual({ into: 50, span: null });
    expect(levelSpan(summaryOf({ nextLevelXp: 100 }))).toEqual({ into: 50, span: null });
    expect(levelSpan(summaryOf({ totalXp: 10 }))).toEqual({ into: 0, span: 150 });
  });
});
