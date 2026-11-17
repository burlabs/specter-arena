import { useAppApi } from '@kirocrew/app-sdk';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rosterBody, setFixtureScenario } from '@kirocrew/app-sdk';
import type { ScenarioName } from '@kirocrew/app-sdk';
import { ObservatoryPage } from './ObservatoryPage';
import { WATCHED_KEY, writeWatched } from './watched';

const ATLAS = 'bnd_aaaaaaaaaaaaaaaaaaaa0001';

afterEach(() => vi.restoreAllMocks());

async function open(scenario: ScenarioName = 'default') {
  setFixtureScenario(scenario);
  render(<ObservatoryPage />);
  await screen.findByRole('heading', { level: 1, name: 'Specter Arena' });
  await waitFor(() => expect(screen.queryByText('Loading bots…')).toBeNull());
}

const rowNames = () => {
  const list = screen.queryByRole('list', { name: 'Bots' });
  return list === null ? [] : within(list).getAllByRole('listitem').map((row) => row.querySelector('strong')?.textContent);
};
const selectRow = (name: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));

describe('first load', () => {
  it('shows loading and then every bot sorted by name, with an unnamed bot last', async () => {
    setFixtureScenario('default');
    render(<ObservatoryPage />);
    expect(screen.getByRole('status').textContent).toBe('Loading bots…');
    await screen.findByRole('list', { name: 'Bots' });
    expect(rowNames()).toEqual(['Atlas', 'Brindle', 'Cinder', 'Dune', 'Ember', 'Fenn', 'Unnamed bot']);
    expect(screen.getByText('7 of 7 bots')).toBeTruthy();
  });

  it('opens on All when nothing is watched', async () => {
    await open();
    expect(screen.getByRole('tab', { name: 'All bots' }).getAttribute('aria-selected')).toBe('true');
  });

  it('ties each view tab to one tabpanel labelled by the selected tab', async () => {
    await open();
    const panel = screen.getByRole('tabpanel');
    for (const tab of screen.getAllByRole('tab')) expect(tab.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: 'All bots' }).id);
    fireEvent.click(screen.getByRole('tab', { name: 'Watched' }));
    expect(panel.getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: 'Watched' }).id);
  });

  it('opens on Watched when a watched bot is on the roster, and stays there after a refresh', async () => {
    writeWatched([ATLAS, 'bnd_gone']);
    await open();
    expect(screen.getByRole('tab', { name: 'Watched' }).getAttribute('aria-selected')).toBe('true');
    expect(rowNames()).toEqual(['Atlas']);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    });
    await waitFor(() => expect(screen.getByText('1 of 7 bots')).toBeTruthy());
    expect(screen.getByRole('tab', { name: 'Watched' }).getAttribute('aria-selected')).toBe('true');
    expect(window.localStorage.getItem(WATCHED_KEY)).toBe(JSON.stringify({ v: 1, ids: [ATLAS] }));
  });
});

