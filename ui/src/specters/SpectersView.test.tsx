import { useAppApi } from '@kirocrew/app-sdk';
import { setSpecterScenario } from '@kirocrew/app-sdk';
import type { SpecterScenarioName } from '@kirocrew/app-sdk';
import { rosterBody } from '@kirocrew/app-sdk';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RosterItemV1 } from '../contracts/types';
import { summaryOf } from '../work/testData';
import { clearAssetCache } from './assetCache';
import type { XpState } from '../work/useXp';
import { SpectersView } from './SpectersView';
import { useSpecters } from './useSpecters';

const bots = rosterBody('default').items;
const XP_READY: XpState = { status: 'ready', byBinding: new Map(), failure: null, refresh: () => undefined };

function Harness({ items = bots, complete = true, xp = XP_READY }: { items?: readonly RosterItemV1[]; complete?: boolean; xp?: XpState }) {
  const specters = useSpecters();
  return <SpectersView bots={items} complete={complete} specters={specters} xp={xp} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  clearAssetCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = async () => {
  for (let index = 0; index < 4; index += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};

async function open(scenario: SpecterScenarioName, props: Parameters<typeof Harness>[0] = {}) {
  setSpecterScenario(scenario);
  render(<Harness {...props} />);
  await flush();
}

const list = () => screen.getByRole('list', { name: 'Bots with Specters' });
const rowFor = (name: string) => within(list()).getByRole('button', { name: new RegExp(`^${name}`) });

describe('SpectersView states', () => {
  it('says it is loading, then lists every bot, with No Specter yet while a poll has not caught up', async () => {
    setSpecterScenario('specters-none');
    render(<Harness />);
    expect(screen.getByRole('status').textContent).toBe('Loading Specters…');
    await flush();
    expect(within(list()).getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getAllByText('No Specter yet')).toHaveLength(7);
    expect(screen.getByText('Select a bot to see its Specter.')).toBeTruthy();
  });

  it('shows each bot with its hero name in roster order', async () => {
    await open('specters');
    expect(rowFor('Atlas').textContent).toContain('Vell');
    expect(rowFor('Brindle').textContent).toContain('Stitch');
    expect(rowFor('Cinder').textContent).toContain('Reeve');
    expect(rowFor('Dune').textContent).toContain('Rattle');
    expect(screen.queryByText('No Specter yet')).toBeNull();
  });

  it('explains an old backend instead of showing an error', async () => {
    vi.spyOn(useAppApi(), 'get').mockResolvedValue(new Response('{}', { status: 404 }));
    render(<Harness />);
    await flush();
    expect(screen.getByText('This version of the app backend does not support Specters yet.')).toBeTruthy();
  });

  it('shows an error with Retry for other failures, and Retry reloads', async () => {
    const get = vi.spyOn(useAppApi(), 'get').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Harness />);
    await flush();
    expect(screen.getByRole('alert').textContent).toContain('Could not reach the app backend');
    get.mockRestore();
    setSpecterScenario('specters-none');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(list()).toBeTruthy();
  });

  it('names a server failure differently from being offline', async () => {
    vi.spyOn(useAppApi(), 'get').mockResolvedValue(new Response('{"error":"store_unavailable"}', { status: 503 }));
    render(<Harness />);
    await flush();
    expect(screen.getByRole('alert').textContent).toContain('database is unavailable');
  });

  it('says so when the roster is empty', async () => {
    await open('specters-none', { items: [] });
    expect(screen.getByText('No bots are on the roster yet')).toBeTruthy();
  });

  it('says a selected bot left the roster once the roster is complete', async () => {
    setSpecterScenario('specters-none');
    const view = render(<Harness />);
    await flush();
    fireEvent.click(rowFor('Atlas'));
    view.rerender(<Harness items={bots.slice(1)} />);
    await flush();
    expect(screen.getByRole('status').textContent).toBe('This bot is no longer on the roster.');
  });

  it('keeps asking to select while the roster is still incomplete', async () => {
    setSpecterScenario('specters-none');
    const view = render(<Harness complete={false} />);
    await flush();
    fireEvent.click(rowFor('Atlas'));
    view.rerender(<Harness items={bots.slice(1)} complete={false} />);
    await flush();
    expect(screen.getByText('Select a bot to see its Specter.')).toBeTruthy();
  });
});

describe('SpectersView cards', () => {
  it('shows each hero card with the epithet, the level and the XP of the bot', async () => {
    const atlas = bots[0];
    if (atlas === undefined) throw new Error('no bots');
    const xp: XpState = { ...XP_READY, byBinding: new Map([[atlas.bindingId, summaryOf({ bindingId: atlas.bindingId })]]) };
    await open('specters', { xp });
    const card = rowFor('Atlas');
    expect(card.textContent).toContain('The caped one with the golden clasp');
    expect(within(card).getByText('Level 2')).toBeTruthy();
    expect(within(card).getByText('150 / 250 XP')).toBeTruthy();
    expect(within(rowFor('Brindle')).getByText('Level 1')).toBeTruthy();
    expect(within(rowFor('Brindle')).getByText('0 XP')).toBeTruthy();
  });

  it('shows the progression in the detail panel too', async () => {
    const atlas = bots[0];
    if (atlas === undefined) throw new Error('no bots');
    const xp: XpState = { ...XP_READY, byBinding: new Map([[atlas.bindingId, summaryOf({ bindingId: atlas.bindingId })]]) };
    await open('specters', { xp });
    fireEvent.click(rowFor('Atlas'));
    const detail = screen.getByRole('region', { name: 'Specter detail' });
    expect(within(detail).getByText('Progression')).toBeTruthy();
    expect(within(detail).getByRole('progressbar', { name: '50 of 150 XP toward level 3' })).toBeTruthy();
  });

  it.each([
    ['loading', 'Not loaded yet'],
    ['failed', 'Could not load. It retries automatically.'],
  ] as const)('says XP is %s in words and never shows a zero', async (status, words) => {
    await open('specters', { xp: { ...XP_READY, status, failure: status === 'failed' ? 'unavailable' : null } });
    const card = rowFor('Atlas');
    expect(card.textContent).toContain(words);
    expect(card.textContent).not.toContain('0 XP');
    expect(within(card).queryByRole('progressbar')).toBeNull();
  });

  it('shows the chosen avatar instead of the hero thumbnail once one is picked', async () => {
    await open('specters');
    expect(rowFor('Atlas').querySelector('.sa-portrait--md')).not.toBeNull();
    expect(rowFor('Atlas').querySelector('[data-portrait]')).toBeNull();
    expect(rowFor('Brindle').querySelector('.sa-portrait-wrap [data-portrait]')).not.toBeNull();
  });
});

describe('SpectersView keyboard and selection', () => {
  it('has one tab stop that follows the arrow keys, Home and End', async () => {
    await open('specters');
    const rows = within(list()).getAllByRole('button');
    expect(rows.filter((row) => row.tabIndex === 0)).toHaveLength(1);
    expect(rows[0]?.tabIndex).toBe(0);
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(list(), { key: 'End' });
    expect(document.activeElement).toBe(rows[6]);
    fireEvent.keyDown(list(), { key: 'Home' });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(list(), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[0]);
    const before = document.activeElement;
    fireEvent.keyDown(list(), { key: 'x' });
    expect(document.activeElement).toBe(before);
  });

  it('marks the selected bot and shows its hero in the detail panel', async () => {
    await open('specters');
    fireEvent.click(rowFor('Atlas'));
    expect(rowFor('Atlas').getAttribute('aria-current')).toBe('true');
    const detail = screen.getByRole('region', { name: 'Specter detail' });
    expect(within(detail).getByRole('heading', { level: 2, name: 'Vell' })).toBeTruthy();
    expect(detail.textContent).toContain('The caped one with the golden clasp');
  });

  it('shows the bot name and a check-again prompt for a bot whose hero is not listed yet', async () => {
    await open('specters-none');
    fireEvent.click(rowFor('Dune'));
    const detail = screen.getByRole('region', { name: 'Specter detail' });
    expect(within(detail).getByRole('heading', { level: 2, name: 'Dune' })).toBeTruthy();
    expect(detail.textContent).toContain('has not been given a hero yet');
  });

  it('renders hero text as text, never as markup', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const original = useAppApi().get.bind(useAppApi());
    vi.spyOn(useAppApi(), 'get').mockImplementation(async (path: string) => {
      const response = (await original(path)) as Response;
      if (!path.endsWith('/specters')) return response;
      const body = (await response.json()) as { items: { appearance: string }[] };
      return new Response(JSON.stringify({ ...body, items: body.items.map((item) => ({ ...item, appearance: hostile })) }), { status: 200 });
    });
    await open('specters');
    fireEvent.click(rowFor('Atlas'));
    const detail = screen.getByRole('region', { name: 'Specter detail' });
    expect(detail.textContent).toContain(hostile);
    expect(detail.querySelector('img[onerror]')).toBeNull();
  });
});
