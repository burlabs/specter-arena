// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COVERAGE_STATE_WORDS,
  REASON_WORDS,
  attemptKindLabel,
  collectorWords,
  noteWords,
  reasonWords,
  signalWords,
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

  it('names the subject of a running attempt', () => {
    expect(reasonWords('running', 'worker')).toContain('this worker');
    expect(reasonWords('running', 'bot-turn')).toContain('this turn');
    expect(reasonWords('running')).toContain('a turn running');
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

  it('labels kinds, signals and coverage states', () => {
    expect(attemptKindLabel('bot-turn')).toBe('Bot turn');
    expect(attemptKindLabel('worker')).toBe('Worker');
    expect(attemptKindLabel('cron')).toBe('cron');
    expect([signalWords(true), signalWords(false), signalWords(null)]).toEqual(['Yes', 'No', 'Not seen']);
    expect(COVERAGE_STATE_WORDS.gap).toBe('Gap in collection');
  });
});
