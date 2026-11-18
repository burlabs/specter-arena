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

const onLedgerChanged = vi.fn();

function open() {
  return render(<ArenaView bots={bots} complete collector={collector} rosterRevision={1} specters={new Map()} xp={new Map()} onLedgerChanged={onLedgerChanged} />);
}

const settle = () => screen.findByRole('group', { name: 'Arena map' });
const inspector = () => screen.getByRole('complementary', { name: 'Encounter inspector' });
const workRow = (title: string) => within(screen.getByRole('table', { name: 'Work' })).getByRole('button', { name: new RegExp(`^${title}`) });
const specterRow = (name: string) => within(screen.getByRole('table', { name: 'Specters' })).getByRole('button', { name });

async function selectWork(title: string) {
  await settle();
  fireEvent.click(workRow(title));
  return within(inspector()).findByRole('heading', { level: 2, name: title });
}

describe('empty and work selections', () => {
  it('tells the user what to do when nothing is selected', async () => {
    setArenaScenario('arena');
    open();
    await settle();
    expect(within(inspector()).getByText(/Select a Specter or an enemy/)).toBeTruthy();
  });

  it('shows a blocked item with its reason, evidence, contributors and the Crew handoff, and focuses the heading', async () => {
    setArenaScenario('arena');
    open();
    const heading = await selectWork('Audit the shared drive permissions');
    expect(document.activeElement).toBe(heading);
    const panel = within(inspector());
    expect(panel.getByText('Blocked because: Waiting on the file owner')).toBeTruthy();
    expect(panel.getByRole('list', { name: 'Evidence' })).toBeTruthy();
    expect(panel.getByRole('list', { name: 'Contributors' })).toBeTruthy();
    expect(panel.getByRole('link', { name: 'Open Bots in Crew' }).getAttribute('href')).toBe('/members');
    expect(panel.getByText("Opens the Bots page in Crew. It cannot open this bot's chat or approvals directly.")).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Copy diagnostic summary' })).toBeTruthy();
    expect(inspector().textContent?.toLowerCase()).not.toContain('waiting on you');
  });

  it('says "No blocker recorded" for an item that is not blocked', async () => {
    setArenaScenario('arena');
    open();
    await selectWork('Summarize the support backlog');
    expect(within(inspector()).getByText('No blocker recorded')).toBeTruthy();
  });

  it('shows decisions newest first with the evidence revision of an acceptance', async () => {
    setArenaScenario('arena');
    open();
    await selectWork('Reconcile the Q3 invoices');
    const decisions = within(within(inspector()).getByRole('list', { name: 'Decisions, newest first' })).getAllByRole('listitem');
    expect(decisions[0]?.textContent).toMatch(/#2 Accepted by app-owner/);
    expect(decisions[0]?.textContent).toMatch(/Evidence [0-9a-f]{8}/);
    expect(within(inspector()).getByText('Defeated')).toBeTruthy();
    expect(within(inspector()).getByText(/XP committed/)).toBeTruthy();
  });

  it('labels the reused review flow as in-app acceptance, not a Crew approval', async () => {
    setArenaScenario('arena');
    open();
    await selectWork('Migrate the nightly report');
    const section = within(inspector()).getByRole('region', { name: 'In-app acceptance (not a Crew tool approval)' });
    expect(within(section).getByRole('button', { name: 'Accept…' })).toBeTruthy();
  });

  it('accepts through the reused panel with one write carrying the evidence revision, and refreshes the ledger and the field', async () => {
    setArenaScenario('arena');
    const post = vi.spyOn(useAppApi(), 'post');
    const get = vi.spyOn(useAppApi(), 'get');
    open();
    await selectWork('Migrate the nightly report');
    const readsBefore = get.mock.calls.length;
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Accept…' }));
    fireEvent.click(await within(inspector()).findByRole('checkbox', { name: /I reviewed the evidence above/ }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Accept work' }));
    await waitFor(() => expect(onLedgerChanged).toHaveBeenCalled());
    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0] as [string, { evidenceRevision?: string; action: string }];
    expect(path).toMatch(/\/work\/wrk_[a-z0-9]+\/decisions$/);
    expect(body.action).toBe('accept');
    expect(body.evidenceRevision).toMatch(/^[0-9a-f]{24}$/);
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(readsBefore));
    expect(await within(inspector()).findByText('Defeated')).toBeTruthy();
  });

  it('writes nothing when anything is selected, closed, copied or navigated', async () => {
    setArenaScenario('arena');
    const post = vi.spyOn(useAppApi(), 'post');
    open();
    await selectWork('Audit the shared drive permissions');
    fireEvent.click(within(inspector()).getByRole('link', { name: 'Open Bots in Crew' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Copy diagnostic summary' }));
    for (const marker of document.querySelectorAll('[data-scene-node]')) fireEvent.click(marker);
    fireEvent.click((await within(inspector()).findAllByRole('button', { name: 'Close inspector' }))[0]!);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('Specter selection', () => {
  it('shows attempts, coverage, the XP ledger and source details, and opens an XP entry at its decision', async () => {
    setArenaScenario('arena');
    open();
    await settle();
    fireEvent.click(specterRow('Atlas'));
    const panel = within(inspector());
    expect(await panel.findByRole('heading', { level: 2, name: 'Atlas' })).toBeTruthy();
    expect(panel.getByRole('heading', { level: 3, name: 'Attempts' })).toBeTruthy();
    expect(panel.getByRole('heading', { level: 3, name: 'Coverage' })).toBeTruthy();
    expect(panel.getByRole('heading', { level: 3, name: 'Source details' })).toBeTruthy();
    const entries = await panel.findAllByRole('button', { name: /^Open evidence: / });
    fireEvent.click(entries[0]!);
    const selected = await panel.findByRole('heading', { level: 2 });
    expect(selected.textContent).not.toBe('Atlas');
    expect(inspector().querySelector('[aria-current="true"]')).not.toBeNull();
    expect(within(inspector()).getByText('Opened from an XP entry')).toBeTruthy();
  });

  it('lists the open work of the Specter as buttons that select it', async () => {
    setArenaScenario('arena');
    open();
    await settle();
    fireEvent.click(specterRow('Atlas'));
    const open_ = await within(inspector()).findByRole('region', { name: 'Open work' });
    const first = within(open_).getAllByRole('button')[0]!;
    const title = first.textContent ?? '';
    fireEvent.click(first);
    expect(await within(inspector()).findByRole('heading', { level: 2, name: title })).toBeTruthy();
  });
});

describe('focus and keys', () => {
  it('returns focus to the opener on Escape and on Close', async () => {
    setArenaScenario('arena');
    open();
    await settle();
    const row = workRow('Audit the shared drive permissions');
    row.focus();
    fireEvent.click(row);
    await within(inspector()).findByRole('heading', { level: 2, name: 'Audit the shared drive permissions' });
    fireEvent.keyDown(inspector(), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(within(inspector()).getByText(/Select a Specter or an enemy/)).toBeTruthy();

    fireEvent.click(row);
    await within(inspector()).findByRole('heading', { level: 2, name: 'Audit the shared drive permissions' });
    fireEvent.click(within(inspector()).getAllByRole('button', { name: 'Close inspector' })[0]!);
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it('Escape inside the confirm form closes the form and keeps the inspector open', async () => {
    setArenaScenario('arena');
    open();
    await selectWork('Migrate the nightly report');
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Accept…' }));
    const form = await within(inspector()).findByRole('form', { name: 'Accept this work' });
    fireEvent.keyDown(form, { key: 'Escape' });
    expect(within(inspector()).getByRole('heading', { level: 2, name: 'Migrate the nightly report' })).toBeTruthy();
  });
});

describe('handoff', () => {
  it('goes to /members through the host router on a plain click and leaves a modified click to the browser', async () => {
    setArenaScenario('arena');
    open();
    await selectWork('Audit the shared drive permissions');
    const link = within(inspector()).getByRole('link', { name: 'Open Bots in Crew' });
    const keepPage = (event: Event) => event.preventDefault();
    document.addEventListener('click', keepPage);
    fireEvent.click(link, { ctrlKey: true });
    document.removeEventListener('click', keepPage);
    expect(fixtureNavigations).toEqual([]);
    fireEvent.click(link);
    expect(fixtureNavigations).toEqual(['/members']);
  });

  it('copies a summary of ids and states that holds no note text', async () => {
    setArenaScenario('arena');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    open();
    await selectWork('Audit the shared drive permissions');
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Copy diagnostic summary' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0]?.[0] as string;
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toContain('state: blocked');
    expect(text).toContain('evidenceRevision: ');
    expect(text).not.toContain('Waiting on the file owner');
    vi.unstubAllGlobals();
  });
});

describe('fallbacks that clear evidence', () => {
  it('shows "This item is no longer available" and none of the item evidence when the read says it is gone', async () => {
    setArenaScenario('arena-stale');
    open();
    await settle();
    fireEvent.click(workRow('Audit the shared drive permissions'));
    expect(await within(inspector()).findByRole('heading', { level: 2, name: 'This item is no longer available' })).toBeTruthy();
    expect(inspector().textContent).not.toContain('Waiting on the file owner');
    expect(within(inspector()).queryByRole('button', { name: 'Accept…' })).toBeNull();
    expect(within(inspector()).queryByRole('button', { name: 'Copy diagnostic summary' })).toBeNull();
  });

  it('shows "Not permitted" when the host refuses the read', async () => {
    setArenaScenario('arena');
    const original = useAppApi().get.bind(useAppApi());
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) =>
      /\/work\/wrk_[a-z0-9]+$/.test(path) ? Promise.resolve(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })) : original(path),
    );
    open();
    await settle();
    fireEvent.click(workRow('Audit the shared drive permissions'));
    expect(await within(inspector()).findByRole('heading', { level: 2, name: 'Not permitted' })).toBeTruthy();
    expect(inspector().textContent).not.toContain('Waiting on the file owner');
  });

  it('offers a retry when the read fails for another reason, and the retry loads the evidence', async () => {
    setArenaScenario('arena');
    const original = useAppApi().get.bind(useAppApi());
    let failing = true;
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) =>
      failing && /\/work\/wrk_[a-z0-9]+$/.test(path) ? Promise.reject(new TypeError('Failed to fetch')) : original(path),
    );
    open();
    await settle();
    fireEvent.click(workRow('Audit the shared drive permissions'));
    expect(await within(inspector()).findByRole('heading', { level: 2, name: 'Evidence could not be loaded' })).toBeTruthy();
    failing = false;
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Retry' }));
    expect(await within(inspector()).findByRole('heading', { level: 2, name: 'Audit the shared drive permissions' })).toBeTruthy();
  });

  it('closes from a fallback', async () => {
    setArenaScenario('arena-stale');
    open();
    await settle();
    fireEvent.click(workRow('Audit the shared drive permissions'));
    await within(inspector()).findByRole('heading', { level: 2, name: 'This item is no longer available' });
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Close inspector' }));
    expect(within(inspector()).getByText(/Select a Specter or an enemy/)).toBeTruthy();
  });
});
