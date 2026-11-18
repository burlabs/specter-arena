import { rosterBody, setSpecterScenario, useAppApi } from '@kirocrew/app-sdk';
import type { SpecterScenarioName } from '@kirocrew/app-sdk';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAssetCache } from './assetCache';
import { SpectersView } from './SpectersView';
import { useSpecters } from './useSpecters';

const bots = rosterBody('default').items;

function Harness() {
  const specters = useSpecters();
  return <SpectersView bots={bots} complete specters={specters} />;
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
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

async function open(scenario: SpecterScenarioName, bot: string) {
  setSpecterScenario(scenario);
  render(<Harness />);
  await flush();
  fireEvent.click(within(screen.getByRole('list', { name: 'Bots with Specters' })).getByRole('button', { name: new RegExp(`^${bot}`) }));
  await flush();
}

const detail = () => screen.getByRole('region', { name: 'Specter detail' });
const heading = () => within(detail()).getByRole('heading', { level: 2 });
const button = (name: string) => within(detail()).getByRole('button', { name });
const renameForm = () => within(detail()).getByRole('form', { name: 'Rename' });
const summon = () => fireEvent.click(button(/^(Summon a Specter|Reroll)$/ as unknown as string));
const toReady = async () => {
  await advance(1500);
  await advance(1500);
};

describe('summoning', () => {
  it('summons, shows progress, then a candidate, and accepting moves focus to the new heading', async () => {
    await open('specters-empty', 'Atlas');
    expect(screen.getByText(/Daily limits apply/)).toBeTruthy();
    fireEvent.change(within(detail()).getByLabelText(/^What is this bot for/), { target: { value: 'keeps the books' } });
    summon();
    await flush();
    expect(screen.getByText('Waiting to start')).toBeTruthy();
    expect(button('Cancel summoning')).toBeTruthy();
    await advance(1500);
    expect(screen.getByText('Summoning in progress')).toBeTruthy();
    await advance(1500);
    expect(screen.getByText('A candidate is ready to review')).toBeTruthy();
    expect(within(detail()).getByRole('heading', { level: 3, name: 'Lanternwick' })).toBeTruthy();
    expect(screen.getByText('4 of 5 left today for this bot. 19 of 20 left today across all bots.')).toBeTruthy();
    fireEvent.click(button('Accept this Specter'));
    await flush();
    expect(heading().textContent).toBe('Lanternwick');
    expect(document.activeElement).toBe(heading());
    expect(screen.getByText('Placeholder token, not a portrait')).toBeTruthy();
    const row = within(screen.getByRole('list', { name: 'Bots with Specters' })).getByRole('button', { name: /^Atlas/ });
    expect(row.textContent).toContain('Lanternwick');
  });

  it('keeps chosen fields on a reroll', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(within(detail()).getByLabelText('Name'));
    fireEvent.click(button('Reroll'));
    await flush();
    await toReady();
    expect(within(detail()).getByRole('heading', { level: 3, name: 'Vesper' })).toBeTruthy();
    fireEvent.click(within(detail()).getByLabelText('Name'));
  });

  it('can switch a kept field off again, and warns when another Specter has the candidate name', async () => {
    await open('specters', 'Dune');
    expect(within(detail()).queryByLabelText('Name')).toBeNull();
    fireEvent.click(button('Summon a Specter'));
    await flush();
    await toReady();
    fireEvent.click(button('Discard'));
    await flush();
    expect(within(detail()).queryByText(/A candidate is ready/)).toBeNull();
  });

  it('shows another Specter already using the name as a note', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(button('Rename'));
    fireEvent.change(within(renameForm()).getByLabelText(/^Name/), { target: { value: 'Lanternwick' } });
    fireEvent.click(within(renameForm()).getByRole('button', { name: 'Save' }));
    await flush();
    fireEvent.click(within(screen.getByRole('list', { name: 'Bots with Specters' })).getByRole('button', { name: /^Brindle/ }));
    await flush();
    fireEvent.click(button('Reroll'));
    await flush();
    await toReady();
    expect(screen.getByText('Another Specter already has this name. You can still accept it or rename it.')).toBeTruthy();
  });

  it('cancels a running summoning', async () => {
    await open('specters-empty', 'Atlas');
    summon();
    await flush();
    await advance(1500);
    fireEvent.click(button('Cancel summoning'));
    await flush();
    expect(screen.getByText('Cancelled')).toBeTruthy();
    await advance(5000);
    expect(screen.queryByText('A candidate is ready to review')).toBeNull();
  });

  it('shows a failed summoning with its cause and leaves the existing Specter alone', async () => {
    await open('summon-failure', 'Atlas');
    fireEvent.click(button('Reroll'));
    await flush();
    await toReady();
    expect(screen.getByText('The summoning did not finish')).toBeTruthy();
    expect(screen.getByText('Crew did not answer in time.')).toBeTruthy();
    expect(heading().textContent).toBe('Vesper');
  });

  it('names the cause when generation is unavailable, while other actions still work', async () => {
    await open('specters-empty', 'Atlas');
    vi.spyOn(useAppApi(), 'post').mockRejectedValueOnce(new Error('x'));
    summon();
    await flush();
    expect(screen.getByText(/Could not reach the app backend/)).toBeTruthy();
    vi.spyOn(useAppApi(), 'post').mockResolvedValueOnce(new Response('{"error":"generation_unavailable"}', { status: 503 }));
    summon();
    await flush();
    expect(screen.getByText(/granted chat access in Crew/)).toBeTruthy();
    expect(button('Write one by hand')).toBeTruthy();
  });

  it('reloads and keeps the stored Specter when accept hits a version conflict', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(button('Reroll'));
    await flush();
    await toReady();
    const post = vi.spyOn(useAppApi(), 'post');
    post.mockResolvedValueOnce(new Response('{"error":"version_conflict"}', { status: 409 }));
    fireEvent.click(button('Accept this Specter'));
    await flush();
    expect(screen.getByText(/changed somewhere else/)).toBeTruthy();
    expect(heading().textContent).toBe('Vesper');
  });

  it('offers Check again after the backend stops answering', async () => {
    await open('specters-empty', 'Atlas');
    summon();
    await flush();
    vi.spyOn(useAppApi(), 'get').mockRejectedValue(new TypeError('down'));
    await advance(1500 * 3);
    expect(screen.getByText(/Could not reach the app backend. The summoning may still finish./)).toBeTruthy();
    vi.restoreAllMocks();
    fireEvent.click(button('Check again'));
    await flush();
    expect(screen.queryByText(/The summoning may still finish/)).toBeNull();
  });
});

