import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { attemptsBody, rosterBody } from '@kirocrew/app-sdk';
import { heroOf } from '../specters/testData';
import type { SpectersState } from '../specters/useSpecters';
import { summaryOf } from '../work/testData';
import type { XpView } from '../work/useXp';
import { BotDetail } from './BotDetail';
import type { AttemptsState } from './useAttempts';

const roster = rosterBody('two-concurrent');
const [atlas] = roster.items;
if (atlas === undefined) throw new Error('fixture');
const data = attemptsBody('two-concurrent', atlas.bindingId);
if (data === null) throw new Error('fixture');
const ready: AttemptsState = { status: 'ready', data, items: data.items, hasOlder: true, loadingOlder: false, olderFailed: false, failure: null };

function view(attempts: AttemptsState = ready, handlers = { onLoadOlder: vi.fn(), onRetry: vi.fn() }) {
  render(<BotDetail item={atlas as NonNullable<typeof atlas>} collector={roster.collector} rosterRevision={roster.rosterRevision} attempts={attempts} xp={XP_NONE} {...NO_SPECTER_PROPS} {...handlers} />);
  return handlers;
}

const XP_NONE: XpView = { status: 'ready', summary: null };
const refresh = vi.fn();
const SPECTERS: SpectersState = { status: 'ready', byBinding: new Map(), unassigned: [], failure: null, refresh, apply: vi.fn(), assign: vi.fn() };
const NO_SPECTER_PROPS = { specter: null, specters: SPECTERS };

const tab = (name: string) => screen.getByRole('tab', { name });

