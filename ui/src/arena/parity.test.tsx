import { setArenaScenario } from '@kirocrew/app-sdk';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ObservatoryPage } from '../observatory/ObservatoryPage';

const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

/** FP-10-AC02: the arena list and the roster say the same thing about a bot, string for string; the XP words agree across tabs. */
describe('operational parity', () => {
  it('shows the same bot names and condition words as the roster, and the same XP as the bot detail', async () => {
    setArenaScenario('arena');
    render(<ObservatoryPage />);
    const roster = await screen.findByRole('list', { name: 'Bots' });
    const rosterRows = new Map(
      within(roster)
        .getAllByRole('listitem')
        .map((row) => [row.querySelector('strong')?.textContent ?? '', row.querySelector('.sa-status')?.textContent ?? '']),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Atlas/ }));
    const detail = await screen.findByRole('region', { name: 'Bot detail' });
    await waitFor(() => expect(detail.textContent).toContain('115 XP'));

    openTab('Arena');
    const specterTable = await screen.findByRole('table', { name: 'Specters' });
    const arenaRows = within(specterTable).getAllByRole('row').slice(1);
    const arenaBots = arenaRows.map((row) => [within(row).getAllByRole('button')[0]?.textContent ?? '', row.querySelector('.sa-status')?.textContent ?? '']);
    expect(arenaBots).toHaveLength(rosterRows.size);
    for (const [name, condition] of arenaBots) expect(rosterRows.get(name ?? '')).toBe(condition);
    const atlas = arenaRows.find((row) => within(row).queryByRole('button', { name: 'Atlas' }) !== null);
    await waitFor(() => expect(atlas?.querySelectorAll('td')[2]?.textContent).toBe('Lv. 2 · 115 XP'));
  });

  it('words each task the same in the list, the inspector and the screen-reader line', async () => {
    setArenaScenario('arena');
    render(<ObservatoryPage />);
    await screen.findByRole('list', { name: 'Bots' });
    openTab('Arena');
    const taskTable = await screen.findByRole('table', { name: 'Tasks' });
    const rows = within(taskTable).getAllByRole('row').slice(1);
    expect(rows.length).toBeGreaterThan(5);
    const states = new Set(rows.map((row) => row.querySelector('.sa-work-badge')?.textContent));
    expect(states).toEqual(new Set(['Open', 'Credited', 'Not credited']));
    for (const row of rows) {
      const state = row.querySelector('.sa-work-badge')?.textContent;
      const close = row.querySelectorAll('td')[0]?.textContent ?? '';
      if (state === 'Credited') expect(close).toContain('Auto-credited when the task ended cleanly.');
      if (state === 'Not credited') expect(close).toMatch(/Not credited: /);
      if (state === 'Open') expect(close).toMatch(/Open: /);
      const size = row.querySelectorAll('td')[1]?.textContent ?? '';
      expect(size).toMatch(/^(Small|Medium|Large) · \d+ (s|min|h)/);
    }
    fireEvent.click(within(rows[0]!).getAllByRole('button')[0]!);
    const inspector = screen.getByRole('complementary', { name: 'Encounter inspector' });
    const facts = await within(inspector).findByRole('region', { name: 'Task evidence' });
    expect(facts.textContent).toContain(rows[0]?.querySelectorAll('td')[1]?.textContent?.split(' · ')[0] ?? 'x');
  });
});
