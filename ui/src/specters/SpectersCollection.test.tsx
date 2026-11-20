import { useAppApi } from '@kirocrew/app-sdk';
import { setSpecterScenario } from '@kirocrew/app-sdk';
import type { SpecterScenarioName } from '@kirocrew/app-sdk';
import { rosterBody } from '@kirocrew/app-sdk';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { summaryOf } from '../work/testData';
import { clearAssetCache } from './assetCache';
import type { XpState } from '../work/useXp';
import { SpectersView } from './SpectersView';
import { useSpecters } from './useSpecters';

const bots = rosterBody('default').items;
const XP_READY: XpState = { status: 'ready', byBinding: new Map(), failure: null, refresh: () => undefined };

function Harness({ xp = XP_READY }: { xp?: XpState }) {
  const specters = useSpecters();
  return <SpectersView bots={bots} complete specters={specters} xp={xp} />;
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

async function open(scenario: SpecterScenarioName, xp?: XpState) {
  setSpecterScenario(scenario);
  render(<Harness xp={xp} />);
  await flush();
}

const list = () => screen.getByRole('list', { name: 'Specter collection' });
const names = () => within(list()).getAllByRole('listitem').map((item) => item.querySelector('strong')?.textContent);
const search = () => screen.getByRole('searchbox', { name: 'Search Specters' });
const filter = () => screen.getByRole('combobox', { name: 'Filter' });
const sort = () => screen.getByRole('combobox', { name: 'Sort' });
const count = () => document.querySelector('.sa-collection-count')?.textContent;
const type = (value: string) => fireEvent.change(search(), { target: { value } });
const choose = (control: HTMLElement, value: string) => fireEvent.change(control, { target: { value } });

describe('Specters collection', () => {
  it('lists the seven bot cards and the four heroes no bot holds, with a count', async () => {
    await open('specters');
    expect(names()).toEqual(['Atlas', 'Brindle', 'Cinder', 'Dune', 'Ember', 'Unnamed bot', 'Fenn', 'Tide', 'Lume', 'Moss', 'bur']);
    expect(count()).toBe('Showing 11 of 11');
    const heroCard = within(list()).getByText('Tide').closest('li');
    expect(heroCard?.querySelector('button')).toBeNull();
    expect(heroCard?.textContent).toContain('No bot yet');
    expect(heroCard?.getAttribute('data-hero-id')).toBe('tide');
  });

  it('has the controls in tab order before the cards, as native elements with labels', async () => {
    await open('specters');
    const order = [...document.querySelectorAll('input, select, button')].filter((element) => (element as HTMLElement).tabIndex >= 0);
    expect(order.slice(0, 3)).toEqual([search(), filter(), sort()]);
    expect(search().getAttribute('type')).toBe('search');
    expect(within(filter()).getAllByRole('option').map((option) => option.textContent)).toEqual(['All', 'Assigned', 'Unassigned', 'Avatar changed']);
    expect(within(sort()).getAllByRole('option').map((option) => option.textContent)).toEqual(['Roster order', 'Name', 'Level', 'XP']);
    expect((filter() as HTMLSelectElement).value).toBe('all');
    expect((sort() as HTMLSelectElement).value).toBe('roster');
  });

  it('searches hero name, epithet and bot name, trimmed and ignoring case', async () => {
    await open('specters');
    type('  VELL ');
    expect(names()).toEqual(['Atlas']);
    expect(count()).toBe('Showing 1 of 11');
    type('hooded');
    expect(names()).toEqual(['Cinder']);
    type('brindle');
    expect(names()).toEqual(['Brindle']);
    type('slow waves');
    expect(names()).toEqual(['Tide']);
  });

  it('filters, and an unassigned or avatar filter never shows the wrong kind of card', async () => {
    await open('specters');
    choose(filter(), 'unassigned');
    expect(names()).toEqual(['Tide', 'Lume', 'Moss', 'bur']);
    expect(within(list()).queryAllByRole('button')).toHaveLength(0);
    choose(filter(), 'assigned');
    expect(within(list()).getAllByRole('button')).toHaveLength(7);
    expect(within(list()).queryByText('No bot yet')).toBeNull();
    choose(filter(), 'avatar');
    expect(names()).toEqual(['Brindle']);
  });

  it('sorts by name, level and XP', async () => {
    const xp: XpState = {
      ...XP_READY,
      byBinding: new Map([
        [bots[0]?.bindingId ?? '', summaryOf({ bindingId: bots[0]?.bindingId ?? '', level: 2, totalXp: 150 })],
        [bots[2]?.bindingId ?? '', summaryOf({ bindingId: bots[2]?.bindingId ?? '', level: 4, totalXp: 700, levelFloorXp: 700, nextLevelXp: 1000 })],
      ]),
    };
    await open('specters', xp);
    choose(sort(), 'name');
    expect(names().slice(0, 4)).toEqual(['bur', 'Ember', 'Lume', 'Moss']);
    choose(sort(), 'level');
    expect(names().slice(0, 3)).toEqual(['Cinder', 'Atlas', 'Brindle']);
    choose(sort(), 'xp');
    expect(names().slice(0, 3)).toEqual(['Cinder', 'Atlas', 'Brindle']);
    expect(names().slice(-4)).toEqual(['Tide', 'Lume', 'Moss', 'bur']);
  });

  it('keeps roster order and says so while XP is loading', async () => {
    await open('specters', { ...XP_READY, status: 'loading' });
    choose(sort(), 'xp');
    expect(names().slice(0, 3)).toEqual(['Atlas', 'Brindle', 'Cinder']);
    expect(count()).toContain('Level and XP order wait for XP to load. Showing roster order.');
    expect(document.querySelector('.sa-collection-count')?.getAttribute('aria-live')).toBe('polite');
  });

  it('offers Clear search and filters when nothing matches, and clearing restores every card and focuses the search', async () => {
    await open('specters');
    type('zzz');
    expect(screen.getByText('No Specters match')).toBeTruthy();
    expect(count()).toBe('Showing 0 of 11');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(names()).toHaveLength(11);
    expect(document.activeElement).toBe(search());
    expect((filter() as HTMLSelectElement).value).toBe('all');
  });

  it('clears the search with Escape', async () => {
    await open('specters');
    type('vell');
    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(names()).toHaveLength(11);
  });

  it('says every hero has a bot when the 13 bots hold all 11', async () => {
    setSpecterScenario('heroes-wrapped');
    render(<Harness />);
    await flush();
    choose(filter(), 'unassigned');
    expect(screen.getByText('Every hero has a bot')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear search and filters' })).toBeNull();
  });

  it('says no Specters match, not that every hero has a bot, when a search finds nothing under Unassigned', async () => {
    setSpecterScenario('heroes-wrapped');
    render(<Harness />);
    await flush();
    choose(filter(), 'unassigned');
    type('zzz');
    expect(screen.getByText('No Specters match')).toBeTruthy();
    expect(screen.queryByText('Every hero has a bot')).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear search and filters' })).toBeTruthy();
  });

  it('keeps arrow keys, Home and End on the visible bot cards only', async () => {
    await open('specters');
    choose(filter(), 'assigned');
    type('n');
    const visible = within(list()).getAllByRole('button');
    expect(visible.map((row) => row.querySelector('strong')?.textContent)).toEqual(['Atlas', 'Brindle', 'Cinder', 'Dune', 'Unnamed bot', 'Fenn']);
    expect(visible.filter((row) => row.tabIndex === 0)).toHaveLength(1);
    fireEvent.keyDown(list(), { key: 'End' });
    expect(document.activeElement).toBe(visible[5]);
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(visible[5]);
    fireEvent.keyDown(list(), { key: 'Home' });
    expect(document.activeElement).toBe(visible[0]);
  });

  it('moves the single tab stop to the first visible card when the roving card is filtered out', async () => {
    await open('specters');
    fireEvent.focus(within(list()).getByRole('button', { name: /^Dune/ }));
    type('cinder');
    expect(within(list()).getByRole('button', { name: /^Cinder/ }).tabIndex).toBe(0);
  });

  it('keeps the detail panel on a bot that a filter hides, and hides no state', async () => {
    await open('specters');
    fireEvent.click(within(list()).getByRole('button', { name: /^Atlas/ }));
    choose(filter(), 'unassigned');
    const detail = screen.getByRole('region', { name: 'Specter detail' });
    expect(within(detail).getByRole('heading', { level: 2, name: 'Vell' })).toBeTruthy();
    expect(screen.queryByText('This bot is no longer on the roster.')).toBeNull();
    choose(filter(), 'all');
    expect(within(list()).getByRole('button', { name: /^Atlas/ }).getAttribute('aria-current')).toBe('true');
  });

  it('makes no write request for any control', async () => {
    await open('specters');
    const post = vi.spyOn(useAppApi(), 'post');
    type('v');
    choose(filter(), 'avatar');
    choose(sort(), 'name');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }) ?? search());
    expect(post).not.toHaveBeenCalled();
  });

  it('shows words and a retry in place of the hero cards when heroes fail, and never hides a bot card', async () => {
    setSpecterScenario('specters');
    const original = useAppApi().get.bind(useAppApi());
    const get = vi.spyOn(useAppApi(), 'get').mockImplementation(async (path: string) => {
      if (path.endsWith('/heroes')) throw new TypeError('Failed to fetch');
      return original(path);
    });
    render(<Harness />);
    await flush();
    expect(names()).toEqual(['Atlas', 'Brindle', 'Cinder', 'Dune', 'Ember', 'Unnamed bot', 'Fenn']);
    const note = screen.getByRole('alert');
    expect(note.textContent).toContain('Heroes without a bot could not be loaded. Bot cards are not affected.');
    choose(filter(), 'assigned');
    expect(screen.queryByRole('alert')).toBeNull();
    choose(filter(), 'all');
    get.mockImplementation(original);
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
    await flush();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(names()).toHaveLength(11);
  });

  it('says an older backend cannot list heroes, without a retry, and keeps the bot cards', async () => {
    setSpecterScenario('specters');
    const original = useAppApi().get.bind(useAppApi());
    vi.spyOn(useAppApi(), 'get').mockImplementation(async (path: string) => (path.endsWith('/heroes') ? new Response('{}', { status: 404 }) : original(path)));
    render(<Harness />);
    await flush();
    expect(names()).toHaveLength(7);
    expect(screen.getByRole('alert').textContent).toBe('This version of the app backend cannot list heroes without a bot yet. Bot cards are not affected.');
    expect(within(screen.getByRole('alert')).queryByRole('button')).toBeNull();
  });
});
