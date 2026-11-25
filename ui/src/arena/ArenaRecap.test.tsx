import { setArenaScenario, setTaskScenario, useAppApi } from '@kirocrew/app-sdk';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RosterItemV1 } from '../contracts/types';
import { rosterBody } from '@kirocrew/app-sdk';
import { ArenaView } from './ArenaView';
import { clearSceneArtCache } from './sceneAssetCache';

const collector = { state: 'running', reasonCode: null, sinceMs: 1 };
const bots: RosterItemV1[] = rosterBody('default').items;
const TUESDAY = new Date(2026, 10, 24, 15, 0, 0);
const MONDAY = new Date(2026, 10, 23, 15, 0, 0);

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};
const run = async (ms: number, step = 50) => {
  for (let elapsed = 0; elapsed < ms; elapsed += step) await act(async () => void (await vi.advanceTimersByTimeAsync(step)));
};
const mount = () => render(<ArenaView bots={bots} complete collector={collector} rosterRevision={1} specters={new Map()} xp={new Map()} />);
const choose = async (name: string) => {
  fireEvent.click(within(screen.getByRole('group', { name: 'Arena view' })).getByRole('button', { name }));
  await flush();
};
const slider = () => screen.getByRole('slider', { name: 'Playback position' }) as HTMLInputElement;

