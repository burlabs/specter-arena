import { describe, expect, it } from 'vitest';
import { attemptsBody, rosterBody } from '@kirocrew/app-sdk';
import type { AttemptItemV1, AttemptsWindowV1, RosterConditionV1, RosterItemV1 } from '../contracts/types';
import * as copy from './copy';
import * as model from './model';
import { UNNAMED, attemptCondition, botCondition, coverageSentence, formatDuration, isOpen, mergeAttempts, sourceRows, formatTime, initialsOf, matchesQuery, nameOf, sortRoster, workerChips } from './model';

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
});

const attempt = (state: string, reasonCode: string, kind = 'worker', attemptId = 'att_1', startedMs = 1): AttemptItemV1 => ({
  contractVersion: 1,
  attemptId,
  kind,
  startedMs,
  endedMs: null,
  endSignal: null,
  condition: { state, reasonCode },
});

describe('attempt conditions', () => {
  it('maps attempt states and never calls an ended attempt done, finished or succeeded', () => {
    expect(attemptCondition(attempt('working', 'running'))).toMatchObject({ label: 'Working', tone: 'working' });
    const ended = attemptCondition(attempt('ended', 'ended-chat-done'));
    expect(ended).toMatchObject({ label: 'Ended', tone: 'ended' });
    expect(`${ended.label} ${ended.reason}`).not.toMatch(/\b(idle|done|finished|succeeded)\b/i);
    expect(attemptCondition(attempt('unknown', 'feed-absent')).label).toBe('Unknown');
    expect(attemptCondition(attempt('weird', 'x')).reason).toBe('Reason code: weird');
  });

  it('names the subject of a running attempt', () => {
    expect(attemptCondition(attempt('working', 'running', 'worker')).reason).toContain('this worker');
    expect(attemptCondition(attempt('working', 'running', 'bot-turn')).reason).toContain('this turn');
  });

  it('counts anything not ended as open', () => {
    expect([isOpen(attempt('working', 'running')), isOpen(attempt('unknown', 'feed-absent')), isOpen(attempt('ended', 'ended-other'))]).toEqual([true, true, false]);
  });
});

describe('durations and coverage sentences', () => {
  it.each([
    [0, '0 m'],
    [1, 'under 1 m'],
    [59_999, 'under 1 m'],
    [60_000, '1 m'],
    [11_400_000, '3 h 10 m'],
    [26 * 3_600_000, '1 d 2 h'],
    [-5, '0 m'],
  ])('formats %i ms as %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  const window = (overrides: Partial<AttemptsWindowV1>): AttemptsWindowV1 => ({
    fromMs: 0, toMs: 86_400_000, windowMs: 86_400_000, observedFromMs: 0, coveredMs: 3_600_000, gapCount: 0,
    botTurnsStarted: 0, workersStarted: 0, sampleSize: 0, ended: 0, stillOpen: 0, unknown: 0, ...overrides,
  });

  it('words coverage against the window, against the time since first seen, and with gaps', () => {
    expect(coverageSentence(window({}), '24 h')).toBe('Collector covered 1 h of 24 h');
    expect(coverageSentence(window({ observedFromMs: 80_000_000, coveredMs: 3_000_000, gapCount: 1 }), '24 h')).toBe(
      'Collector covered 50 m of the 1 h 46 m since this bot was first seen (1 gap)',
    );
    expect(coverageSentence(window({ gapCount: 3 }), '7 d')).toBe('Collector covered 1 h of 7 d (3 gaps)');
    expect(coverageSentence(window({ coveredMs: 0 }), '24 h')).toBe('Not collected');
  });

  it('matches the two-concurrent fixture wording', () => {
    const [atlas] = rosterBody('two-concurrent').items;
    const body = attemptsBody('two-concurrent', atlas?.bindingId ?? '');
    expect(coverageSentence(body?.activity.last24h as AttemptsWindowV1, '24 h')).toBe(
      'Collector covered 1 h 43 m of the 1 h 53 m since this bot was first seen (1 gap)',
    );
  });
});

describe('mergeAttempts', () => {
  it('drops duplicate ids, keeps the first list copy, and sorts newest first with the id as tiebreak', () => {
    const merged = mergeAttempts(
      [attempt('working', 'running', 'worker', 'att_b', 10), attempt('working', 'running', 'worker', 'att_a', 10)],
      [attempt('ended', 'ended-other', 'worker', 'att_b', 10), attempt('ended', 'ended-other', 'worker', 'att_c', 20)],
    );
    expect(merged.map((entry) => [entry.attemptId, entry.condition.state])).toEqual([
      ['att_c', 'ended'],
      ['att_b', 'working'],
      ['att_a', 'working'],
    ]);
    const ids = (first: AttemptItemV1[]) => mergeAttempts(first, []).map((entry) => entry.attemptId);
    expect(ids([attempt('working', 'running', 'worker', 'att_a', 10), attempt('working', 'running', 'worker', 'att_b', 10)])).toEqual(['att_b', 'att_a']);
    expect(ids([attempt('working', 'running', 'worker', 'att_b', 10), attempt('working', 'running', 'worker', 'att_a', 10)])).toEqual(['att_b', 'att_a']);
  });
});

describe('sourceRows allowlist', () => {
  it('names each field and never passes an unknown wire key through', () => {
    const [atlas] = rosterBody('two-concurrent').items;
    if (atlas === undefined) throw new Error('fixture');
    const poisoned = { ...atlas, prompt: 'SECRET-PROMPT', slotKey: 'SLOT-1', memory_store: 'STORE-1', tokens: 99 };
    const collector = { state: 'running', reasonCode: null, sinceMs: null };
    const rows = sourceRows(poisoned, collector, 4, attemptsBody('two-concurrent', atlas.bindingId));
    const dump = JSON.stringify(rows);
    for (const leak of ['SECRET-PROMPT', 'SLOT-1', 'STORE-1', 'prompt', 'slotKey', 'memory_store', 'tokens']) expect(dump).not.toContain(leak);
    expect(rows.map((row) => row.label)).toContain('7 d window from');
    expect(sourceRows(atlas, collector, 4, null).map((row) => row.label)).not.toContain('7 d window from');
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
