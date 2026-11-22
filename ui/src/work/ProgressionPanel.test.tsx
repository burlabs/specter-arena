import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTaskScenario } from '@kirocrew/app-sdk';
import type { TaskScenarioName } from '@kirocrew/app-sdk';
import type { XpSummaryV1 } from '../contracts/types';
import { ProgressionPanel } from './ProgressionPanel';
import { ATLAS, summaryOf } from './testData';

const flush = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const TOTAL = summaryOf({ totalXp: 150, level: 2, levelFloorXp: 100, nextLevelXp: 250, acceptedWorkCount: 1, creditedTaskCount: 5 });

async function open(scenario: TaskScenarioName, bindingId = ATLAS, name = 'Atlas', total: XpSummaryV1 | null = TOTAL) {
  setTaskScenario(scenario);
  render(<ProgressionPanel bindingId={bindingId} botName={name} total={total} />);
  await flush();
}

describe('ProgressionPanel (PP-1..PP-5)', () => {
  it('lists the ledger entries the history route holds, newest first, with signed amounts and kind words (PP-1)', async () => {
    await open('tasks');
    const entries = within(screen.getByRole('list', { name: 'XP entries, newest first' })).getAllByRole('listitem');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.textContent).toContain('+100 XP');
    expect(entries[0]?.textContent).toContain('Award');
    expect(entries[0]?.textContent).toContain('Reconcile the Q3 invoices');
    expect(entries[0]?.textContent).toContain('Policy xp-policy-1');
  });

  it('takes the total and level from the v2 summary, with its policy and level table, and says what XP reflects (PP-2)', async () => {
    await open('tasks');
    expect(screen.getByText('Policy xp-policy-2 · Level table levels-1')).toBeTruthy();
    expect(screen.getByText(/^Level follows XP credited automatically for tasks/)).toBeTruthy();
    expect(screen.getByText('XP is credited automatically when a task ends cleanly. It reflects observed activity, not verified outcomes.')).toBeTruthy();
    expect(screen.getByText('Level 2 · 150 XP')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: '50 of 150 XP toward level 3' })).toBeTruthy();
  });

  it('falls back to the history summary only for a bot with no v2 summary (PP-3)', async () => {
    await open('tasks', ATLAS, 'Atlas', null);
    expect(screen.getByText('Level 2 · 100 XP')).toBeTruthy();
    expect(screen.getByText('Policy xp-policy-1 · Level table levels-1')).toBeTruthy();
  });

  it('says there are no entries for a bot with none, and still shows Level 1 (PP-4)', async () => {
    await open('tasks-none', ATLAS, 'Atlas', null);
    expect(screen.getByText('No ledger entries to list yet.')).toBeTruthy();
    expect(screen.getByText('Level 1 · 0 XP')).toBeTruthy();
  });

  it('loads older entries on request and shows no duplicates (PP-5)', async () => {
    await open('tasks-many');
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'Load older entries' }));
    await flush();
    expect(screen.getAllByRole('listitem')).toHaveLength(61);
    expect(screen.queryByRole('button', { name: 'Load older entries' })).toBeNull();
  });

  it('says it is loading, then explains an old backend, a failure with Retry, and a departed bot', async () => {
    setTaskScenario('tasks');
    const { unmount } = render(<ProgressionPanel bindingId={ATLAS} botName="Atlas" total={TOTAL} />);
    expect(screen.getByRole('status').textContent).toBe('Loading progression…');
    unmount();
    await open('tasks-unsupported');
    expect(screen.getByText('Progression is not supported here')).toBeTruthy();
    document.body.innerHTML = '';
    await open('tasks-failure');
    expect(screen.getByText('Could not load progression')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    document.body.innerHTML = '';
    await open('tasks', 'bnd_999999999999999999999999', 'Nobody');
    expect(screen.getByRole('status').textContent).toBe('This bot is no longer on the roster.');
  });

  it('reports an older page that fails to load', async () => {
    await open('tasks-many');
    setTaskScenario('tasks-offline');
    fireEvent.click(screen.getByRole('button', { name: 'Load older entries' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('Could not load older entries. Try again.');
  });
});
