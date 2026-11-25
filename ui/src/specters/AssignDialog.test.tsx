import { rosterBody, setSpecterScenario, useAppApi } from '@kirocrew/app-sdk';
import type { SpecterScenarioName } from '@kirocrew/app-sdk';
import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSceneArtCache } from '../arena/sceneAssetCache';
import type { RosterItemV1 } from '../contracts/types';
import { AssignDialog } from './AssignDialog';
import { useHeroes } from './useHeroes';
import { useSpecters } from './useSpecters';

const bots = rosterBody('default').items;
const bindingOf = (n: number) => `bnd_${'a'.repeat(20)}${n.toString(16).padStart(4, '0')}`;
const onClose = vi.fn();

function Harness({ queue, items = bots }: { queue: readonly string[]; items?: readonly RosterItemV1[] }) {
  const specters = useSpecters();
  const heroes = useHeroes();
  if (specters.status !== 'ready') return null;
  return <AssignDialog bots={items} queue={queue} specters={specters} heroes={heroes} onClose={onClose} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  clearSceneArtCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  onClose.mockReset();
});

const flush = async () => {
  for (let index = 0; index < 6; index += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};

async function open(scenario: SpecterScenarioName, queue: readonly string[], items: readonly RosterItemV1[] = bots) {
  setSpecterScenario(scenario);
  render(<Harness queue={queue} items={items} />);
  await flush();
}

const FOUR = [4, 5, 6, 7].map(bindingOf);
const dialog = () => document.querySelector('dialog') as HTMLDialogElement;
const heading = () => within(dialog()).getByRole('heading', { level: 2 });
const choose = (name: RegExp) => fireEvent.click(within(dialog()).getByRole('radio', { name }));
const press = async (name: string | RegExp) => {
  fireEvent.click(within(dialog()).getByRole('button', { name }));
  await flush();
};
const post = () => vi.spyOn(useAppApi(), 'post');

describe('the first step', () => {
  it('opens as a modal dialog named by its heading, with the step count and the finality note', async () => {
    await open('specters-unassigned', FOUR);
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(dialog().getAttribute('aria-labelledby')).toBe(heading().id);
    expect(dialog().getAttribute('aria-describedby')).toBe(within(dialog()).getByText('A bot keeps its Specter once assigned.').id);
    expect(heading().textContent).toBe('Choose a Specter for Dune');
    expect(within(dialog()).getByText('Step 1 of 4')).toBeTruthy();
    expect(document.activeElement).toBe(heading());
  });

  it('lists the 11 heroes with the fewest holders first and the holder counts beside them', async () => {
    await open('specters-unassigned', FOUR);
    const radios = within(dialog()).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((radio) => radio.value)).toEqual(['rattle', 'ember', 'shard', 'poly', 'tide', 'lume', 'moss', 'bur', 'vell', 'stitch', 'reeve']);
    expect(radios[0]?.checked).toBe(true);
    expect(within(dialog()).getByRole('radio', { name: 'Vell held by 1' })).toBeTruthy();
    expect(within(dialog()).getByRole('radio', { name: 'Tide not held yet' })).toBeTruthy();
    expect(within(dialog()).getByRole('button', { name: 'Assign Rattle' })).toBeTruthy();
  });

  it('leaves Randomize, Skip and Close on every step', async () => {
    await open('specters-unassigned', FOUR);
    for (const name of ['Randomize all unassigned', 'Skip for now', 'Close']) expect(within(dialog()).getByRole('button', { name })).toBeTruthy();
  });
});

