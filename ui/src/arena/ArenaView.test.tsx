import { setArenaScenario, useAppApi } from '@kirocrew/app-sdk';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RosterItemV1 } from '../contracts/types';
import { rosterBody } from '@kirocrew/app-sdk';
import { clearSceneArtCache } from './sceneAssetCache';
import { ArenaView } from './ArenaView';
import { MARKS } from './marks';
import { botOf, specterOf, xpOf } from './testData';

const collector = { state: 'running', reasonCode: null, sinceMs: 1 };
const bots: RosterItemV1[] = rosterBody('default').items;

beforeEach(() => clearSceneArtCache());
afterEach(() => {
  setArenaScenario(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function view(props: { bots?: RosterItemV1[]; complete?: boolean } = {}) {
  return render(<ArenaView bots={props.bots ?? bots} complete={props.complete ?? true} collector={collector} rosterRevision={1} specters={new Map()} xp={new Map()} onLedgerChanged={vi.fn()} />);
}

const settle = () => screen.findByRole('group', { name: 'Arena map' });

describe('ready', () => {
  it('labels the arena FIXTURE twice (header and list) and never LIVE', async () => {
    setArenaScenario('arena');
    view();
    await settle();
    expect(screen.getAllByText('FIXTURE — demo data, not Crew activity')).toHaveLength(2);
    expect(screen.queryByText('LIVE')).toBeNull();
    expect(document.body.textContent?.toLowerCase()).not.toContain('waiting on you');
    expect(document.body.textContent).not.toMatch(/\d\s?%/);
  });

  it('shows as-of time, collector words, and a coverage line that says gaps and unknown bots', async () => {
    setArenaScenario('arena');
    view();
    await settle();
    expect(screen.getByText(/^Coverage: \d+ bots? (has|have) a collection gap, \d+ bots? (is|are) unknown$/)).toBeTruthy();
    expect(screen.getByText(/^As of/)).toBeTruthy();
  });

  it('shows the stat cards from the roster and the ledger, and a collapsed bots-on-the-field list', async () => {
    setArenaScenario('arena');
    const first = bots[0];
    const second = bots[1];
    if (first === undefined || second === undefined) throw new Error('no bots');
    const xp = new Map([
      [first.bindingId, xpOf(first, 120, 2)],
      [second.bindingId, xpOf(second, 30, 1)],
    ]);
    render(<ArenaView bots={bots} complete collector={collector} rosterRevision={1} specters={new Map()} xp={xp} onLedgerChanged={vi.fn()} />);
    await settle();
    const stats = screen.getByRole('group', { name: 'Arena summary' });
    expect(within(stats).getByText('Bots observed').nextElementSibling?.textContent).toBe(String(bots.length));
    expect(within(stats).getByText('Committed XP').nextElementSibling?.textContent).toBe('150');
    expect(document.querySelector('details.sa-bots-on-field')?.hasAttribute('open')).toBe(false);
    expect(within(screen.getByRole('complementary', { name: 'Specters' })).getByText('120 XP')).toBeTruthy();
  });

  it('says so when the roster is partial', async () => {
    setArenaScenario('arena');
    view({ complete: false });
    await settle();
    expect(screen.getByText(/roster is partial/)).toBeTruthy();
  });

  it('announces a selection from the scene, the rail and the list', async () => {
    setArenaScenario('arena');
    view();
    await settle();
    const live = () => screen.getAllByRole('status').map((node) => node.textContent).join('|');
    fireEvent.click(within(screen.getByRole('table', { name: 'Work' })).getAllByRole('button')[0]!);
    await waitFor(() => expect(live()).toMatch(/Selected /));
    const inspector = screen.getByRole('complementary', { name: 'Encounter inspector' });
    expect(await within(inspector).findByRole('heading', { level: 2 })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Specters' })).getAllByRole('button')[1]!);
    expect(await within(inspector).findByText(/Open work/)).toBeTruthy();
    expect(live()).toMatch(/open attempts?/);
  });

  it('makes no write for any interaction', async () => {
    setArenaScenario('arena');
    const post = vi.spyOn(useAppApi(), 'post');
    view();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause animation' }));
    for (const button of screen.getAllByRole('button').slice(0, 30)) fireEvent.click(button);
    fireEvent(window, new Event('resize'));
    fireEvent(window, new Event('focus'));
    expect(post).not.toHaveBeenCalled();
  });

  it('shows the no-longer-available fallback when the selected bot leaves the roster', async () => {
    setArenaScenario('arena');
    const { rerender } = view();
    await settle();
    fireEvent.click(within(screen.getByRole('table', { name: 'Specters' })).getAllByRole('button')[0]!);
    rerender(<ArenaView bots={bots.slice(1)} complete collector={collector} rosterRevision={1} specters={new Map()} xp={new Map()} onLedgerChanged={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'This item is no longer available' })).toBeTruthy();
  });
});

describe('states', () => {
  it('is loading first', () => {
    setArenaScenario('arena');
    view();
    expect(screen.getByText('Loading the arena…')).toBeTruthy();
  });

  it('says there are no bots on an empty complete roster, and still reads work', async () => {
    setArenaScenario('arena-empty');
    view({ bots: [] });
    expect(await screen.findByText('No bots are on the roster yet')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Arena map' })).toBeNull();
  });

  it('draws an empty field when the roster has bots and no work', async () => {
    setArenaScenario('arena-empty');
    view({ bots: [botOf(1)] });
    await settle();
    expect(screen.getByRole('table', { name: 'Work' })).toBeTruthy();
  });

  it.each([
    ['not supported', new Response('{}', { status: 404 }), 'Work is not available on this backend', false],
    ['not permitted', new Response('{}', { status: 403 }), 'Not permitted', true],
    ['offline', null, 'Could not reach the app backend', true],
    ['an error', new Response('{}', { status: 500 }), 'Work could not be loaded', true],
    ['an unknown body', new Response('{"a":1}'), 'Work answered in a form this page does not know', true],
  ])('shows %s', async (_name, response, title, retry) => {
    setArenaScenario('arena');
    vi.spyOn(useAppApi(), 'get').mockImplementation(() => (response === null ? Promise.reject(new TypeError('x')) : Promise.resolve(response.clone())));
    view();
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' }) !== null).toBe(retry);
  });

  it('keeps the last snapshot with a stale banner when a later poll fails, and retries', async () => {
    setArenaScenario('arena');
    vi.useFakeTimers();
    const real = useAppApi().get.bind(useAppApi());
    let down = false;
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) => (down && path.includes('/work') ? Promise.resolve(new Response('{}', { status: 500 })) : real(path)));
    view();
    for (let i = 0; i < 12; i += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(screen.getByRole('group', { name: 'Arena map' })).toBeTruthy();
    down = true;
    await act(async () => void (await vi.advanceTimersByTimeAsync(15_000)));
    for (let i = 0; i < 12; i += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toMatch(/Showing data from .*Work could not be loaded/);
    expect(screen.getByRole('group', { name: 'Arena map' })).toBeTruthy();
    down = false;
    fireEvent.click(within(banner).getByRole('button', { name: 'Retry' }));
    for (let i = 0; i < 12; i += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('polls only while mounted', async () => {
    setArenaScenario('arena');
    vi.useFakeTimers();
    const get = vi.spyOn(useAppApi(), 'get');
    const { unmount } = view();
    for (let i = 0; i < 12; i += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    unmount();
    const calls = get.mock.calls.length;
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
    expect(get.mock.calls.length).toBe(calls);
  });
});

describe('performance marks', () => {
  it('marks data-ready and first-render once, and an update pair on a later poll', async () => {
    setArenaScenario('arena');
    vi.useFakeTimers();
    const mark = vi.spyOn(performance, 'mark');
    view();
    for (let i = 0; i < 12; i += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(mark.mock.calls.map(([name]) => name)).toEqual([MARKS.dataReady, MARKS.firstRender]);
    await act(async () => void (await vi.advanceTimersByTimeAsync(15_000)));
    for (let i = 0; i < 12; i += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(mark.mock.calls.map(([name]) => name)).toEqual([MARKS.dataReady, MARKS.firstRender, MARKS.updateStart, MARKS.updateEnd]);
  });
});

describe('with Specters', () => {
  it('names a Specter and its bot', async () => {
    setArenaScenario('arena');
    render(<ArenaView bots={bots} complete collector={collector} rosterRevision={1} specters={new Map([[bots[0]!.bindingId, specterOf(bots[0]!, 'Vesper')]])} xp={new Map()} onLedgerChanged={vi.fn()} />);
    await settle();
    expect(screen.getByRole('button', { name: /^Vesper for Atlas/ })).toBeTruthy();
  });
});

describe('celebrations', () => {
  const inspector = () => screen.getByRole('complementary', { name: 'Encounter inspector' });

  it('plays nothing on first load, even though accepted items are already on the field', async () => {
    setArenaScenario('arena');
    const { container } = view();
    await settle();
    expect(container.querySelectorAll('[data-cue]')).toHaveLength(0);
    expect(container.querySelectorAll('.sa-is-defeat')).toHaveLength(0);
    expect(screen.getAllByText('Defeated').length).toBeGreaterThan(0);
  });

  it('plays exactly one cue with the committed XP when an item the user was watching is accepted, and none after a remount', async () => {
    setArenaScenario('arena');
    const first = view();
    await settle();
    fireEvent.click(within(screen.getByRole('table', { name: 'Work' })).getByRole('button', { name: /^Migrate the nightly report/ }));
    await within(inspector()).findByRole('heading', { level: 2, name: 'Migrate the nightly report' });
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Accept…' }));
    fireEvent.click(await within(inspector()).findByRole('checkbox', { name: /I reviewed the evidence above/ }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Accept work' }));
    await waitFor(() => expect(first.container.querySelectorAll('[data-cue]')).toHaveLength(1));
    const cue = first.container.querySelector('[data-cue]');
    expect(cue?.textContent).toMatch(/Outcome accepted/);
    expect(cue?.textContent).toMatch(/Migrate the nightly report · \+\d+ XP/);
    expect(first.container.querySelectorAll('.sa-minion.sa-is-defeat')).toHaveLength(1);

    first.unmount();
    const again = view();
    await settle();
    expect(again.container.querySelectorAll('[data-cue]')).toHaveLength(0);
    expect(screen.getAllByText('Defeated').length).toBeGreaterThan(0);
  });
});
