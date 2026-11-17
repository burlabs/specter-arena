import { describe, expect, it } from 'vitest';
import type { AttemptItemV1, RosterConditionV1, RosterItemV1 } from '../contracts/types';
import * as copy from './copy';
import * as model from './model';
import { UNNAMED, attemptCondition, botCondition, formatTime, initialsOf, matchesQuery, nameOf, sortRoster, workerChips } from './model';

const signals = { needsInput: null, hasOptions: null, pendingApproval: null, waitingForInput: null };
const condition = (state: string, reasonCode: string): RosterConditionV1 => ({ state, reasonCode, basis: null, sourceTimeMs: null, observedAtMs: null, signals });
const item = (bindingId: string, displayName: string | null): RosterItemV1 => ({
  contractVersion: 1,
  bindingId,
  displayName,
  avatar: null,
  presence: 'present',
  condition: condition('unknown', 'never-observed'),
  coverage: { state: 'unknown', sinceMs: null, reasonCode: null, openGapCount: 0 },
  lastObservedAtMs: null,
  workers: { running: 0, seen: 0, unknown: 0 },
});
const attempt = (state: string, reasonCode: string, kind = 'worker'): AttemptItemV1 => ({
  contractVersion: 1,
  attemptId: 'att_1',
  kind,
  startedMs: 1,
  endedMs: null,
  endSignal: null,
  condition: { state, reasonCode },
});

describe('condition labels', () => {
  it.each([
    ['working', 'Working', 'working'],
    ['settled', 'No turn running', 'settled'],
    ['unknown', 'Unknown', 'unknown'],
  ])('maps bot state %s to %s', (state, label, tone) => {
    expect(botCondition(condition(state, 'running'))).toMatchObject({ label, tone });
  });

  it('shows an unrecognised bot state as Unknown with its code', () => {
    expect(botCondition(condition('degraded', 'x'))).toEqual({ tone: 'unknown', label: 'Unknown', reason: 'Reason code: degraded' });
  });

  it('never labels a settled bot idle, available or healthy', () => {
    const view = botCondition(condition('settled', 'not-running'));
    expect(`${view.label} ${view.reason}`).not.toMatch(/idle|available|healthy/i);
  });

  it('maps attempt states and never calls an ended attempt done, finished or succeeded', () => {
    expect(attemptCondition(attempt('working', 'running'))).toMatchObject({ label: 'Working', tone: 'working' });
    const ended = attemptCondition(attempt('ended', 'ended-chat-done'));
    expect(ended).toMatchObject({ label: 'Ended', tone: 'ended' });
    expect(ended.label).not.toMatch(/done|finished|succeeded/i);
    expect(ended.reason).not.toMatch(/finished|succeeded/i);
    expect(attemptCondition(attempt('unknown', 'feed-absent')).label).toBe('Unknown');
    expect(attemptCondition(attempt('weird', 'x')).reason).toBe('Reason code: weird');
  });
});

describe('worker chips', () => {
  it('keeps unknown separate from working and omits zero counts', () => {
    expect(workerChips({ running: 1, seen: 2, unknown: 1 })).toEqual([
      { key: 'working', count: 1, text: '1 worker working' },
      { key: 'unknown', count: 1, text: '1 worker unknown' },
    ]);
    expect(workerChips({ running: 2, seen: 2, unknown: 0 })).toEqual([{ key: 'working', count: 2, text: '2 workers working' }]);
    expect(workerChips({ running: 0, seen: 3, unknown: 0 })).toEqual([]);
  });

  it('fails quiet when an older backend omits unknown', () => {
    expect(workerChips({ running: 0, seen: 1 } as never)).toEqual([]);
  });
});

describe('names, initials, sorting and search', () => {
  it('names an unnamed bot and takes initials from the name, never the id', () => {
    expect(nameOf(item('bnd_x', null))).toBe(UNNAMED);
    expect(nameOf(item('bnd_x', '   '))).toBe(UNNAMED);
    expect(initialsOf(item('bnd_zzz', null))).toBe('?');
    expect(initialsOf(item('bnd_zzz', '  '))).toBe('?');
    expect(initialsOf(item('bnd_zzz', 'atlas'))).toBe('A');
    expect(initialsOf(item('bnd_zzz', 'Ada Lovelace King'))).toBe('AL');
    expect(initialsOf(item('bnd_zzz', '🙂 smile'))).toBe('🙂S');
  });

  it('sorts by name ignoring case, with the id as tiebreak', () => {
    const sorted = sortRoster([item('b', 'beta'), item('z', 'Alpha'), item('a', 'alpha'), item('c', null)]);
    expect(sorted.map((entry) => entry.bindingId)).toEqual(['a', 'z', 'b', 'c']);
    expect(sortRoster([item('b', 'same'), item('a', 'same')]).map((entry) => entry.bindingId)).toEqual(['a', 'b']);
    expect(sortRoster([item('a', 'same'), item('b', 'same')]).map((entry) => entry.bindingId)).toEqual(['a', 'b']);
  });

  it('matches a query on the name, including the placeholder for a null name', () => {
    expect(matchesQuery(item('a', 'Atlas'), '')).toBe(true);
    expect(matchesQuery(item('a', 'Atlas'), ' TLA ')).toBe(true);
    expect(matchesQuery(item('a', 'Atlas'), 'zz')).toBe(false);
    expect(matchesQuery(item('a', null), 'unnamed')).toBe(true);
  });
});

describe('formatTime', () => {
  const ms = Date.UTC(2026, 10, 17, 12, 5);
  it('renders the pinned locale and zone', () => {
    expect(formatTime(ms, { locale: 'en-US', timeZone: 'UTC' })).toBe('Nov 17, 2026, 12:05 PM');
    expect(formatTime(ms, { locale: 'de-DE', timeZone: 'Asia/Tokyo' })).toContain('17.11.2026');
    expect(formatTime(ms, { locale: 'en-US', timeZone: 'UTC', long: true })).toContain('UTC');
  });
});

describe('what the page never computes', () => {
  it('exports no rate, average, rank, score, percent or token', () => {
    const names = [...Object.keys(model), ...Object.keys(copy)];
    expect(names.filter((name) => /rate|average|rank|score|percent|token/i.test(name))).toEqual([]);
  });
});
