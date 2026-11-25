import { describe, expect, it } from 'vitest';
import { MODE_LABELS, NOT_COLLECTED_WORDS, RECAP, spanWords } from './recapCopy';

describe('recap copy', () => {
  it('writes cut time as seconds, minutes, or hours and minutes, never a percentage', () => {
    expect(spanWords(20_000)).toBe('20 s');
    expect(spanWords(59_400)).toBe('59 s');
    expect(spanWords(60_000)).toBe('1 min');
    expect(spanWords(47 * 60_000)).toBe('47 min');
    expect(spanWords(3 * 3_600_000)).toBe('3 h');
    expect(spanWords(3 * 3_600_000 + 5 * 60_000)).toBe('3 h 5 min');
    expect(RECAP.skipped(47 * 60_000)).toBe('Skipped 47 min');
  });

  it('keeps the four modes in order and names every not-collected reason as not collected', () => {
    expect(MODE_LABELS.map((entry) => entry.label)).toEqual(['Live', 'Today', 'Yesterday', 'This week']);
    expect(Object.keys(NOT_COLLECTED_WORDS).sort()).toEqual(['before-first-run', 'collector-gap', 'no-collector', 'paused', 'purged']);
    for (const words of Object.values(NOT_COLLECTED_WORDS)) expect(words).toMatch(/^Not collected: /);
  });

  it('says how many tasks were left out and how many are not drawn', () => {
    expect(RECAP.truncated(1000, 1500)).toBe('First 1000 tasks of 1500');
    expect(RECAP.notDrawn(1)).toBe('+1 more not drawn');
    expect(RECAP.period('week')).toBe('This week');
    expect(RECAP.tasksBreakdown(2, 1, 0)).toBe('2 credited, 1 not credited, 0 still running');
    expect(RECAP.tasksLabel(1)).toBe('1 task');
    expect(RECAP.tasksLabel(2)).toBe('2 tasks');
  });
});
