import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { rosterBody } from '@kirocrew/app-sdk';
import { BotSummary } from './BotSummary';

const [atlas, , cinder, , ember] = rosterBody('default').items;
if (atlas === undefined || cinder === undefined || ember === undefined) throw new Error('fixture');

describe('BotSummary', () => {
  it('names the bot, its condition and the reason in words', () => {
    render(<BotSummary item={atlas} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Atlas' })).toBeTruthy();
    expect(screen.getByText('Working')).toBeTruthy();
    expect(screen.getByText(/Crew reports a turn running/)).toBeTruthy();
    expect(screen.getByText('Listed by Crew')).toBeTruthy();
    expect(screen.getByText('1 worker unknown')).toBeTruthy();
  });

  it('shows the three unavailable cards with no number', () => {
    render(<BotSummary item={atlas} />);
    for (const title of ['Accepted work', 'XP', 'Level']) {
      const card = screen.getByRole('heading', { name: title }).parentElement;
      expect(card?.textContent).toBe(`${title}Unavailable until accepted-work tracking ships`);
    }
  });

  it('reads coverage state, reason, gaps and a bot never observed', () => {
    const { rerender } = render(<BotSummary item={{ ...atlas, coverage: { state: 'gap', sinceMs: 1_000, reasonCode: 'paused', openGapCount: 2 } }} />);
    expect(screen.getByText(/Gap in collection\. Collection was paused/)).toBeTruthy();
    expect(screen.getByText('2 open gaps')).toBeTruthy();
    rerender(<BotSummary item={{ ...atlas, coverage: { state: 'gap', sinceMs: null, reasonCode: null, openGapCount: 1 } }} />);
    expect(screen.getByText('1 open gap')).toBeTruthy();
    rerender(<BotSummary item={cinder} />);
    expect(screen.getByText(/Collection is running, but this bot's chat has not appeared/)).toBeTruthy();
    expect(screen.getByText('Not recorded')).toBeTruthy();
  });

  it('says a bot Crew no longer lists is absent and falls back on an unknown presence token', () => {
    const { rerender } = render(<BotSummary item={ember} />);
    expect(screen.getByText('No longer listed by Crew')).toBeTruthy();
    rerender(<BotSummary item={{ ...ember, presence: 'odd' as never, coverage: { ...ember.coverage, state: 'odd' as never } }} />);
    expect(screen.getByText('odd')).toBeTruthy();
  });
});
