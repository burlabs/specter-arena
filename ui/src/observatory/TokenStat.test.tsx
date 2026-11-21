import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TokenStat } from './TokenStat';
import { CONTEXT_COPY, contextWords } from './copy';
import { TimeFormatContext } from './Time';

const FORBIDDEN = /\b(idle|healthy|available|done|finished|succeeded)\b/i;
const OBSERVED = Date.UTC(2026, 10, 21, 12, 0);

function view(reading: Parameters<typeof TokenStat>[0]['reading']) {
  return render(
    <TimeFormatContext.Provider value={{ locale: 'en-US', timeZone: 'UTC' }}>
      <TokenStat reading={reading} />
    </TimeFormatContext.Provider>,
  );
}

describe('TokenStat', () => {
  it('shows the gauge with its window and read time, labelled as context in use', () => {
    const { container } = view({ kind: 'context', used: 48_000, window: 200_000, observedAt: OBSERVED });
    expect(screen.getByRole('region', { name: 'Context in use' })).toBeTruthy();
    expect(container.textContent).toContain('48,000 of 200,000 tokens');
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(new Date(OBSERVED).toISOString());
    expect(container.textContent).toContain('not tokens spent, not a total, not XP');
  });

  it('shows a real zero as 0, never as Not collected', () => {
    const { container } = view({ kind: 'context', used: 0, window: 200_000, observedAt: OBSERVED });
    expect(container.textContent).toContain('0 of 200,000 tokens');
    expect(container.textContent).not.toContain('Not collected');
  });

  it('says Not collected with a reason when there is no reading', () => {
    const { container } = view(null);
    expect(container.textContent).toContain('Not collected.');
    expect(container.textContent).toContain(CONTEXT_COPY.notCollectedWhy);
    expect(container.querySelector('dl')).toBeNull();
  });

  it('keeps every string free of the words the program bans', () => {
    const { container } = view({ kind: 'context', used: 1, window: 2, observedAt: OBSERVED });
    expect(container.textContent).not.toMatch(FORBIDDEN);
    expect(Object.values(CONTEXT_COPY).join(' ')).not.toMatch(FORBIDDEN);
    expect(contextWords(1_234, 5_678)).toBe('1,234 of 5,678 tokens');
  });
});
