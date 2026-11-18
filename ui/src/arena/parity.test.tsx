import { setArenaScenario } from '@kirocrew/app-sdk';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ObservatoryPage } from '../observatory/ObservatoryPage';

const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

/** FP-10-AC02: the arena list, the roster and the Work tab say the same thing, string for string. */
describe('operational parity', () => {
  it('shows the same bot names and condition words as the roster, and the same state and XP words as the Work tab', async () => {
    setArenaScenario('arena');
    render(<ObservatoryPage />);
    const roster = await screen.findByRole('list', { name: 'Bots' });
    const rosterRows = new Map(
      within(roster)
        .getAllByRole('listitem')
        .map((row) => [row.querySelector('strong')?.textContent ?? '', row.querySelector('.sa-status')?.textContent ?? '']),
    );

    openTab('Work');
    const workList = await screen.findByRole('list', { name: 'Work items' });
    await waitFor(() => expect(within(workList).getAllByRole('listitem').length).toBe(13));
    const workRows = new Map(
      within(workList)
        .getAllByRole('listitem')
        .map((row) => [row.querySelector('.sa-work-row__title')?.textContent ?? '', { state: row.querySelector('.sa-work-badge')?.textContent ?? '', xp: row.querySelector('.sa-work-xp-chip')?.textContent ?? '' }]),
    );

    openTab('Arena');
    const specterTable = await screen.findByRole('table', { name: 'Specters' });
    const arenaBots = within(specterTable)
      .getAllByRole('row')
      .slice(1)
      .map((row) => [within(row).getAllByRole('button')[0]?.textContent ?? '', row.querySelector('.sa-status')?.textContent ?? '']);
    expect(arenaBots).toHaveLength(rosterRows.size);
    for (const [name, condition] of arenaBots) expect(rosterRows.get(name ?? '')).toBe(condition);

    const workTable = screen.getByRole('table', { name: 'Work' });
    const arenaWork = within(workTable)
      .getAllByRole('row')
      .slice(1)
      .map((row) => [within(row).getAllByRole('button')[0]?.textContent ?? '', row.querySelector('.sa-work-badge')?.textContent ?? '', row.querySelectorAll('td')[3]?.textContent ?? '']);
    expect(arenaWork.length).toBeGreaterThan(5);
    for (const [title, state, xp] of arenaWork) {
      const source = workRows.get(title ?? '');
      expect(source, title).toBeDefined();
      expect(state).toBe(source?.state);
      expect(xp).toBe(source?.xp);
    }
  });
});
