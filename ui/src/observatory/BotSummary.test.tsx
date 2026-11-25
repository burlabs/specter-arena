import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { rosterBody } from '@kirocrew/app-sdk';
import type { XpSummaryV2 } from '../contracts/types';
import type { XpView } from '../work/useXp';
import { BotSummary } from './BotSummary';

const XP_NONE: XpView = { status: 'ready', summary: null };
const SUMMARY: XpSummaryV2 = {
  contractVersion: 2,
  bindingId: 'bnd_aaaaaaaaaaaaaaaaaaaa0001',
  totalXp: 150,
  level: 2,
  levelTableVersion: 'levels-1',
  levelFloorXp: 100,
  nextLevelXp: 250,
  acceptedWorkCount: 1,
  creditedTaskCount: 4,
  policyVersion: 'xp-policy-2',
};
const card = (title: string) => screen.getByRole('heading', { name: title }).parentElement;

const [atlas, , cinder, , ember] = rosterBody('default').items;
if (atlas === undefined || cinder === undefined || ember === undefined) throw new Error('fixture');

describe('BotSummary', () => {
  it('names the bot, its condition and the reason in words', () => {
    render(<BotSummary item={atlas} xp={XP_NONE} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Atlas' })).toBeTruthy();
    expect(screen.getByText('Working')).toBeTruthy();
    expect(screen.getByText(/Crew reports a turn running/)).toBeTruthy();
    expect(screen.getByText('Listed by Crew')).toBeTruthy();
    expect(screen.getByText('1 worker unknown')).toBeTruthy();
  });

  it('keeps the three cards and shows 0, 0 XP and Level 1 for a bot with no ledger entry (BS-1)', () => {
    render(<BotSummary item={atlas} xp={XP_NONE} />);
    expect(card('Tasks credited')?.textContent).toBe('Tasks credited0');
    expect(card('XP')?.textContent).toBe('XP0 XP');
    expect(card('Level')?.textContent).toContain('Level 1');
    expect(card('Level')?.textContent).toContain('Level follows XP credited automatically for tasks, plus earlier accepted work. It reflects observed activity, not ability, outcome quality or current condition.');
  });

  it('shows the figures, the level meter and the level note from a summary (BS-2, BS-4)', () => {
    render(<BotSummary item={atlas} xp={{ status: 'ready', summary: SUMMARY }} />);
    expect(card('Tasks credited')?.textContent).toBe('Tasks credited4');
    expect(card('XP')?.textContent).toBe('XP150 XP');
    expect(card('Level')?.textContent).toContain('Level 2');
    expect(card('Level')?.textContent).toContain('50 of 150 XP toward level 3');
    expect(screen.getByRole('progressbar', { name: '50 of 150 XP toward level 3' }).getAttribute('aria-valuenow')).toBe('50');
  });

  it('says so in words, never 0, while XP loads or when it fails (BS-3)', () => {
    const { rerender } = render(<BotSummary item={atlas} xp={{ status: 'loading' }} />);
    for (const title of ['Tasks credited', 'XP', 'Level']) expect(card(title)?.textContent).toBe(`${title}Not loaded yet`);
    rerender(<BotSummary item={atlas} xp={{ status: 'failed', failure: 'unsupported' }} />);
    for (const title of ['Tasks credited', 'XP', 'Level']) expect(card(title)?.textContent).toBe(`${title}Not supported by this backend`);
    rerender(<BotSummary item={atlas} xp={{ status: 'failed', failure: 'offline' }} />);
    for (const title of ['Tasks credited', 'XP', 'Level']) expect(card(title)?.textContent).toBe(`${title}Could not load. It retries automatically.`);
  });

  it('puts no condition badge or health word in the level card (BS-5)', () => {
    render(<BotSummary item={atlas} xp={{ status: 'ready', summary: SUMMARY }} />);
    expect(card('Level')?.textContent).not.toMatch(/Working|Settled|health|success/i);
  });

  it('reads coverage state, reason, gaps and a bot never observed', () => {
    const { rerender } = render(<BotSummary item={{ ...atlas, coverage: { state: 'gap', sinceMs: 1_000, reasonCode: 'paused', openGapCount: 2 } }} xp={XP_NONE} />);
    expect(screen.getByText(/Gap in collection\. Collection was paused/)).toBeTruthy();
    expect(screen.getByText('2 open gaps')).toBeTruthy();
    rerender(<BotSummary item={{ ...atlas, coverage: { state: 'gap', sinceMs: null, reasonCode: null, openGapCount: 1 } }} xp={XP_NONE} />);
    expect(screen.getByText('1 open gap')).toBeTruthy();
    rerender(<BotSummary item={cinder} xp={XP_NONE} />);
    expect(screen.getByText(/Collection is running, but this bot's chat has not appeared/)).toBeTruthy();
    expect(screen.getByText('Not recorded')).toBeTruthy();
  });

  it('says a bot Crew no longer lists is absent and falls back on an unknown presence token', () => {
    const { rerender } = render(<BotSummary item={ember} xp={XP_NONE} />);
    expect(screen.getByText('No longer listed by Crew')).toBeTruthy();
    rerender(<BotSummary item={{ ...ember, presence: 'odd' as never, coverage: { ...ember.coverage, state: 'odd' as never } }} xp={XP_NONE} />);
    expect(screen.getByText('odd')).toBeTruthy();
  });
});
