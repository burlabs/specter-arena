// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as copy from './copy';
import {
  COVERAGE_STATE_WORDS,
  attemptKindLabel,
  endSignalLabel,
  signalWords,
  REASON_WORDS,
  collectorWords,
  noteWords,
  reasonWords,
  truncationWords,
} from './copy';

const records = readFileSync(fileURLToPath(new URL('../../../backend/specter_arena/store/records.py', import.meta.url)), 'utf8');

function coverageReasons(): string[] {
  const block = /COVERAGE_REASONS\s*=\s*frozenset\(\s*\{([^}]*)\}/.exec(records)?.[1] ?? '';
  return [...block.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1] ?? '');
}

describe('reason words tripwire', () => {
  it('parses the backend coverage reasons', () => {
    expect(coverageReasons().length).toBeGreaterThanOrEqual(14);
  });

  it.each([
    ...coverageReasons(),
    'heartbeat-stale',
    'no-coverage',
    'never-observed',
    'presence-absent',
    'presence-unknown',
    'running',
    'not-running',
    'approval-pending',
    'question-pending',
    'ended-row-idle',
    'ended-chat-done',
    'ended-other',
    'collector-not-started',
    'shutdown',
    'internal-error',
  ])('has words for %s', (code) => {
    expect(REASON_WORDS[code]?.trim().length).toBeGreaterThan(0);
  });

  it('falls back to the code for a code it does not know', () => {
    expect(reasonWords('made-up-code')).toBe('Reason code: made-up-code');
  });

  it('words a running bot', () => {
    expect(reasonWords('running')).toContain('a turn running');
    expect(reasonWords('running', 'worker')).toContain('this worker');
    expect(reasonWords('running', 'bot-turn')).toContain('this turn');
  });
});

describe('user-facing words', () => {
  const strings = (value: unknown): string[] => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings);
    return [];
  };

  it('never uses idle, done, finished or succeeded', () => {
    const { REASON_WORDS: reasons, ...rest } = copy;
    const sampled = [
      ...strings(reasons),
      ...strings(rest),
      ...['starting', 'running', 'reconnecting', 'paused', 'stopped', 'unavailable', 'odd'].flatMap((state) => [collectorWords(state, null), collectorWords(state, 'paused')]),
      noteWords('cron-turns-not-observable', null),
      noteWords('unsupported-store-less-bot', 2),
      noteWords('other', null),
      truncationWords(10),
      ...['row-idle', 'chat-done', null, 'other'].map(endSignalLabel),
      ...['bot-turn', 'worker'].map(attemptKindLabel),
      ...[true, false, null].map(signalWords),
      reasonWords('running', 'worker'),
      reasonWords('running', 'bot-turn'),
    ];
    expect(sampled.length).toBeGreaterThan(60);
    expect(sampled.filter((text) => /\b(idle|done|finished|succeeded)\b/i.test(text))).toEqual([]);
  });

  it('words the ended reasons without the Crew event names', () => {
    expect(REASON_WORDS['ended-row-idle']).toBe("Ended. Crew's row stopped reporting a running turn.");
    expect(REASON_WORDS['ended-chat-done']).toBe("Ended when Crew's turn-complete event arrived.");
  });
});

describe('collector, note and other words', () => {
  it('writes the state and then the reason', () => {
    expect(collectorWords('running', null)).toBe('Collector is running.');
    expect(collectorWords('unavailable', 'collector-not-started')).toBe('Collector unavailable. The backend has not started its collector.');
    expect(collectorWords('odd', null)).toBe('Collector state: odd.');
    expect(collectorWords('odd', 'odd-reason')).toBe('Collector state: odd. Reason code: odd-reason');
  });

  it('writes notes without claiming completeness', () => {
    expect(noteWords('cron-turns-not-observable', null)).toContain('cron');
    expect(noteWords('unsupported-store-less-bot', 2)).toBe('2 bots on Crew have no memory store and cannot be monitored.');
    expect(noteWords('unsupported-store-less-bot', 1)).toBe('1 bot on Crew has no memory store and cannot be monitored.');
    expect(noteWords('unsupported-store-less-bot', null)).toBe('Note: unsupported-store-less-bot');
    expect(noteWords('other', 3)).toBe('Note: other');
    expect(truncationWords(2000)).toBe('Roster truncated: showing the first 2000 bots. Search narrows only what was loaded.');
  });

  it('labels attempt kinds, end signals and raw signals', () => {
    expect(attemptKindLabel('bot-turn')).toBe('Bot turn');
    expect(attemptKindLabel('worker')).toBe('Worker');
    expect(attemptKindLabel('cron')).toBe('cron');
    expect([endSignalLabel('row-idle'), endSignalLabel('chat-done'), endSignalLabel(null), endSignalLabel('other')]).toEqual([
      'Row stopped running',
      'Turn-complete event',
      'Still open',
      'Signal: other',
    ]);
    expect([signalWords(true), signalWords(false), signalWords(null)]).toEqual(['Yes', 'No', 'Not seen']);
  });

  it('labels coverage states', () => {
    expect(COVERAGE_STATE_WORDS.gap).toBe('Gap in collection');
  });
});