describe('rename', () => {
  it('focuses the name field, saves, and moves focus to the heading', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(button('Rename'));
    const name = within(renameForm()).getByLabelText(/^Name/);
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: 'Vesperine' } });
    fireEvent.change(within(renameForm()).getByLabelText(/^Epithet/), { target: { value: '' } });
    fireEvent.click(within(renameForm()).getByRole('button', { name: 'Save' }));
    await flush();
    expect(heading().textContent).toBe('Vesperine');
    expect(document.activeElement).toBe(heading());
    expect(within(screen.getByRole('list', { name: 'Bots with Specters' })).getByRole('button', { name: /^Atlas/ }).textContent).toContain('Vesperine');
    expect(detail().textContent).not.toContain('Who waits at the door');
  });

  it('cancels with Escape and returns focus to Rename', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(button('Rename'));
    fireEvent.keyDown(within(renameForm()).getByLabelText(/^Name/), { key: 'Escape' });
    expect(within(detail()).queryByRole('form', { name: 'Rename' })).toBeNull();
    expect(document.activeElement).toBe(button('Rename'));
  });

  it('will not save an empty name', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(button('Rename'));
    fireEvent.change(within(renameForm()).getByLabelText(/^Name/), { target: { value: '   ' } });
    expect((within(renameForm()).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(renameForm());
    expect(within(renameForm()).getByLabelText(/^Name/)).toBeTruthy();
  });

  it('keeps the form open and says why when the write fails', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(button('Rename'));
    vi.spyOn(useAppApi(), 'post').mockResolvedValueOnce(new Response('{"error":"version_conflict"}', { status: 409 }));
    fireEvent.click(within(renameForm()).getByRole('button', { name: 'Save' }));
    await flush();
    expect(within(detail()).getByRole('alert').textContent).toContain('changed somewhere else');
    expect(within(renameForm()).getByLabelText(/^Name/)).toBeTruthy();
  });

  it('reports a write that failed with no code', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(button('Rename'));
    vi.spyOn(useAppApi(), 'post').mockResolvedValueOnce(new Response('oops', { status: 500 }));
    fireEvent.click(within(renameForm()).getByRole('button', { name: 'Save' }));
    await flush();
    expect(within(detail()).getByRole('alert').textContent).toContain('http_500');
  });
});

