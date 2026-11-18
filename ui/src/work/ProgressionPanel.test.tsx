import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setWorkScenario } from '@kirocrew/app-sdk';
import type { WorkScenarioName } from '@kirocrew/app-sdk';
import { ProgressionPanel } from './ProgressionPanel';
import { ATLAS, BRINDLE } from './testData';
import { flush } from './testHarness';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function open(scenario: WorkScenarioName, bindingId = ATLAS, name = 'Atlas') {
  setWorkScenario(scenario);
  render(<ProgressionPanel bindingId={bindingId} botName={name} />);
  await flush();
}

describe('ProgressionPanel (PP-1..PP-5)', () => {
  it('lists entries newest first with signed amounts and kind words (PP-1)', async () => {
    await open('work');
    const entries = within(screen.getByRole('list', { name: 'XP entries, newest first' })).getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    expect(entries[0]?.textContent).toContain('+100 XP');
    expect(entries[0]?.textContent).toContain('Award');
    expect(entries[1]?.textContent).toContain('+50 XP');
    expect(entries[1]?.textContent).toContain('Reconcile the Q3 invoices');
  });

  it('shows the policy version, the level-table version and the level sentence (PP-2)', async () => {
    await open('work');
    expect(screen.getByText('Policy xp-policy-1 · Level table levels-1')).toBeTruthy();
    expect(screen.getByText('Level reflects accepted work, not ability or current condition.')).toBeTruthy();
    expect(screen.getByText('Level 2 · 150 XP from accepted work')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: '50 of 150 XP toward level 3' })).toBeTruthy();
  });

  it('shows the correction after a reopen next to the awards (PP-3)', async () => {
    await open('work', BRINDLE, 'Brindle');
    const entries = within(screen.getByRole('list', { name: 'XP entries, newest first' })).getAllByRole('listitem');
    expect(entries.map((entry) => entry.querySelector('strong')?.textContent)).toEqual(['-100 XP', '+100 XP', '+50 XP']);
    expect(entries[0]?.textContent).toContain('Correction (reopened)');
  });

  it('says there are no entries for a bot with none, and still shows Level 1 (PP-4)', async () => {
    await open('work-none');
    expect(screen.getByText('No XP entries yet. XP comes only from work you accept.')).toBeTruthy();
    expect(screen.getByText('Level 1 · 0 XP from accepted work')).toBeTruthy();
  });

  it('loads older entries on request and shows no duplicates (PP-5)', async () => {
    await open('work-many');
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'Load older entries' }));
    await flush();
    expect(screen.getAllByRole('listitem')).toHaveLength(60);
    expect(screen.queryByRole('button', { name: 'Load older entries' })).toBeNull();
  });

  it('says it is loading, then explains an old backend, a failure with Retry, and a departed bot', async () => {
    setWorkScenario('work');
    const { unmount } = render(<ProgressionPanel bindingId={ATLAS} botName="Atlas" />);
    expect(screen.getByRole('status').textContent).toBe('Loading progression…');
    unmount();
    await open('work-unsupported');
    expect(screen.getByText('Progression is not supported here')).toBeTruthy();
    document.body.innerHTML = '';
    await open('work-failure');
    expect(screen.getByText('Could not load progression')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    document.body.innerHTML = '';
    await open('work', 'bnd_999999999999999999999999', 'Nobody');
    expect(screen.getByRole('status').textContent).toBe('This bot is no longer on the roster.');
  });

  it('reports an older page that fails to load', async () => {
    await open('work-many');
    setWorkScenario('work-offline');
    fireEvent.click(screen.getByRole('button', { name: 'Load older entries' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('Could not load older entries. Try again.');
  });
});
