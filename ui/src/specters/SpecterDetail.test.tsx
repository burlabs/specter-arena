import { rosterBody, setSpecterScenario, useAppApi } from '@kirocrew/app-sdk';
import type { SpecterScenarioName } from '@kirocrew/app-sdk';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAssetCache } from './assetCache';
import type { XpState } from '../work/useXp';
import { SpectersView } from './SpectersView';
import { useSpecters } from './useSpecters';

const bots = rosterBody('default').items;
const XP_READY: XpState = { status: 'ready', byBinding: new Map(), failure: null, refresh: () => undefined };


function Harness() {
  const specters = useSpecters();
  return <SpectersView bots={bots} complete specters={specters} xp={XP_READY} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  clearAssetCache();
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = async () => {
  for (let index = 0; index < 4; index += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};

async function open(scenario: SpecterScenarioName, bot: string) {
  setSpecterScenario(scenario);
  render(<Harness />);
  await flush();
  fireEvent.click(within(screen.getByRole('list', { name: 'Specter collection' })).getByRole('button', { name: new RegExp(`^${bot}`) }));
  await flush();
}

const detail = () => screen.getByRole('region', { name: 'Specter detail' });
const heading = () => within(detail()).getByRole('heading', { level: 2 });
const button = (name: string) => within(detail()).getByRole('button', { name });

describe('hero card', () => {
  it('shows the display name, epithet, personality and appearance read-only', async () => {
    await open('specters', 'Atlas');
    expect(heading().textContent).toBe('Vell');
    expect(detail().textContent).toContain('The caped one with the golden clasp');
    expect(detail().textContent).toContain('Calm and a little formal.');
    expect(detail().textContent).toContain('Pale lavender');
    expect(within(detail()).getByText('Bot')).toBeTruthy();
    expect(detail().textContent).toContain('This hero came with the bot when it first appeared');
    expect(detail().querySelectorAll('input[type=text], textarea')).toHaveLength(0);
  });

  it('offers exactly one write: change avatar', async () => {
    await open('specters', 'Atlas');
    const names = within(detail()).getAllByRole('button').map((element) => element.textContent);
    expect(names).toEqual(['Change avatar']);
    for (const gone of [/summon/i, /reroll/i, /rename/i, /archive/i, /by hand/i]) expect(detail().textContent).not.toMatch(gone);
  });

  it('shows the roman ordinal as sent for a second-round hero', async () => {
    setSpecterScenario('heroes-wrapped');
    const more = [...bots];
    const wrapped = (await ((await useAppApi().get('/apps/specter-arena/api/specters')) as Response).json()) as { items: { displayName: string }[] };
    expect(wrapped.items[11]?.displayName).toBe('Vell II');
    expect(more.length).toBeGreaterThan(0);
  });

  it('renders the pending state with Check again when no hero is listed yet', async () => {
    await open('specters-none', 'Atlas');
    expect(heading().textContent).toBe('Atlas');
    expect(detail().textContent).toContain('has not been given a hero yet');
    const get = vi.spyOn(useAppApi(), 'get');
    fireEvent.click(button('Check again'));
    await flush();
    expect(get).toHaveBeenCalled();
  });
});

describe('avatar picker', () => {
  it('lists the eleven bundled portraits and a hero-portrait choice, and applies one with the record version', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(button('Change avatar'));
    await flush();
    const group = within(detail()).getByRole('radiogroup', { name: 'Portraits' });
    expect(within(group).getAllByRole('radio')).toHaveLength(12);
    expect((within(group).getByRole('radio', { name: /Use the hero portrait/ }) as HTMLInputElement).checked).toBe(true);
    expect((within(detail()).getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
    const post = vi.spyOn(useAppApi(), 'post');
    fireEvent.click(within(group).getByRole('radio', { name: /Tide portrait/ }));
    fireEvent.click(within(detail()).getByRole('button', { name: 'Apply' }));
    await flush();
    expect(post).toHaveBeenCalledWith(expect.stringMatching(/\/specters\/bnd_[0-9a-f_a]+\/portrait$/), expect.objectContaining({ expectedVersion: 0, assetId: expect.stringMatching(/^ast_/) }));
    expect(heading().textContent).toBe('Vell');
    expect(document.activeElement).toBe(heading());
    expect(within(detail()).queryByRole('radiogroup')).toBeNull();
  });

  it('resets to the hero portrait by sending a null asset id', async () => {
    await open('specters', 'Brindle');
    fireEvent.click(button('Change avatar'));
    await flush();
    const group = within(detail()).getByRole('radiogroup', { name: 'Portraits' });
    expect((within(group).getByRole('radio', { name: /Use the hero portrait/ }) as HTMLInputElement).checked).toBe(false);
    const post = vi.spyOn(useAppApi(), 'post');
    fireEvent.click(within(group).getByRole('radio', { name: /Use the hero portrait/ }));
    fireEvent.click(within(detail()).getByRole('button', { name: 'Apply' }));
    await flush();
    expect(post).toHaveBeenCalledWith(expect.stringMatching(/\/portrait$/), { expectedVersion: 1, assetId: null });
    expect(heading().textContent).toBe('Stitch');
  });

  it('reloads and says so when the avatar changed somewhere else', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(button('Change avatar'));
    await flush();
    fireEvent.click(within(detail()).getByRole('radio', { name: /Tide portrait/ }));
    vi.spyOn(useAppApi(), 'post').mockResolvedValueOnce(new Response('{"error":"version_conflict"}', { status: 409 }));
    fireEvent.click(within(detail()).getByRole('button', { name: 'Apply' }));
    await flush();
    expect(within(detail()).getByRole('alert').textContent).toContain('changed somewhere else');
    expect(heading().textContent).toBe('Vell');
  });

  it('reports a write that failed with no code', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(button('Change avatar'));
    await flush();
    fireEvent.click(within(detail()).getByRole('radio', { name: /Tide portrait/ }));
    vi.spyOn(useAppApi(), 'post').mockResolvedValueOnce(new Response('oops', { status: 500 }));
    fireEvent.click(within(detail()).getByRole('button', { name: 'Apply' }));
    await flush();
    expect(within(detail()).getByRole('alert').textContent).toContain('http_500');
  });

  it('reports an offline write', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(button('Change avatar'));
    await flush();
    fireEvent.click(within(detail()).getByRole('radio', { name: /Tide portrait/ }));
    vi.spyOn(useAppApi(), 'post').mockRejectedValueOnce(new TypeError('down'));
    fireEvent.click(within(detail()).getByRole('button', { name: 'Apply' }));
    await flush();
    expect(within(detail()).getByRole('alert').textContent).toContain('Could not reach the app backend');
  });

  it('closes with Cancel and returns focus to the heading', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(button('Change avatar'));
    await flush();
    fireEvent.click(within(detail()).getByRole('button', { name: 'Cancel' }));
    expect(within(detail()).queryByRole('radiogroup')).toBeNull();
    expect(document.activeElement).toBe(heading());
  });

  it('says so when the gallery cannot load', async () => {
    await open('specters', 'Atlas');
    vi.spyOn(useAppApi(), 'get').mockRejectedValue(new Error('down'));
    fireEvent.click(button('Change avatar'));
    await flush();
    expect(within(detail()).getByText('Portraits could not be loaded.')).toBeTruthy();
  });

  it('treats a gallery body of the wrong shape as empty', async () => {
    await open('specters', 'Atlas');
    vi.spyOn(useAppApi(), 'get').mockResolvedValue({ ok: true });
    fireEvent.click(button('Change avatar'));
    await flush();
    expect(within(detail()).getAllByRole('radio')).toHaveLength(1);
  });
});