describe('selection, watching and search', () => {
  it('shows the selected bot, its reason and an announcement', async () => {
    await open();
    expect(screen.getByText('Select a bot to see its condition and why.')).toBeTruthy();
    selectRow('Atlas');
    const detail = screen.getByRole('region', { name: 'Bot detail' });
    expect(within(detail).getByRole('heading', { level: 2, name: 'Atlas' })).toBeTruthy();
    expect(detail.textContent).toContain('Crew reports a turn running');
    expect(screen.getByText('Showing Atlas: Working')).toBeTruthy();
  });

  it('clears the selection and says so when the bot is missing from a complete roster', async () => {
    await open();
    selectRow('Atlas');
    setFixtureScenario('empty');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    });
    await screen.findByText('This bot is no longer on the roster.');
    expect(screen.queryByRole('heading', { level: 2, name: 'Atlas' })).toBeNull();
    setFixtureScenario('default');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    });
    await waitFor(() => expect(rowNames()).toHaveLength(7));
    expect(screen.queryByRole('heading', { level: 2, name: 'Atlas' })).toBeNull();
    selectRow('Atlas');
    expect(screen.getByRole('heading', { level: 2, name: 'Atlas' })).toBeTruthy();
    expect(screen.queryByText('This bot is no longer on the roster.')).toBeNull();
  });

  it('keeps the selection when the bot is missing only from a truncated roster', async () => {
    const [atlas] = rosterBody('default').items;
    if (atlas === undefined) throw new Error('fixture');
    let truncatedLoad = false;
    let page = 0;
    vi.spyOn(useAppApi(), 'get').mockImplementation(() => {
      const items = truncatedLoad ? [{ ...atlas, bindingId: `bnd_page${++page}`, displayName: `Bot ${page}` }] : [atlas];
      const body = { ...rosterBody('default'), items, nextCursor: truncatedLoad ? 'more' : null };
      return Promise.resolve(new Response(JSON.stringify(body)));
    });
    render(<ObservatoryPage />);
    await screen.findByRole('list', { name: 'Bots' });
    selectRow('Atlas');
    truncatedLoad = true;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    });
    await screen.findByText('This bot is no longer on the roster.');
    expect(screen.getByText(/Roster truncated/)).toBeTruthy();
  });

  it('watches a bot, persists only the one key, and switches views with arrows', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Watch Brindle' }));
    expect(Object.keys(window.localStorage)).toEqual([WATCHED_KEY]);
    const allTab = screen.getByRole('tab', { name: 'All bots' });
    allTab.focus();
    fireEvent.keyDown(allTab, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Watched' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Watched' }));
    expect(rowNames()).toEqual(['Brindle']);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'All bots' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'All bots' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'x' });
  });

  it('shows only watched bots and Unwatch all returns to All', async () => {
    writeWatched([ATLAS]);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Unwatch all' }));
    expect(screen.getByRole('tab', { name: 'All bots' }).getAttribute('aria-selected')).toBe('true');
    expect(rowNames()).toHaveLength(7);
    expect(window.localStorage.getItem(WATCHED_KEY)).toBe(JSON.stringify({ v: 1, ids: [] }));
  });

  it('filters by name, matches the placeholder for an unnamed bot, and clears with Escape', async () => {
    await open();
    const search = screen.getByRole('searchbox', { name: 'Search bots by name' });
    fireEvent.change(search, { target: { value: 'tla' } });
    expect(rowNames()).toEqual(['Atlas']);
    fireEvent.change(search, { target: { value: 'unnamed' } });
    expect(rowNames()).toEqual(['Unnamed bot']);
    fireEvent.keyDown(search, { key: 'Escape' });
    expect((search as HTMLInputElement).value).toBe('');
    fireEvent.keyDown(search, { key: 'Escape' });
    fireEvent.keyDown(search, { key: 'a' });
    expect(rowNames()).toHaveLength(7);
  });

  it('focuses the search field on "/" unless typing elsewhere or using a modifier', async () => {
    await open();
    const search = screen.getByRole('searchbox');
    fireEvent.keyDown(document.body, { key: '/', ctrlKey: true });
    expect(document.activeElement).not.toBe(search);
    fireEvent.keyDown(document.body, { key: 'x' });
    expect(document.activeElement).not.toBe(search);
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(search);
    (document.activeElement as HTMLElement).blur();
    const watch = screen.getByRole('button', { name: 'Watch Atlas' });
    watch.focus();
    fireEvent.keyDown(watch, { key: '/' });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: '/' });
    expect(document.activeElement).toBe(search);
  });

  it('shows a no-match state with a clear button', async () => {
    await open();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByRole('heading', { name: 'No bots match' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(rowNames()).toHaveLength(7);
  });

  it('shows a nothing-watched state with a way to see all bots', async () => {
    writeWatched([ATLAS]);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Watch Atlas' }));
    expect(screen.getByRole('heading', { name: 'No bots watched yet' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all bots' }));
    expect(rowNames()).toHaveLength(7);
  });

  it('warns when the browser will not keep the selection', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Watch Atlas' }));
    expect(screen.getByText("Selection won't be remembered in this browser")).toBeTruthy();
  });
});

describe('detail and announcements', () => {
  it('shows the attempts of the selected bot and announces its open attempts', async () => {
    await open('two-concurrent');
    selectRow('Atlas');
    expect(await screen.findByText('Showing Atlas: Working, 2 open attempts')).toBeTruthy();
    const tabs = screen.getByRole('tablist', { name: 'Bot detail sections' });
    expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Attempts', 'Activity', 'Source details']);
    expect(screen.getByRole('list', { name: 'Attempts, newest first' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getByRole('region', { name: 'Last 24 hours' }).textContent).toContain('Sample size3');
  });

  it('resets to the Attempts tab when another bot is selected', async () => {
    await open();
    selectRow('Atlas');
    fireEvent.click(await screen.findByRole('tab', { name: 'Source details' }));
    selectRow('Brindle');
    expect((await screen.findByRole('tab', { name: 'Attempts' })).getAttribute('aria-selected')).toBe('true');
  });

  it('says the bot is gone when its attempts return 404 but keeps the roster', async () => {
    await open('attempt-gone');
    selectRow('Atlas');
    expect((await screen.findAllByText('This bot is no longer on the roster.')).length).toBeGreaterThan(0);
    expect(rowNames()).toHaveLength(7);
  });
});

describe('header, collector and notes', () => {
  it('shows the collector, both notes and a legend with two not-observable states', async () => {
    await open();
    expect(screen.getByText(/Collector is running\./)).toBeTruthy();
    expect(screen.getByText(/Scheduled \(cron\) turns are not observable/)).toBeTruthy();
    expect(screen.getByText('2 bots on Crew have no memory store and cannot be monitored.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /What the states mean/ }));
    expect(screen.getAllByText(/Not observable yet/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /What the states mean/ }));
    expect(screen.queryByText('Blocked')).toBeNull();
  });

  it.each([
    ['paused', 'Collection paused. Nothing new is being recorded.'],
    ['reconnecting', 'Collector is reconnecting to Crew.'],
    ['collector-unavailable', 'Collector unavailable. The backend has not started its collector.'],
  ] as const)('words the %s collector', async (scenario, words) => {
    await open(scenario);
    expect(screen.getByText(new RegExp(words.replace(/[.()]/g, '\\$&')))).toBeTruthy();
  });

  it('never claims the roster is complete, and the empty roster has its own state', async () => {
    await open('empty');
    expect(screen.getByRole('heading', { name: 'No bots are on the roster yet' })).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(/complete/i);
  });

  it('notes a truncated roster at the page cap', async () => {
    const [first] = rosterBody('default').items;
    if (first === undefined) throw new Error('fixture');
    let page = 0;
    vi.spyOn(useAppApi(), 'get').mockImplementation(() => {
      page += 1;
      const body = { ...rosterBody('default'), items: [{ ...first, bindingId: `bnd_page${page}`, displayName: `Bot ${page}` }], nextCursor: 'more' };
      return Promise.resolve(new Response(JSON.stringify(body)));
    });
    render(<ObservatoryPage />);
    await screen.findByText('Roster truncated: showing the first 10 bots. Search narrows only what was loaded.');
  });
});

describe('failures', () => {
  it.each([
    ['offline', 'Could not reach the app backend'],
    ['store-not-ready', 'Collector store is not ready yet'],
    ['expired', 'Session expired'],
  ] as const)('shows the %s error state when the first load fails', async (scenario, title) => {
    setFixtureScenario(scenario);
    render(<ObservatoryPage />);
    expect((await screen.findByRole('alert')).textContent).toContain(title);
    setFixtureScenario('default');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    await screen.findByRole('list', { name: 'Bots' });
  });

  it('keeps the last good list under a banner when a later load fails', async () => {
    await open();
    setFixtureScenario('offline');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    });
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('Showing data from');
    expect(banner.textContent).toContain('Could not reach the app backend');
    expect(rowNames()).toHaveLength(7);
    setFixtureScenario('default');
    await act(async () => {
      fireEvent.click(within(banner).getByRole('button', { name: 'Retry' }));
    });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('what the page never does', () => {
  it('makes no write call across a session', async () => {
    const post = vi.spyOn(useAppApi(), 'post');
    await open();
    selectRow('Atlas');
    fireEvent.click(screen.getByRole('button', { name: 'Watch Atlas' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(post).not.toHaveBeenCalled();
  });

  it('shows XP, level and accepted work as unavailable, with no figure, and no idle, healthy or available label', async () => {
    await open('all-reasons');
    selectRow('Reason not-running');
    const detail = screen.getByRole('region', { name: 'Bot detail' });
    expect(detail.textContent).toContain('Unavailable until accepted-work tracking ships');
    for (const card of detail.querySelectorAll('.sa-card')) expect(card.textContent).not.toMatch(/\d/);
    expect(document.body.textContent ?? '').not.toMatch(/\b(idle|healthy|available)\b/i);
  });
});
