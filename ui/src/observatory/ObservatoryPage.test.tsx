import { useAppApi } from '@kirocrew/app-sdk';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rosterBody, setFixtureScenario, setSpecterScenario, setTaskScenario } from '@kirocrew/app-sdk';
import type { ScenarioName } from '@kirocrew/app-sdk';
import { ObservatoryPage } from './ObservatoryPage';
import { WATCHED_KEY, writeWatched } from './watched';

const ATLAS = 'bnd_aaaaaaaaaaaaaaaaaaaa0001';

afterEach(() => vi.restoreAllMocks());

const rosterResponse = () => new Response(JSON.stringify(rosterBody('default')));

async function open(scenario: ScenarioName = 'default') {
  setFixtureScenario(scenario);
  render(<ObservatoryPage />);
  await screen.findByRole('heading', { level: 1, name: 'Specter Arena' });
  await waitFor(() => expect(screen.queryByText('Loading bots…')).toBeNull());
  showRoster();
}

/** The page opens on the Arena, so tests of the roster move to its tab first. */
function showRoster() {
  fireEvent.click(within(screen.getByRole('tablist', { name: 'Sections' })).getByRole('tab', { name: 'Roster' }));
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
    await screen.findByRole('heading', { level: 1, name: 'Specter Arena' });
    showRoster();
    await screen.findByRole('list', { name: 'Bots' });
    expect(rowNames()).toEqual(['Atlas', 'Brindle', 'Cinder', 'Dune', 'Ember', 'Fenn', 'Unnamed bot']);
    expect(screen.getByText('7 of 7 bots')).toBeTruthy();
  });

  it('shows the roster summary above the list, counted over every bot and not only the visible ones', async () => {
    await open();
    const summary = within(screen.getByRole('group', { name: 'Roster summary' }));
    expect(summary.getByText('Tracked bots').nextElementSibling?.textContent).toBe('7');
    expect(summary.getByText('Working now').nextElementSibling?.textContent).toMatch(/^\d+$/);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search bots by name' }), { target: { value: 'Atl' } });
    expect(screen.getByText('1 of 7 bots')).toBeTruthy();
    expect(summary.getByText('Tracked bots').nextElementSibling?.textContent).toBe('7');
  });

  it('opens on All when nothing is watched', async () => {
    await open();
    expect(screen.getByRole('tab', { name: 'All bots' }).getAttribute('aria-selected')).toBe('true');
  });

  it('ties each view tab to one tabpanel labelled by the selected tab', async () => {
    await open();
    const panel = screen.getByRole('tabpanel', { name: 'All bots' });
    const views = within(screen.getByRole('tablist', { name: 'Which bots to show' }));
    for (const tab of views.getAllByRole('tab')) expect(tab.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(views.getByRole('tab', { name: 'All bots' }).id);
    fireEvent.click(views.getByRole('tab', { name: 'Watched' }));
    expect(panel.getAttribute('aria-labelledby')).toBe(views.getByRole('tab', { name: 'Watched' }).id);
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
    await screen.findByRole('heading', { level: 1, name: 'Specter Arena' });
    showRoster();
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
    expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Attempts', 'Activity', 'Progression', 'Source details']);
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
  it('shows the collector, both notes and a legend with one not-observable state', async () => {
    await open();
    expect(screen.getByText(/Collector is running\./)).toBeTruthy();
    expect(screen.getByText(/Scheduled \(cron\) turns are not observable/)).toBeTruthy();
    expect(screen.getByText('2 bots on Crew have no memory store and cannot be monitored.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /What the states mean/ }));
    expect(screen.getAllByText(/Not observable yet/)).toHaveLength(1);
    expect(screen.getByText(/Crew's approval or question flag is set/)).toBeTruthy();
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
    await screen.findByRole('heading', { level: 1, name: 'Specter Arena' });
    showRoster();
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

  it('shows XP, level and credited tasks from both ledgers, with no idle, healthy or available label', async () => {
    setTaskScenario('tasks');
    await open();
    selectRow('Atlas');
    const detail = await screen.findByRole('region', { name: 'Bot detail' });
    await waitFor(() => expect(detail.textContent).toContain('115 XP'));
    const card = (title: string) => within(detail).getByRole('heading', { name: title }).parentElement;
    expect(card('Tasks credited')?.textContent).toBe('Tasks credited1');
    expect(card('XP')?.textContent).toBe('XP115 XP');
    expect(card('Level')?.textContent).toContain('Level 2');
    expect(card('Level')?.textContent).toContain('15 of 150 XP toward level 3');
    expect(document.body.textContent ?? '').not.toMatch(/\b(idle|healthy|available)\b/i);
  });

  it('shows 0 XP and Level 1 for a bot with no ledger entry', async () => {
    await open();
    selectRow('Atlas');
    const detail = await screen.findByRole('region', { name: 'Bot detail' });
    await waitFor(() => expect(detail.textContent).toContain('0 XP'));
    expect(detail.textContent).toContain('Level 1');
  });

  it('keeps the roster usable and never shows 0 when XP cannot be loaded', async () => {
    setTaskScenario('tasks-failure');
    await open();
    selectRow('Atlas');
    expect(rowNames()).toContain('Atlas');
    const detail = await screen.findByRole('region', { name: 'Bot detail' });
    await waitFor(() => expect(detail.textContent).toContain('Could not load. It retries automatically.'));
    expect(within(detail).getByRole('heading', { name: 'XP' }).parentElement?.textContent).not.toMatch(/\d/);
  });

  it('says XP is not supported by an older backend', async () => {
    setTaskScenario('tasks-unsupported');
    await open();
    selectRow('Atlas');
    const detail = await screen.findByRole('region', { name: 'Bot detail' });
    await waitFor(() => expect(detail.textContent).toContain('Not supported by this backend'));
  });

  it('leaves the XP card unchanged when a Specter is renamed, because XP is keyed by binding', async () => {
    setTaskScenario('tasks');
    setSpecterScenario('specters');
    await open();
    selectRow('Atlas');
    const detail = await screen.findByRole('region', { name: 'Bot detail' });
    await waitFor(() => expect(detail.textContent).toContain('115 XP'));
    await useAppApi().post('/apps/specter-arena/api/specters/bnd_aaaaaaaaaaaaaaaaaaaa0001/name', { expectedVersion: 1, name: 'Renamed', epithet: null });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(detail.textContent).toContain('115 XP'));
  });
});

describe('sections', () => {
  const sections = () => within(screen.getByRole('tablist', { name: 'Sections' }));
  const rosterTab = () => sections().getByRole('tab', { name: 'Roster' });
  const specterTab = () => sections().getByRole('tab', { name: 'Specters' });

  const arenaTab = () => sections().getByRole('tab', { name: 'Arena' });

  it('offers Arena, Roster, Specters and Data with the Arena selected on load, and no Work tab', async () => {
    setFixtureScenario('default');
    render(<ObservatoryPage />);
    await screen.findByRole('heading', { level: 1, name: 'Specter Arena' });
    await waitFor(() => expect(screen.queryByText('Loading bots…')).toBeNull());
    expect(sections().getAllByRole('tab').map((entry) => entry.textContent)).toEqual(['Arena', 'Roster', 'Specters', 'Data']);
    expect(screen.queryByRole('tab', { name: 'Work' })).toBeNull();
    expect(arenaTab().getAttribute('aria-selected')).toBe('true');
    expect(rosterTab().getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tabpanel', { name: 'Arena' }).id).toBe(arenaTab().getAttribute('aria-controls'));
  });

  it('moves between sections with the arrow, Home and End keys', async () => {
    await open();
    fireEvent.keyDown(rosterTab(), { key: 'ArrowRight' });
    expect(specterTab().getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(specterTab(), { key: 'Home' });
    expect(arenaTab().getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(arenaTab(), { key: 'End' });
    expect(sections().getByRole('tab', { name: 'Data' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(sections().getByRole('tab', { name: 'Data' }), { key: 'ArrowLeft' });
    expect(specterTab().getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(specterTab(), { key: 'ArrowLeft' });
    expect(rosterTab().getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(rosterTab(), { key: 'ArrowLeft' });
    expect(arenaTab().getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(arenaTab(), { key: 'ArrowLeft' });
    expect(sections().getByRole('tab', { name: 'Data' }).getAttribute('aria-selected')).toBe('true');
  });

  it('opens on the Arena, which polls from mount with its mode badge and scoped style, and stops polling once left', async () => {
    const get = vi.spyOn(useAppApi(), 'get');
    setFixtureScenario('default');
    render(<ObservatoryPage />);
    expect(await screen.findByRole('group', { name: 'Arena map' })).toBeTruthy();
    expect(document.head.querySelectorAll('style[data-specter-arena-scene]')).toHaveLength(1);
    expect(screen.getAllByText('FIXTURE — demo data, not Crew activity').length).toBeGreaterThan(0);
    expect(get.mock.calls.filter(([path]) => String(path).includes('/tasks?state=open')).length).toBeGreaterThan(0);
    fireEvent.click(rosterTab());
    expect(screen.queryByRole('group', { name: 'Arena map' })).toBeNull();
    const after = get.mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(get.mock.calls.slice(after).filter(([path]) => String(path).includes('/tasks?'))).toHaveLength(0);
  });

  it('gives the Arena one visit seed that survives a tab switch', async () => {
    await open();
    fireEvent.click(arenaTab());
    await screen.findByRole('group', { name: 'Arena map' });
    const lefts = () => [...document.querySelectorAll<HTMLElement>('[data-sprite="specter"]')].map((node) => `${node.style.left},${node.style.top}`);
    await waitFor(() => expect(lefts().length).toBeGreaterThan(0));
    const first = lefts();
    fireEvent.click(rosterTab());
    fireEvent.click(arenaTab());
    await screen.findByRole('group', { name: 'Arena map' });
    await waitFor(() => expect(lefts()).toEqual(first));
  });

  it('opens the Data tab as the fifth section with its scoped style, and polls Data only once it is opened', async () => {
    await open();
    const get = vi.spyOn(useAppApi(), 'get');
    expect(get.mock.calls.filter(([path]) => String(path).endsWith('/data'))).toHaveLength(0);
    expect(document.head.querySelectorAll('style[data-specter-arena-data]')).toHaveLength(1);
    fireEvent.click(sections().getByRole('tab', { name: 'Data' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Collection' })).toBeTruthy();
    expect(document.querySelector('[data-mode="FIXTURE"]')).toBeTruthy();
    expect(get.mock.calls.filter(([path]) => String(path).endsWith('/data')).length).toBeGreaterThan(0);
    fireEvent.click(rosterTab());
    expect(screen.queryByRole('heading', { level: 3, name: 'Collection' })).toBeNull();
  });

  it('shows the Specters panel and hides the roster, then restores it unchanged', async () => {
    await open();
    selectRow('Atlas');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'atl' } });
    fireEvent.click(specterTab());
    expect(screen.getByRole('tabpanel', { name: 'Specters' })).toBeTruthy();
    expect(await screen.findByRole('list', { name: 'Specter collection' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Bots' })).toBeNull();
    fireEvent.click(rosterTab());
    expect(screen.queryByRole('list', { name: 'Specter collection' })).toBeNull();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('atl');
    expect(screen.getByRole('heading', { level: 2, name: 'Atlas' })).toBeTruthy();
  });

  it('leaves the slash key alone while the Specters section is open', async () => {
    await open();
    fireEvent.click(specterTab());
    expect(fireEvent.keyDown(document.body, { key: '/' })).toBe(true);
    fireEvent.click(rosterTab());
    expect(fireEvent.keyDown(document.body, { key: '/' })).toBe(false);
  });
});

describe('Specters in the roster rows', () => {
  it('shows a portrait or token and the hero name beside the bot, and keeps the row name stable', async () => {
    setSpecterScenario('specters');
    await open();
    await waitFor(() => expect(screen.getByText(/Specter: Vell$/)).toBeTruthy());
    expect(screen.getByText(/Specter: Stitch$/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Atlas/ })).toBeTruthy();
    expect(rowNames()).toEqual(['Atlas', 'Brindle', 'Cinder', 'Dune', 'Ember', 'Fenn', 'Unnamed bot']);
    await waitFor(() => expect(document.querySelectorAll('.sa-row img.sa-portrait__img')).toHaveLength(7));
    const sources = [...document.querySelectorAll('.sa-row img.sa-portrait__img')].map((image) => image.getAttribute('src'));
    expect(new Set(sources).size).toBe(7);
  });

  it('keeps the roster rows when Specters fail to load', async () => {
    setSpecterScenario('specters');
    const get = vi.spyOn(useAppApi(), 'get');
    get.mockImplementation(async (path: string) => {
      if (path.includes('/specters')) throw new TypeError('down');
      return rosterResponse();
    });
    await open();
    expect(rowNames()).toHaveLength(7);
    expect(screen.queryByText(/Specter:/)).toBeNull();
  });

  it('opens the Specters tab with the bot list and its own style element', async () => {
    setSpecterScenario('specters');
    await open();
    expect(document.head.querySelectorAll('style[data-specter-arena]')).toHaveLength(1);
    expect(document.head.querySelectorAll('style[data-specter-arena-specters]')).toHaveLength(1);
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Sections' })).getByRole('tab', { name: 'Specters' }));
    expect(await screen.findByRole('list', { name: 'Specter collection' })).toBeTruthy();
  });
});
