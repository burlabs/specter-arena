import { setSpecterScenario, useAppApi } from '@kirocrew/app-sdk';
import type { SpecterScenarioName } from '@kirocrew/app-sdk';
import { rosterBody } from '@kirocrew/app-sdk';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RosterItemV1 } from '../contracts/types';
import { clearSceneArtCache } from '../arena/sceneAssetCache';
import { clearAssetCache } from './assetCache';
import { SpectersView } from './SpectersView';
import { useHeroes } from './useHeroes';
import { useSpecters } from './useSpecters';

const bots = rosterBody('default').items;
const onAssign = vi.fn();
const onShowInRoster = vi.fn();

function Harness({ items = bots, pendingCount = 0 }: { items?: readonly RosterItemV1[]; pendingCount?: number }) {
  const specters = useSpecters();
  const heroes = useHeroes();
  return <SpectersView bots={items} specters={specters} heroes={heroes} pendingCount={pendingCount} onAssign={onAssign} onShowInRoster={onShowInRoster} />;
}

function setReducedMotion(reduced: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduced && query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

beforeEach(() => {
  vi.useFakeTimers();
  clearAssetCache();
  clearSceneArtCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  onAssign.mockReset();
  onShowInRoster.mockReset();
});

const flush = async () => {
  for (let index = 0; index < 6; index += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};

async function open(scenario: SpecterScenarioName, props: Parameters<typeof Harness>[0] = {}) {
  setSpecterScenario(scenario);
  render(<Harness {...props} />);
  await flush();
}

const heroNames = () => within(screen.getByRole('radiogroup', { name: 'Heroes' })).getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value);
const stage = () => document.querySelector('.sa-showcase__stage') as HTMLElement;
const animation = () => stage().querySelector('[data-animation]')?.getAttribute('data-animation');

describe('SpectersView states', () => {
  it('says it is loading, then shows the showcase', async () => {
    setSpecterScenario('specters');
    render(<Harness />);
    expect(screen.getByRole('status').textContent).toBe('Loading Specters…');
    await flush();
    expect(screen.getByRole('region', { name: 'Specter showcase' })).toBeTruthy();
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
    expect(screen.getAllByRole('alert')[0]?.textContent).toContain('Could not reach the app backend');
    get.mockRestore();
    setSpecterScenario('specters');
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0] as HTMLElement);
    await flush();
    await act(async () => void (await vi.advanceTimersByTimeAsync(15_000)));
    await flush();
    expect(screen.getByRole('radiogroup', { name: 'Heroes' })).toBeTruthy();
  });

  it('shows the heroes even when no bot is on the roster', async () => {
    await open('specters-none', { items: [] });
    expect(heroNames()).toHaveLength(11);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Vell');
  });

  it('notes that the heroes are loading, and that they failed, without hiding the rest', async () => {
    setSpecterScenario('specters');
    const client = useAppApi();
    const original = client.get.bind(client);
    vi.spyOn(client, 'get').mockImplementation((path: string) => (path.endsWith('/heroes') ? Promise.reject(new TypeError('down')) : original(path)));
    render(<Harness />);
    await flush();
    expect(screen.getByRole('alert').textContent).toContain('The heroes could not be loaded.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

describe('the hero strip and the stage', () => {
  it('lists the 11 heroes with how many bots hold each, and starts on the first hero a bot holds', async () => {
    await open('specters');
    expect(heroNames()).toEqual(['vell', 'stitch', 'reeve', 'rattle', 'ember', 'shard', 'poly', 'tide', 'lume', 'moss', 'bur']);
    const group = within(screen.getByRole('radiogroup', { name: 'Heroes' }));
    expect(group.getByRole('radio', { name: 'Vell held by 1' })).toBeTruthy();
    expect(group.getByRole('radio', { name: 'Tide not held yet' })).toBeTruthy();
    expect((group.getByRole('radio', { name: 'Vell held by 1' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Vell');
  });

  it('starts on Vell when no bot holds a hero', async () => {
    await open('specters-all-unassigned');
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Vell');
  });

  it('follows the first bot in roster order, not the list order of the backend', async () => {
    await open('specters', { items: [...bots].reverse() });
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Poly');
  });

  it('shows the epithet and the personality of the chosen hero, and changes with the choice', async () => {
    await open('specters');
    expect(screen.getByText('The caped one with the golden clasp')).toBeTruthy();
    expect(screen.getByText(/^Calm and a little formal\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /^Stitch/ }));
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Stitch');
    expect(screen.queryByText(/^Calm and a little formal\./)).toBeNull();
  });

  it('draws the chosen hero large and idle, labelled for assistive technology', async () => {
    await open('specters');
    expect(stage().getAttribute('role')).toBe('img');
    expect(stage().getAttribute('aria-label')).toBe('Vell, large preview');
    expect(stage().querySelector('.sa-showcase__zoom')).toBeTruthy();
    expect(animation()).toBe('idle');
  });

  it('plays Attack once, ignores a second press while it plays, then goes back to idle after the hero’s own duration', async () => {
    await open('specters');
    const attack = screen.getByRole('button', { name: 'Attack' });
    fireEvent.click(attack);
    expect(animation()).toBe('attack');
    expect(attack.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Cast' }));
    expect(animation()).toBe('attack');
    await act(async () => void (await vi.advanceTimersByTimeAsync(559)));
    expect(animation()).toBe('attack');
    await act(async () => void (await vi.advanceTimersByTimeAsync(80)));
    expect(animation()).toBe('idle');
    expect(attack.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Cast' }));
    expect(animation()).toBe('cast');
  });

  it('stops a one-shot when another hero is chosen', async () => {
    await open('specters');
    fireEvent.click(screen.getByRole('button', { name: 'Cast' }));
    expect(animation()).toBe('cast');
    fireEvent.click(screen.getByRole('radio', { name: /^Stitch/ }));
    await flush();
    expect(animation()).toBe('idle');
  });

  it('turns Attack and Cast off with a note when reduced motion is requested, and animates nothing', async () => {
    setReducedMotion(true);
    await open('specters');
    for (const name of ['Attack', 'Cast']) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-describedby')).toBe(screen.getByText('Attack and Cast are off because reduced motion is requested.').id);
      fireEvent.click(button);
    }
    expect(animation()).toBe('idle');
    expect(stage().querySelector('.sa-is-static')).toBeTruthy();
  });

  it('says the stage is a preview and shows no bot’s work', async () => {
    await open('specters');
    expect(screen.getByText(/These are previews/)).toBeTruthy();
  });
});

describe('bots with this Specter', () => {
  it('lists the holders behind a disclosure, and opens the Roster on the one clicked', async () => {
    await open('specters');
    const toggle = screen.getByRole('button', { name: 'Bots with this Specter (1)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')?.hasAttribute('hidden')).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Atlas Vell Show in the Roster' }));
    expect(onShowInRoster).toHaveBeenCalledWith(bots[0]?.bindingId);
  });

  it('says so when no bot holds the hero', async () => {
    await open('specters');
    fireEvent.click(screen.getByRole('radio', { name: /^Tide/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Bots with this Specter (0)' }));
    expect(screen.getByText('No bot holds Tide yet.')).toBeTruthy();
  });

  it('closes the list when another hero is chosen', async () => {
    await open('specters');
    fireEvent.click(screen.getByRole('button', { name: 'Bots with this Specter (1)' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Stitch/ }));
    expect(screen.getByRole('button', { name: 'Bots with this Specter (1)' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('counts only bots on the roster, and shows the second holder of a hero with its ordinal', async () => {
    setSpecterScenario('heroes-wrapped');
    render(<Harness items={[...bots]} />);
    await flush();
    fireEvent.click(screen.getByRole('radio', { name: /^Vell/ }));
    expect(screen.getByRole('button', { name: 'Bots with this Specter (1)' })).toBeTruthy();
  });
});

describe('the assign button', () => {
  it('shows how many bots are waiting and reopens the walkthrough', async () => {
    await open('specters-unassigned', { pendingCount: 4 });
    fireEvent.click(screen.getByRole('button', { name: 'Assign Specters (4)' }));
    expect(onAssign).toHaveBeenCalledTimes(1);
  });

  it('is absent when no bot is waiting', async () => {
    await open('specters');
    expect(screen.queryByRole('button', { name: /^Assign Specters/ })).toBeNull();
  });
});

describe('what the tab never does', () => {
  it('makes no write, offers no field, and avoids the words the page forbids', async () => {
    const post = vi.spyOn(useAppApi(), 'post');
    await open('specters');
    fireEvent.click(screen.getByRole('button', { name: 'Attack' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Stitch/ }));
    expect(post).not.toHaveBeenCalled();
    expect(document.querySelectorAll('input[type=text], input[type=search], textarea, select')).toHaveLength(0);
    expect(document.body.textContent ?? '').not.toMatch(/\b(idle|healthy|available)\b/i);
  });
});