describe('BotDetail', () => {
  it('starts on Attempts inside a labelled, focusable tabpanel', () => {
    view();
    expect(tab('Attempts').getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('tabpanel');
    expect(panel.tabIndex).toBe(0);
    expect(panel.getAttribute('aria-labelledby')).toBe(tab('Attempts').id);
    expect(tab('Activity').getAttribute('aria-controls')).toBe(panel.id);
    expect(screen.getByRole('heading', { level: 2, name: 'Atlas' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('keeps one tab stop and moves with arrows, Home and End, wrapping at the ends', () => {
    view();
    expect(screen.getAllByRole('tab').filter((entry) => entry.tabIndex === 0)).toHaveLength(1);
    fireEvent.keyDown(tab('Attempts'), { key: 'ArrowRight' });
    expect(tab('Activity').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Activity'));
    expect(screen.getByRole('region', { name: 'Last 24 hours' })).toBeTruthy();
    fireEvent.keyDown(tab('Activity'), { key: 'End' });
    expect(tab('Source details').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Roster revision')).toBeTruthy();
    fireEvent.keyDown(tab('Source details'), { key: 'ArrowRight' });
    expect(tab('Attempts').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Attempts'), { key: 'ArrowLeft' });
    expect(tab('Source details').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Source details'), { key: 'Home' });
    expect(tab('Attempts').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Attempts'), { key: 'ArrowLeft' });
    fireEvent.keyDown(tab('Source details'), { key: 'ArrowRight' });
    fireEvent.keyDown(tab('Attempts'), { key: 'x' });
    expect(tab('Attempts').getAttribute('aria-selected')).toBe('true');
  });

  it('passes Load older through', () => {
    const handlers = view();
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    expect(handlers.onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it.each<[AttemptsState, string]>([
    [{ status: 'loading' }, 'Loading attempts…'],
    [{ status: 'gone' }, 'This bot is no longer on the roster.'],
  ])('shows %j on the attempts and activity tabs but still offers source details', (state, text) => {
    view(state);
    expect(screen.getByRole('tabpanel').textContent).toBe(text);
    fireEvent.click(tab('Activity'));
    expect(screen.getByRole('tabpanel').textContent).toBe(text);
    fireEvent.click(tab('Source details'));
    expect(screen.getByText('Roster revision')).toBeTruthy();
    expect(screen.queryByText('24 h window from')).toBeNull();
  });

  it('retries a failed load and renders nothing in the panel while idle', () => {
    const handlers = view({ status: 'failed', failure: 'offline' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(handlers.onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders an empty panel when idle', () => {
    view({ status: 'idle' });
    expect(screen.getByRole('tabpanel').textContent).toBe('');
  });

  it('offers five tabs in order, with Specter between Progression and Source details (BD-1)', () => {
    view();
    expect(within(screen.getByRole('tablist')).getAllByRole('tab').map((entry) => entry.textContent)).toEqual(['Attempts', 'Activity', 'Progression', 'Specter', 'Source details']);
  });

  it('shows the ledger on Progression while attempts are loading or gone (BD-2)', async () => {
    view({ status: 'loading' });
    fireEvent.click(tab('Progression'));
    expect(await screen.findByText('No ledger entries to list yet.')).toBeTruthy();
    expect(screen.getByText('Policy xp-policy-1 · Level table levels-1')).toBeTruthy();
    expect(screen.queryByText('Loading attempts…')).toBeNull();
  });

  it('shows the total and policy of the v2 summary on Progression when the XP read has one (BD-2b)', async () => {
    const summary = summaryOf({ bindingId: atlas?.bindingId, totalXp: 340, level: 4, levelFloorXp: 250, nextLevelXp: 450, creditedTaskCount: 21 });
    render(<BotDetail item={atlas as NonNullable<typeof atlas>} collector={roster.collector} rosterRevision={roster.rosterRevision} attempts={{ status: 'loading' }} xp={{ status: 'ready', summary }} {...NO_SPECTER_PROPS} onLoadOlder={vi.fn()} onRetry={vi.fn()} />);
    fireEvent.click(tab('Progression'));
    expect(await screen.findByText('Level 4 · 340 XP')).toBeTruthy();
    expect(screen.getByText('Policy xp-policy-2 · Level table levels-1')).toBeTruthy();
  });

  it('wraps the arrow keys over five tabs and End still lands on Source details (BD-3)', () => {
    view();
    expect(screen.getAllByRole('tab').map((entry) => entry.textContent)).toEqual(['Attempts', 'Activity', 'Progression', 'Specter', 'Source details']);
    fireEvent.keyDown(tab('Attempts'), { key: 'ArrowRight' });
    fireEvent.keyDown(tab('Activity'), { key: 'ArrowRight' });
    expect(tab('Progression').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Progression'), { key: 'ArrowRight' });
    expect(tab('Specter').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Specter'), { key: 'ArrowRight' });
    expect(tab('Source details').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Source details'), { key: 'ArrowRight' });
    expect(tab('Attempts').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tab('Attempts'), { key: 'End' });
    expect(tab('Source details').getAttribute('aria-selected')).toBe('true');
  });

  it('shows the context reading on the Activity tab only, away from XP', () => {
    view();
    expect(screen.queryByRole('region', { name: 'Context in use' })).toBeNull();
    fireEvent.click(tab('Activity'));
    const gauge = screen.getByRole('region', { name: 'Context in use' });
    expect(gauge.textContent).toContain('Not collected.');
    fireEvent.click(tab('Progression'));
    expect(screen.queryByRole('region', { name: 'Context in use' })).toBeNull();
  });

  it('shows the figure for a v2 item with a reading', () => {
    const item = { ...(atlas as NonNullable<typeof atlas>), contractVersion: 2 as const, tokenReading: { kind: 'context' as const, used: 48_000, window: 200_000, observedAt: 1 } };
    render(<BotDetail item={item} collector={roster.collector} rosterRevision={roster.rosterRevision} attempts={ready} xp={XP_NONE} {...NO_SPECTER_PROPS} onLoadOlder={vi.fn()} onRetry={vi.fn()} />);
    fireEvent.click(tab('Activity'));
    expect(screen.getByRole('region', { name: 'Context in use' }).textContent).toMatch(/48,000 of 200,000 tokens/);
  });

  it('shows the hero, its note and the progression on the Specter tab, and the avatar button', () => {
    const summary = summaryOf({ bindingId: atlas?.bindingId, totalXp: 40, level: 2, levelFloorXp: 30, nextLevelXp: 100 });
    render(<BotDetail item={atlas as NonNullable<typeof atlas>} collector={roster.collector} rosterRevision={roster.rosterRevision} attempts={ready} xp={{ status: 'ready', summary }} specter={heroOf({ bindingId: atlas?.bindingId ?? '' })} specters={SPECTERS} onLoadOlder={vi.fn()} onRetry={vi.fn()} />);
    fireEvent.click(tab('Specter'));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('heading', { level: 2, name: 'Vell' })).toBeTruthy();
    expect(panel.textContent).toContain('This hero was assigned to the bot.');
    expect(panel.textContent).toContain('Level 2');
    expect(within(panel).getByRole('button', { name: 'Change avatar' })).toBeTruthy();
  });

  it('says the XP could not be read, never 0, when the ledger is loading or failed', () => {
    for (const xp of [{ status: 'loading' } as const, { status: 'failed', failure: 'offline' } as const]) {
      const { unmount } = render(<BotDetail item={atlas as NonNullable<typeof atlas>} collector={roster.collector} rosterRevision={roster.rosterRevision} attempts={ready} xp={xp} specter={heroOf()} specters={SPECTERS} onLoadOlder={vi.fn()} onRetry={vi.fn()} />);
      fireEvent.click(tab('Specter'));
      expect(screen.getByRole('tabpanel').textContent).not.toContain('0 XP');
      unmount();
    }
  });

  it('offers Assign on the Specter tab of a bot with no hero, and Check again when the page does not know', () => {
    const onAssign = vi.fn();
    const { unmount } = render(<BotDetail item={atlas as NonNullable<typeof atlas>} collector={roster.collector} rosterRevision={roster.rosterRevision} attempts={ready} xp={XP_NONE} {...NO_SPECTER_PROPS} onAssign={onAssign} onLoadOlder={vi.fn()} onRetry={vi.fn()} />);
    fireEvent.click(tab('Specter'));
    expect(screen.getByRole('heading', { level: 2, name: 'No Specter yet' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Assign a Specter' }));
    expect(onAssign).toHaveBeenCalledTimes(1);
    unmount();
    view();
    fireEvent.click(tab('Specter'));
    expect(screen.queryByRole('button', { name: 'Assign a Specter' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(refresh).toHaveBeenCalled();
  });
});
