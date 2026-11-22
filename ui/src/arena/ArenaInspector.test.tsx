import { fixtureNavigations, rosterBody, setArenaScenario, useAppApi } from '@kirocrew/app-sdk';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RosterItemV1 } from '../contracts/types';
import { ArenaView } from './ArenaView';
import { clearSceneArtCache } from './sceneAssetCache';

const collector = { state: 'running', reasonCode: null, sinceMs: 1 };
const bots: RosterItemV1[] = rosterBody('default').items;

beforeEach(() => clearSceneArtCache());
afterEach(() => {
  setArenaScenario(null);
  vi.restoreAllMocks();
});

function open() {
  return render(<ArenaView bots={bots} complete collector={collector} rosterRevision={1} specters={new Map()} xp={new Map()} />);
}

const settle = () => screen.findByRole('group', { name: 'Arena map' });
const inspector = () => screen.getByRole('complementary', { name: 'Encounter inspector' });
const WAITING = 'Not credited: an approval or a question was still pending when it ended.';
const CREDITED = 'Auto-credited when the task ended cleanly.';
/** The select button of the first task row whose close-out words contain `text`. */
const taskRow = (text: string) => {
  const row = within(screen.getByRole('table', { name: 'Tasks' }))
    .getAllByRole('row')
    .slice(1)
    .find((candidate) => candidate.textContent?.includes(text));
  if (row === undefined) throw new Error(`no task row with ${text}`);
  return within(row).getByRole('button');
};
const specterRow = (name: string) => within(screen.getByRole('table', { name: 'Specters' })).getByRole('button', { name });

async function selectTask(text: string) {
  await settle();
  const button = taskRow(text);
  const title = button.textContent ?? '';
  fireEvent.click(button);
  return { title, heading: await within(inspector()).findByRole('heading', { level: 2, name: title }) };
}