describe('archive', () => {
  it('asks first, with Keep it before the confirm button, and then removes the Specter', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(button('Archive'));
    const group = within(detail()).getByRole('group', { name: 'Archive' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons[0]?.textContent).toBe('Keep it');
    expect(group.textContent).toContain('Archive Vesper? Its history is kept.');
    fireEvent.click(buttons[0] as HTMLElement);
    expect(within(detail()).queryByRole('group', { name: 'Archive' })).toBeNull();
    fireEvent.click(button('Archive'));
    fireEvent.click(button('Yes, archive'));
    await flush();
    expect(heading().textContent).toBe('Atlas');
    expect(within(screen.getByRole('list', { name: 'Bots with Specters' })).getByRole('button', { name: /^Atlas/ }).textContent).toContain('No Specter yet');
  });
});

describe('portrait picker', () => {
  it('lists the bundled portraits and a No portrait choice, and applies one', async () => {
    await open('specters', 'Brindle');
    fireEvent.click(button('Choose portrait'));
    await flush();
    const group = within(detail()).getByRole('radiogroup', { name: 'Portraits' });
    expect(within(group).getAllByRole('radio')).toHaveLength(4);
    expect((within(group).getByRole('radio', { name: /No portrait/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(group).getByRole('radio', { name: /Violet portrait/ }));
    fireEvent.click(within(detail()).getByRole('button', { name: 'Apply' }));
    await flush();
    expect(within(detail()).queryByText('Placeholder token, not a portrait')).toBeNull();
    expect(detail().querySelector('img.sa-portrait__img')).toBeTruthy();
  });

  it('clears the portrait with No portrait', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(button('Choose portrait'));
    await flush();
    fireEvent.click(within(detail()).getByRole('radio', { name: /No portrait/ }));
    fireEvent.click(within(detail()).getByRole('button', { name: 'Apply' }));
    await flush();
    expect(screen.getByText('Placeholder token, not a portrait')).toBeTruthy();
  });

  it('closes with Cancel', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(button('Choose portrait'));
    await flush();
    fireEvent.click(within(detail()).getByRole('button', { name: 'Cancel' }));
    expect(within(detail()).queryByRole('radiogroup')).toBeNull();
  });

  it('says so when the gallery cannot load', async () => {
    await open('specters', 'Atlas');
    vi.spyOn(useAppApi(), 'get').mockRejectedValue(new Error('down'));
    fireEvent.click(button('Choose portrait'));
    await flush();
    expect(within(detail()).getByText('Portraits could not be loaded.')).toBeTruthy();
  });

  it('treats a gallery body of the wrong shape as empty', async () => {
    await open('specters', 'Atlas');
    vi.spyOn(useAppApi(), 'get').mockResolvedValue({ ok: true });
    fireEvent.click(button('Choose portrait'));
    await flush();
    expect(within(detail()).getAllByRole('radio')).toHaveLength(1);
  });
});

describe('manual entry', () => {
  it('starts from the current profile, counts characters and flags fields out of bounds', async () => {
    await open('specters', 'Atlas');
    fireEvent.click(button('Write one by hand'));
    const form = within(detail()).getByRole('form', { name: 'Write a Specter by hand' });
    expect((within(form).getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Vesper');
    expect(form.textContent).toContain('6 of 40');
    fireEvent.change(within(form).getByLabelText(/^Name/), { target: { value: 'x'.repeat(41) } });
    fireEvent.change(within(form).getByLabelText(/^Mannerism/), { target: { value: '' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(within(form).getByRole('alert').textContent).toContain('Check these fields: Name, Mannerism.');
    expect(within(form).getByLabelText(/^Name/).getAttribute('aria-invalid')).toBe('true');
    expect(form.textContent).not.toMatch(/\bAI\b/);
  });

  it('saves a hand-written Specter as written by you, with optional fields left empty', async () => {
    await open('specters-none', 'Atlas');
    fireEvent.click(button('Write one by hand'));
    const form = within(detail()).getByRole('form', { name: 'Write a Specter by hand' });
    for (const [label, value] of [['Name', 'Hand'], ['Personality', 'p'], ['Appearance', 'a'], ['Mannerism', 'm'], ['Why this fits', 'r'], ['Art brief', 'b']] as const) {
      fireEvent.change(within(form).getByLabelText(new RegExp(`^${label}`)), { target: { value } });
    }
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await flush();
    expect(heading().textContent).toBe('Hand');
    expect(detail().textContent).toContain('Written by you');
    fireEvent.click(button('Write one by hand'));
    fireEvent.click(within(detail()).getByRole('button', { name: 'Cancel' }));
    expect(within(detail()).queryByRole('form', { name: 'Write a Specter by hand' })).toBeNull();
  });
});