beforeEach(() => {
  clearSceneArtCache();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  vi.setSystemTime(TUESDAY);
  setArenaScenario('arena');
});
afterEach(() => {
  cleanup();
  setArenaScenario(null);
  setTaskScenario(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the mode bar', () => {
  it('offers Live, Today, Yesterday and This week, opens on Live, and the Arena is the live one', async () => {
    mount();
    await flush();
    const group = screen.getByRole('group', { name: 'Arena view' });
    expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(['Live', 'Today', 'Yesterday', 'This week']);
    expect(within(group).getByRole('button', { name: 'Live' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('RECORDED — not live')).toBeNull();
  });

  it('turns the recap choices off with a reason when the backend has no recap route', async () => {
    setTaskScenario('tasks-unsupported');
    mount();
    await flush();
    await choose('Today');
    const group = screen.getByRole('group', { name: 'Arena view' });
    expect(within(group).getByRole('button', { name: 'Live' }).getAttribute('aria-pressed')).toBe('true');
    for (const name of ['Today', 'Yesterday', 'This week']) expect((within(group).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Recaps need a newer app backend/)).toBeTruthy();
  });
});

describe('a recap', () => {
  it('reads one period with two integers, is labelled RECORDED, and says the heroes are as they are today', async () => {
    const get = vi.spyOn(useAppApi(), 'get');
    const post = vi.spyOn(useAppApi(), 'post');
    mount();
    await flush();
    await choose('Today');
    const recapCalls = get.mock.calls.filter(([path]) => String(path).includes('/recap'));
    expect(recapCalls).toHaveLength(1);
    expect(String(recapCalls[0]?.[0])).toMatch(/\/recap\?fromMs=\d+&toMs=\d+$/);
    expect(screen.getAllByText('RECORDED — not live').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Heroes shown as they are today\. Tasks of a minute or more\./)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Arena: Today' })).toBeTruthy();
  });

  it('shows what was recorded: tasks, the recorded XP, and collected and not-collected time in words, never a percent', async () => {
    mount();
    await flush();
    await choose('Today');
    const stats = screen.getByRole('group', { name: 'Recap summary' });
    expect(within(stats).getByText('Tasks seen').nextElementSibling?.textContent).toBe('6');
    expect(within(stats).getByText(/3 credited, 1 not credited, 1 still running|4 credited, 1 not credited, 1 still running/)).toBeTruthy();
    expect(within(stats).getByText('XP credited in this period').nextElementSibling?.textContent).toMatch(/^\d+$/);
    expect(within(stats).getByText('Not collected').nextElementSibling?.textContent).toMatch(/\d+ (s|min|h)/);
    expect(document.body.textContent).not.toMatch(/\d\s?%/);
  });

  it('has a scrub slider with an accessible name and a text value, and Exit to live in the toolbar', async () => {
    mount();
    await flush();
    await choose('Today');
    expect(slider().getAttribute('aria-valuetext')).toMatch(/\d/);
    expect(slider().value).toBe('0');
    const toolbar = screen.getByRole('toolbar', { name: 'Recap controls' });
    expect(within(toolbar).getAllByRole('button').map((button) => button.textContent)).toEqual(['Play', 'Restart', 'Previous event', 'Next event', '0.5x', '1x', '2x', '4x', 'Exit to live']);
  });

  it('opens paused, plays on Play by the clock, pauses, and follows a scrub', async () => {
    mount();
    await flush();
    await choose('Today');
    await run(1_000);
    expect(slider().value).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await run(2_000);
    const playing = Number(slider().value);
    expect(playing).toBeGreaterThan(1_500);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await run(1_000);
    expect(Number(slider().value)).toBe(playing);
    fireEvent.change(slider(), { target: { value: '5000' } });
    expect(slider().value).toBe('5000');
  });

  it('steps to the next and previous event by hand, and shows Not collected when it reaches a pause', async () => {
    mount();
    await flush();
    await choose('Today');
    let seen = false;
    for (let step = 0; step < 40 && !seen; step += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next event' }));
      seen = document.querySelector('.sa-recap-caption--hatched')?.textContent?.includes('Not collected: collection was paused') === true;
    }
    expect(seen).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(slider().value).toBe('0');
    expect(document.querySelector('.sa-recap-caption--hatched')).toBeNull();
  });

  it('celebrates a defeat the playhead walks across, and Exit to live shows no celebration at all', async () => {
    const get = vi.spyOn(useAppApi(), 'get');
    mount();
    await flush();
    await choose('Today');
    fireEvent.click(screen.getByRole('button', { name: '4x' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    let cue = false;
    for (let step = 0; step < 400 && !cue; step += 1) {
      await run(50);
      cue = document.querySelector('[data-cue]') !== null;
    }
    expect(cue).toBe(true);
    const before = get.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Exit to live' }));
    await flush();
    expect(document.querySelector('[data-cue]')).toBeNull();
    expect(screen.queryByText('RECORDED — not live')).toBeNull();
    expect(screen.getByRole('button', { name: 'Live' }).getAttribute('aria-pressed')).toBe('true');
    await run(500);
    expect(document.querySelector('[data-cue]')).toBeNull();
    expect(get.mock.calls.length).toBeGreaterThan(before);
  });

  it('plays nothing after a scrub: a jump celebrates no defeat', async () => {
    mount();
    await flush();
    await choose('Today');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await run(100);
    fireEvent.change(slider(), { target: { value: String(slider().max) } });
    await run(100);
    expect(document.querySelector('[data-cue]')).toBeNull();
  });
});

describe('periods', () => {
  it('says This week started today on a Monday and asks for the same period as Today', async () => {
    vi.setSystemTime(MONDAY);
    const get = vi.spyOn(useAppApi(), 'get');
    mount();
    await flush();
    await choose('Today');
    await choose('This week');
    expect(screen.getByText('This week started today (Monday)')).toBeTruthy();
    const periods = get.mock.calls.map(([path]) => String(path)).filter((path) => path.includes('/recap?'));
    expect(periods).toHaveLength(2);
    expect(new URL(periods[0] as string, 'http://x').searchParams.get('fromMs')).toBe(new URL(periods[1] as string, 'http://x').searchParams.get('fromMs'));
  });

  it('does not say it on another day, and asks for Monday', async () => {
    const get = vi.spyOn(useAppApi(), 'get');
    mount();
    await flush();
    await choose('This week');
    expect(screen.queryByText('This week started today (Monday)')).toBeNull();
    const path = get.mock.calls.map(([call]) => String(call)).find((call) => call.includes('/recap?')) as string;
    const from = Number(new URL(path, 'http://x').searchParams.get('fromMs'));
    expect(new Date(from).getDay()).toBe(1);
    expect(new Date(from).getHours()).toBe(0);
  });

  it('asks for the whole previous day for Yesterday', async () => {
    const get = vi.spyOn(useAppApi(), 'get');
    mount();
    await flush();
    await choose('Yesterday');
    const path = get.mock.calls.map(([call]) => String(call)).find((call) => call.includes('/recap?')) as string;
    const params = new URL(path, 'http://x').searchParams;
    expect(new Date(Number(params.get('toMs'))).getHours()).toBe(0);
    expect(Number(params.get('toMs')) - Number(params.get('fromMs'))).toBeGreaterThanOrEqual(23 * 3_600_000);
    expect(screen.getByRole('heading', { name: 'Arena: Yesterday' })).toBeTruthy();
  });
});

describe('empty and failed recaps', () => {
  it('says there were no tasks yet today, and the slider and playback are off', async () => {
    setArenaScenario('arena-empty');
    mount();
    await flush();
    await choose('Today');
    expect(screen.getByText('No tasks yet today')).toBeTruthy();
    expect(slider().disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says no tasks started while collection was on for another period', async () => {
    setArenaScenario('arena-empty');
    mount();
    await flush();
    await choose('Yesterday');
    expect(screen.getByText('No tasks started while collection was on')).toBeTruthy();
  });

  it.each([
    ['tasks-failure', 'Tasks could not be loaded'],
    ['tasks-offline', 'Could not reach the app backend'],
    ['tasks-expired', 'Not permitted'],
  ] as const)('shows %s as an error with Retry and Exit to live, and no partial recap', async (scenario, title) => {
    setTaskScenario(scenario);
    mount();
    await flush();
    await choose('Today');
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Exit to live' }));
    await flush();
    expect(screen.getByRole('button', { name: 'Live' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('retries a failed read', async () => {
    setTaskScenario('tasks-failure');
    mount();
    await flush();
    await choose('Today');
    setTaskScenario('tasks');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(slider()).toBeTruthy();
  });
});

describe('reduced motion (FP30-R08)', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens paused at the first frame with no Play, offers the event steps, and runs no animation', async () => {
    mount();
    await flush();
    await choose('Today');
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    expect(screen.queryByRole('button', { name: '2x' })).toBeNull();
    await run(3_000);
    expect(slider().value).toBe('0');
    expect(document.querySelector('.sa-is-animated')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next event' }));
    expect(Number(slider().value)).toBeGreaterThan(0);
    fireEvent.change(slider(), { target: { value: '4000' } });
    expect(slider().value).toBe('4000');
    expect(document.querySelector('[data-cue]')).toBeNull();
  });
});

describe('selection, panes and limits', () => {
  it('selects a task from the list and a Specter from the rail, announces both, and folds the panes', async () => {
    mount();
    await flush();
    await choose('Today');
    fireEvent.click(within(screen.getByRole('table', { name: 'Tasks' })).getAllByRole('button')[0]!);
    await flush();
    expect(screen.getAllByRole('status').map((node) => node.textContent).join('|')).toMatch(/Selected /);
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Specters' })).getAllByRole('button')[1]!);
    await flush();
    expect(screen.getAllByRole('status').map((node) => node.textContent).join('|')).toMatch(/Selected /);
    fireEvent.click(screen.getByRole('button', { name: /Hide Specter rail/ }));
    fireEvent.click(screen.getByRole('button', { name: /Hide inspector/ }));
    expect(document.querySelector('.sa-is-rail-collapsed.sa-is-inspector-collapsed')).not.toBeNull();
  });

  it('says how many tasks were left out, how many are not drawn, and how many belong to bots off the roster', async () => {
    const first = bots[0]!;
    const stranger = { ...first, bindingId: 'bnd_' + 'f'.repeat(24) };
    const from = Date.UTC(2026, 10, 24);
    const to = Date.UTC(2026, 10, 24, 15);
    const task = (n: number, bindingId: string) => ({
      contractVersion: 1, taskId: `tsk_${n.toString(16).padStart(24, '0')}`, bindingId, attemptId: `att_${n.toString(16).padStart(24, '0')}`, kind: 'worker', state: 'open',
      attemptState: 'working', closeReason: null, startedAtMs: from + 1_000, endedAtMs: null, closedAtMs: null, updatedAtMs: from + 1_000, runMs: 5_000, sizeClass: 'small', xpCredited: null, policyVersion: 'xp-policy-2',
    });
    const body = {
      contractVersion: 1, asOfMs: to, fromMs: from, toMs: to, taskCap: 1000, truncated: true, omittedCount: 5,
      tasks: [...Array.from({ length: 81 }, (_, index) => task(index + 1, first.bindingId)), task(500, stranger.bindingId)],
      coverage: { firstRunMs: from - 1, purgeHorizonMs: null, spans: [{ fromMs: from, toMs: to, state: 'covered', reason: 'collecting' }] },
    };
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) => Promise.resolve(path.includes('/recap?') ? new Response(JSON.stringify(body)) : new Response('{}', { status: 404 })));
    mount();
    await flush();
    await choose('Yesterday');
    expect(screen.getByText('First 82 tasks of 87')).toBeTruthy();
    expect(screen.getByText('+1 more not drawn')).toBeTruthy();
    expect(screen.getByText(/1 task of bots that are not on the roster counted, not drawn\./)).toBeTruthy();
  });
});