describe('assigning', () => {
  it('writes the chosen hero at once and moves on to the next bot', async () => {
    await open('specters-unassigned', FOUR);
    const spy = post();
    choose(/^Tide/);
    expect(within(dialog()).getByRole('button', { name: 'Assign Tide' })).toBeTruthy();
    await press('Assign Tide');
    expect(spy).toHaveBeenCalledWith(`/apps/specter-arena/api/specters/${bindingOf(4)}/hero`, { expectedVersion: 0, heroId: 'tide' });
    expect(heading().textContent).toBe('Choose a Specter for Ember');
    expect(within(dialog()).getByText('Step 2 of 4')).toBeTruthy();
    expect(within(dialog()).getByRole('radio', { name: 'Tide held by 1' })).toBeTruthy();
  });

  it('assigns the preselected least-held hero with one press', async () => {
    await open('specters-unassigned', FOUR);
    const spy = post();
    await press('Assign Rattle');
    expect(spy).toHaveBeenCalledWith(expect.any(String), { expectedVersion: 0, heroId: 'rattle' });
  });

  it('shows the words of a failure, stays on the step and can try again', async () => {
    await open('specters-assign-fail', FOUR);
    await press('Assign Rattle');
    expect(within(dialog()).getByRole('alert').textContent).toBe("The app's database is unavailable. Nothing was changed.");
    expect(heading().textContent).toBe('Choose a Specter for Dune');
    expect((within(dialog()).getByRole('button', { name: 'Assign Rattle' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables every control while a write is under way', async () => {
    await open('specters-unassigned', FOUR);
    let release: (value: Response) => void = () => undefined;
    vi.spyOn(useAppApi(), 'post').mockImplementation(() => new Promise((resolve) => (release = resolve)));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Assign Rattle' }));
    await flush();
    for (const button of within(dialog()).getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog()).getByText('Assigning…')).toBeTruthy();
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    release(new Response('{}', { status: 500 }));
    await flush();
  });

  it('moves on by itself when the bot already holds a hero (409 and a reload)', async () => {
    await open('specters-unassigned', FOUR);
    const client = useAppApi();
    const original = client.post.bind(client);
    // Another window assigned Dune first: the real route answers 409, the reload lists it.
    await original(`/apps/specter-arena/api/specters/${bindingOf(4)}/hero`, { expectedVersion: 0, heroId: 'tide' });
    await press('Assign Rattle');
    expect(heading().textContent).toBe('Choose a Specter for Ember');
  });

  it('steps over a bot that gained a Specter while the dialog was open', async () => {
    await open('specters-unassigned', FOUR);
    await press('Skip for now');
    await useAppApi().post(`/apps/specter-arena/api/specters/${bindingOf(5)}/hero`, { expectedVersion: 0, heroId: 'ember' });
    await act(async () => void (await vi.advanceTimersByTimeAsync(15_000)));
    await flush();
    expect(heading().textContent).toBe('Choose a Specter for Unnamed bot');
    expect(within(dialog()).getByText('Step 3 of 4')).toBeTruthy();
  });

  it('says so when the bot left the roster, and only offers Skip, Randomize and Close', async () => {
    await open('specters-unassigned', FOUR, bots.filter((bot) => bot.bindingId !== bindingOf(4)));
    expect(heading().textContent).toBe('This bot is no longer on the roster.');
    expect(within(dialog()).queryByRole('radio')).toBeNull();
    expect(within(dialog()).queryByRole('button', { name: /^Assign / })).toBeNull();
    await press('Skip for now');
    expect(heading().textContent).toBe('Choose a Specter for Ember');
  });
});

describe('skipping and the summary', () => {
  it('ends on a summary of what was assigned and skipped, with a hint for the rest, and Done closes with every shown bot', async () => {
    await open('specters-unassigned', FOUR);
    await press('Assign Rattle');
    await press('Skip for now');
    await press('Assign Ember');
    await press('Skip for now');
    expect(heading().textContent).toBe('Specters assigned');
    expect(within(dialog()).getByRole('status').textContent).toBe('2 assigned, 2 skipped');
    expect(within(dialog()).getByText('Skipped bots can be assigned later from the Specters tab or the Roster.')).toBeTruthy();
    const done = within(dialog()).getByRole('button', { name: 'Done' });
    expect(document.activeElement).toBe(done);
    fireEvent.click(done);
    expect(onClose).toHaveBeenCalledWith(FOUR);
  });

  it('shows no hint when nothing was skipped', async () => {
    await open('specters-unassigned', [bindingOf(4)]);
    await press('Assign Rattle');
    expect(within(dialog()).getByRole('status').textContent).toBe('1 assigned, 0 skipped');
    expect(within(dialog()).queryByText(/assigned later/)).toBeNull();
  });
});

describe('Randomize all unassigned', () => {
  it('assigns every remaining bot one after another, with progress, then shows the summary', async () => {
    await open('specters-unassigned', FOUR);
    await press('Assign Rattle');
    const calls: string[] = [];
    let inFlight = 0;
    let overlap = 0;
    const client = useAppApi();
    const original = client.post.bind(client);
    vi.spyOn(client, 'post').mockImplementation(async (path: string, body?: unknown) => {
      inFlight += 1;
      overlap = Math.max(overlap, inFlight);
      calls.push(`${path.split('/').at(-2)}:${JSON.stringify(body)}`);
      await Promise.resolve();
      inFlight -= 1;
      return original(path, body);
    });
    await press('Randomize all unassigned');
    expect(calls).toEqual([5, 6, 7].map((n) => `${bindingOf(n)}:{"expectedVersion":0,"heroId":null}`));
    expect(overlap).toBe(1);
    expect(heading().textContent).toBe('Specters assigned');
    expect(within(dialog()).getByRole('status').textContent).toBe('4 assigned, 0 skipped');
  });

  it('also assigns a bot that was skipped earlier, so nothing is left to skip', async () => {
    await open('specters-all-unassigned', [1, 2, 3].map(bindingOf));
    await press('Skip for now');
    await press('Randomize all unassigned');
    expect(within(dialog()).getByRole('status').textContent).toBe('3 assigned, 0 skipped');
    expect(within(dialog()).queryByText(/could not/)).toBeNull();
  });

  it('counts the bots it could not assign and keeps the way back to them', async () => {
    await open('specters-assign-fail', FOUR);
    await press('Randomize all unassigned');
    expect(within(dialog()).getByRole('status').textContent).toBe('0 assigned, 0 skipped, 4 could not be assigned');
    expect(within(dialog()).getByText(/assigned later/)).toBeTruthy();
  });

  it('shows progress while it runs and ignores Escape until it is done', async () => {
    await open('specters-unassigned', FOUR);
    const releases: Array<() => void> = [];
    vi.spyOn(useAppApi(), 'post').mockImplementation(() => new Promise((resolve) => releases.push(() => resolve(new Response('{}', { status: 500 })))));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Randomize all unassigned' }));
    await flush();
    expect(within(dialog()).getByRole('status').textContent).toBe('Assigning 0 of 4…');
    fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    for (let n = 0; n < 4; n += 1) {
      releases[n]?.();
      await flush();
    }
    expect(heading().textContent).toBe('Specters assigned');
  });
});

describe('leaving', () => {
  it('Close and Escape both report every bot of the walkthrough as offered, and Escape does not close the native dialog by itself', async () => {
    await open('specters-unassigned', FOUR);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenLastCalledWith(FOUR);
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(dialog(), cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('the heroes list', () => {
  const failHeroes = () => {
    const client = useAppApi();
    const original = client.get.bind(client);
    vi.spyOn(client, 'get').mockImplementation((path: string) => (path.endsWith('/heroes') ? Promise.reject(new TypeError('down')) : original(path)));
  };

  it('says it could not load the heroes, offers no hero to pick and still lets the user randomize or skip', async () => {
    failHeroes();
    await open('specters-unassigned', FOUR);
    expect(within(dialog()).getByRole('alert').textContent).toBe('The heroes could not be loaded. You can still randomize.');
    expect(within(dialog()).queryByRole('radio')).toBeNull();
    expect((within(dialog()).getByRole('button', { name: /^Assign/ }) as HTMLButtonElement).disabled).toBe(true);
    await press('Randomize all unassigned');
    expect(heading().textContent).toBe('Specters assigned');
  });

  it('says it is loading the heroes while they load', async () => {
    setSpecterScenario('specters-unassigned');
    const client = useAppApi();
    const original = client.get.bind(client);
    vi.spyOn(client, 'get').mockImplementation((path: string) => (path.endsWith('/heroes') ? new Promise(() => undefined) : original(path)));
    render(<Harness queue={FOUR} />);
    await flush();
    expect(within(dialog()).getByRole('status').textContent).toBe('Loading heroes…');
  });
});
