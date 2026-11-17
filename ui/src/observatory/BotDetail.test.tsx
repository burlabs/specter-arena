import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { attemptsBody, rosterBody } from '@kirocrew/app-sdk';
import { BotDetail } from './BotDetail';
import type { AttemptsState } from './useAttempts';

const roster = rosterBody('two-concurrent');
const [atlas] = roster.items;
if (atlas === undefined) throw new Error('fixture');
const data = attemptsBody('two-concurrent', atlas.bindingId);
if (data === null) throw new Error('fixture');
const ready: AttemptsState = { status: 'ready', data, items: data.items, hasOlder: true, loadingOlder: false, olderFailed: false, failure: null };

function view(attempts: AttemptsState = ready, handlers = { onLoadOlder: vi.fn(), onRetry: vi.fn() }) {
  render(<BotDetail item={atlas as NonNullable<typeof atlas>} collector={roster.collector} rosterRevision={roster.rosterRevision} attempts={attempts} {...handlers} />);
  return handlers;
}

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
});