describe('empty and task selections', () => {
  it('tells the user what to do when nothing is selected', async () => {
    setArenaScenario('arena');
    open();
    await settle();
    expect(within(inspector()).getByText(/Select a Specter or a minion/)).toBeTruthy();
  });

  it('shows a not-credited task with its reason in words, its evidence and the Crew handoff, and focuses the heading', async () => {
    setArenaScenario('arena');
    open();
    const { heading } = await selectTask(WAITING);
    expect(document.activeElement).toBe(heading);
    const panel = within(inspector());
    expect(panel.getAllByText(WAITING).length).toBeGreaterThan(0);
    expect(panel.getByRole('region', { name: 'Task evidence' })).toBeTruthy();
    expect(panel.getByText('No XP')).toBeTruthy();
    expect(panel.getByRole('link', { name: 'Open Bots in Crew' }).getAttribute('href')).toBe('/members');
    expect(panel.getByText("Opens the Bots page in Crew. It cannot open this bot's chat or approvals directly.")).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Copy diagnostic summary' })).toBeTruthy();
    expect(inspector().textContent?.toLowerCase()).not.toContain('waiting on you');
  });

  it('shows a credited task with how it was closed, the XP written and the policy', async () => {
    setArenaScenario('arena');
    open();
    await selectTask(CREDITED);
    const panel = within(inspector());
    expect(panel.getByText(CREDITED)).toBeTruthy();
    expect(panel.getByText('Defeated')).toBeTruthy();
    expect(panel.getAllByText(/XP credited/).length).toBeGreaterThan(0);
    expect(panel.getByText('xp-policy-2')).toBeTruthy();
    expect(panel.getByText(/It is not a check that the outcome was right/)).toBeTruthy();
  });

  it('shows a task that is still running with no end time and no XP yet', async () => {
    setArenaScenario('arena');
    open();
    await selectTask('Open: still running');
    const panel = within(inspector());
    expect(panel.getByText('Still running')).toBeTruthy();
    expect(panel.getByText('No XP yet')).toBeTruthy();
  });

  it('says a task that is no longer observed cannot be closed yet', async () => {
    setArenaScenario('arena');
    open();
    await selectTask('Open: the app can no longer observe this task');
    expect(within(inspector()).getByText('Not observed')).toBeTruthy();
  });

  it('has no accept, reject, reopen or other write control anywhere in the arena', async () => {
    setArenaScenario('arena');
    const post = vi.spyOn(useAppApi(), 'post');
    open();
    await selectTask(CREDITED);
    for (const name of [/accept/i, /reject/i, /reopen/i, /submit/i, /^block/i, /cancel/i, /link/i]) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByText(/In-app acceptance/)).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('writes nothing and calls no work route when anything is selected, closed, copied or navigated', async () => {
    setArenaScenario('arena');
    const post = vi.spyOn(useAppApi(), 'post');
    const get = vi.spyOn(useAppApi(), 'get');
    open();
    await selectTask(WAITING);
    fireEvent.click(within(inspector()).getByRole('link', { name: 'Open Bots in Crew' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Copy diagnostic summary' }));
    for (const marker of document.querySelectorAll('[data-scene-node]')) fireEvent.click(marker);
    fireEvent.click((await within(inspector()).findAllByRole('button', { name: 'Close inspector' }))[0]!);
    expect(post).not.toHaveBeenCalled();
    const paths = get.mock.calls.map((call) => String(call[0]));
    expect(paths.filter((path) => /\/work(\/|\?|$)/.test(path))).toEqual([]);
    expect(paths.some((path) => /\/tasks\/tsk_[0-9a-f]{24}$/.test(path))).toBe(true);
  });
});

describe('Specter selection', () => {
  it('shows attempts, coverage, the XP ledger and source details, with no link from a ledger entry to a work item', async () => {
    setArenaScenario('arena');
    open();
    await settle();
    fireEvent.click(specterRow('Atlas'));
    const panel = within(inspector());
    expect(await panel.findByRole('heading', { level: 2, name: 'Atlas' })).toBeTruthy();
    expect(panel.getByRole('heading', { level: 3, name: 'Attempts' })).toBeTruthy();
    expect(panel.getByRole('heading', { level: 3, name: 'Coverage' })).toBeTruthy();
    expect(panel.getByRole('heading', { level: 3, name: 'Source details' })).toBeTruthy();
    expect(panel.getByText(/^Crew reports a turn running/)).toBeTruthy();
    expect(inspector().textContent).not.toMatch(/Context in use/);
    expect(await panel.findByText(/Award \+100 XP · Reconcile the Q3 invoices/)).toBeTruthy();
    expect(panel.queryByRole('button', { name: /Open evidence/ })).toBeNull();
  });

  it('lists the open tasks of the Specter as buttons that select the task', async () => {
    setArenaScenario('arena');
    open();
    await settle();
    fireEvent.click(specterRow('Atlas'));
    const region = await within(inspector()).findByRole('region', { name: 'Open tasks' });
    const buttons = within(region).getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    const title = buttons[0]!.textContent ?? '';
    fireEvent.click(buttons[0]!);
    expect(await within(inspector()).findByRole('heading', { level: 2, name: title })).toBeTruthy();
    expect(within(inspector()).getByRole('region', { name: 'Task evidence' })).toBeTruthy();
  });
});

describe('Specter handoff and open work', () => {
  it('copies a Specter summary with the binding id and condition and no name', async () => {
    setArenaScenario('arena');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    open();
    await settle();
    fireEvent.click(specterRow('Atlas'));
    fireEvent.click(await within(inspector()).findByRole('button', { name: 'Copy diagnostic summary' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0]?.[0] as string;
    expect(text).toContain('selection: specter');
    expect(text).toMatch(/bindingId: bnd_/);
    expect(text).toContain('condition: ');
    expect(text).not.toContain('Atlas');
    vi.unstubAllGlobals();
  });

  it('lists several open tasks of one bot', async () => {
    setArenaScenario('arena-perf-1');
    render(<ArenaView bots={rosterBody('arena-perf-roster').items} complete collector={collector} rosterRevision={1} specters={new Map()} xp={new Map()} />);
    await settle();
    fireEvent.click(within(screen.getByRole('table', { name: 'Specters' })).getAllByRole('button')[0]!);
    const region = await within(inspector()).findByRole('region', { name: 'Open tasks' });
    await waitFor(() => expect(within(region).getAllByRole('button').length).toBeGreaterThan(1));
  });
});

describe('focus and keys', () => {
  it('returns focus to the opener on Escape and on Close', async () => {
    setArenaScenario('arena');
    open();
    await settle();
    const row = taskRow(WAITING);
    const title = row.textContent ?? '';
    row.focus();
    fireEvent.click(row);
    await within(inspector()).findByRole('heading', { level: 2, name: title });
    fireEvent.keyDown(inspector(), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(within(inspector()).getByText(/Select a Specter or a minion/)).toBeTruthy();

    fireEvent.click(row);
    await within(inspector()).findByRole('heading', { level: 2, name: title });
    fireEvent.click(within(inspector()).getAllByRole('button', { name: 'Close inspector' })[0]!);
    await waitFor(() => expect(document.activeElement).toBe(row));
  });
});

describe('handoff', () => {
  it('goes to /members through the host router on a plain click and leaves a modified click to the browser', async () => {
    setArenaScenario('arena');
    open();
    await selectTask(WAITING);
    const link = within(inspector()).getByRole('link', { name: 'Open Bots in Crew' });
    const keepPage = (event: Event) => event.preventDefault();
    document.addEventListener('click', keepPage);
    fireEvent.click(link, { ctrlKey: true });
    document.removeEventListener('click', keepPage);
    expect(fixtureNavigations).toEqual([]);
    fireEvent.click(link);
    expect(fixtureNavigations).toEqual(['/members']);
  });

  it('copies a summary of ids and states that holds no free text', async () => {
    setArenaScenario('arena');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    open();
    await selectTask(WAITING);
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Copy diagnostic summary' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0]?.[0] as string;
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toContain('closeReason waiting-at-end');
    expect(text).toMatch(/taskId: tsk_[0-9a-f]{24}/);
    expect(text).toContain('contracts: task-item v1');
    expect(text).not.toContain(WAITING);
    vi.unstubAllGlobals();
  });
});

describe('fallbacks that clear evidence', () => {
  it('shows "This item is no longer available" and none of the task evidence when the read says it is gone', async () => {
    setArenaScenario('arena-stale');
    open();
    await settle();
    fireEvent.click(taskRow('Not credited'));
    expect(await within(inspector()).findByRole('heading', { level: 2, name: 'This item is no longer available' })).toBeTruthy();
    expect(within(inspector()).queryByRole('region', { name: 'Task evidence' })).toBeNull();
    expect(within(inspector()).queryByRole('button', { name: 'Copy diagnostic summary' })).toBeNull();
  });

  it('shows "Not permitted" when the host refuses the read', async () => {
    setArenaScenario('arena');
    const original = useAppApi().get.bind(useAppApi());
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) =>
      /\/tasks\/tsk_[0-9a-f]+$/.test(path) ? Promise.resolve(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })) : original(path),
    );
    open();
    await settle();
    fireEvent.click(taskRow(WAITING));
    expect(await within(inspector()).findByRole('heading', { level: 2, name: 'Not permitted' })).toBeTruthy();
    expect(within(inspector()).queryByRole('region', { name: 'Task evidence' })).toBeNull();
  });

  it('offers a retry when the read fails for another reason, and the retry loads the evidence', async () => {
    setArenaScenario('arena');
    const original = useAppApi().get.bind(useAppApi());
    let failing = true;
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) =>
      failing && /\/tasks\/tsk_[0-9a-f]+$/.test(path) ? Promise.reject(new TypeError('Failed to fetch')) : original(path),
    );
    open();
    await settle();
    const button = taskRow(WAITING);
    const title = button.textContent ?? '';
    fireEvent.click(button);
    expect(await within(inspector()).findByRole('heading', { level: 2, name: 'Evidence could not be loaded' })).toBeTruthy();
    failing = false;
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Retry' }));
    expect(await within(inspector()).findByRole('heading', { level: 2, name: title })).toBeTruthy();
  });

  it('closes from a fallback', async () => {
    setArenaScenario('arena-stale');
    open();
    await settle();
    fireEvent.click(taskRow('Not credited'));
    await within(inspector()).findByRole('heading', { level: 2, name: 'This item is no longer available' });
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Close inspector' }));
    expect(within(inspector()).getByText(/Select a Specter or a minion/)).toBeTruthy();
  });
});
