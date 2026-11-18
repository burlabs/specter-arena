import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { rosterBody } from '@kirocrew/app-sdk';
import { WorkDetail } from './WorkDetail';
import { ATLAS, BRINDLE, itemOf } from './testData';
import type { WorkActions } from './useWorkActions';

const bots = rosterBody('default').items;
const att = (n: number, extra: Record<string, unknown> = {}) => ({
  attemptId: `att_${String(n).repeat(24)}`,
  bindingId: ATLAS,
  kind: 'bot-turn',
  startedMs: 1_000,
  endedMs: 2_000,
  endSignal: 'chat-done',
  ended: true,
  present: true,
  ...extra,
});

function stubs(overrides: Partial<WorkActions> = {}): WorkActions {
  return {
    busy: false,
    create: vi.fn(),
    linkAttempt: vi.fn(),
    setMilestone: vi.fn().mockResolvedValue({ ok: false, code: 'offline' }),
    decide: vi.fn(),
    ...overrides,
  };
}

function view(item = itemOf(), extra: Partial<Parameters<typeof WorkDetail>[0]> = {}) {
  const props = {
    item,
    bots,
    parentTitle: null,
    linked: new Map<string, string>(),
    actions: stubs(),
    focusOnMount: false,
    onFocused: vi.fn(),
    onApplied: vi.fn(),
    onRefresh: vi.fn(),
    onLedgerChanged: vi.fn(),
    announce: vi.fn(),
    ...extra,
  };
  render(<WorkDetail {...props} />);
  return props;
}

describe('WorkDetail facts (WD-1..WD-4, WD-8)', () => {
  it('shows the condition, XP fact, progress words and dates, and no percentage or average', () => {
    view(itemOf({ progress: { done: 1, total: 2 }, milestones: [{ position: 1, label: 'One', doneAtMs: 5 }, { position: 2, label: 'Two', doneAtMs: null }] }));
    expect(screen.getByText('The report runs on the new host.')).toBeTruthy();
    expect(screen.getByText('100 XP when accepted (xp-policy-1)')).toBeTruthy();
    expect(screen.getByText('1 of 2 milestones done')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/%|average|token/i);
  });

  it('shows milestones as checkboxes and posts the change with the item version (WD-2, K-7)', async () => {
    const setMilestone = vi.fn().mockResolvedValue({ ok: true, item: itemOf({ version: 2 }) });
    const props = view(itemOf({ version: 1, progress: { done: 1, total: 2 }, milestones: [{ position: 1, label: 'One', doneAtMs: 5 }, { position: 2, label: 'Two', doneAtMs: null }] }), {
      actions: stubs({ setMilestone }),
    });
    expect((screen.getByRole('checkbox', { name: 'One' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Two' }));
    await vi.waitFor(() => expect(props.onApplied).toHaveBeenCalledTimes(1));
    expect(setMilestone).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }), 2, true);
    expect(props.announce).toHaveBeenCalledWith('Milestone marked: Two.');
    fireEvent.click(screen.getByRole('checkbox', { name: 'One' }));
    await vi.waitFor(() => expect(props.announce).toHaveBeenCalledWith('Milestone cleared: One.'));
    expect(setMilestone).toHaveBeenLastCalledWith(expect.anything(), 1, false);
  });

  it('shows a refused milestone write in words and reloads when the item is out of date', async () => {
    const setMilestone = vi.fn().mockResolvedValue({ ok: false, code: 'version_conflict' });
    const props = view(itemOf({ milestones: [{ position: 1, label: 'One', doneAtMs: null }], progress: { done: 0, total: 1 } }), { actions: stubs({ setMilestone }) });
    fireEvent.click(screen.getByRole('checkbox', { name: 'One' }));
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('changed somewhere else'));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(props.onApplied).not.toHaveBeenCalled();
  });

  it('disables the milestones of a cancelled item and while a write is busy (WD-2)', () => {
    view(itemOf({ state: 'cancelled', milestones: [{ position: 1, label: 'One', doneAtMs: null }], progress: { done: 0, total: 1 } }));
    expect((screen.getByRole('checkbox', { name: 'One' }) as HTMLInputElement).disabled).toBe(true);
    document.body.innerHTML = '';
    view(itemOf({ milestones: [{ position: 1, label: 'One', doneAtMs: null }], progress: { done: 0, total: 1 } }), { actions: stubs({ busy: true }) });
    expect((screen.getByRole('checkbox', { name: 'One' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('words an item without XP and a container that groups parts', () => {
    view(itemOf({ rewardable: false, bountyXp: 0 }));
    expect(screen.getByText('Tracked without XP')).toBeTruthy();
    document.body.innerHTML = '';
    view(itemOf({ childCount: 2, childrenAccepted: 1 }));
    expect(screen.getByText('Groups 2 parts and earns no XP itself')).toBeTruthy();
    expect(screen.getByText('1 of 2 parts accepted')).toBeTruthy();
  });

  it('names the parent by title, or by id when it is not loaded', () => {
    view(itemOf({ parentId: 'wrk_parent' }), { parentTitle: 'Quarterly close' });
    expect(screen.getByText('Quarterly close')).toBeTruthy();
    document.body.innerHTML = '';
    view(itemOf({ parentId: 'wrk_parent' }), { parentTitle: null });
    expect(screen.getByText('wrk_parent')).toBeTruthy();
  });
});

describe('contributors and evidence (WD-3, WD-4, WD-8)', () => {
  it('lists each contributor once with its attempts and net XP, naming unknown bots plainly', () => {
    view(itemOf({ contributors: [{ bindingId: ATLAS, attemptCount: 2, xpNet: 0 }, { bindingId: BRINDLE, attemptCount: 1, xpNet: 50 }, { bindingId: 'bnd_ffffffffffffffffffffffff', attemptCount: 1, xpNet: 0 }] }));
    const list = screen.getByRole('list', { name: 'Contributors' });
    expect(within(list).getAllByRole('listitem').map((row) => row.textContent)).toEqual(['Atlas · 2 attempts · No XP yet', 'Brindle · 1 attempt · 50 XP', 'Unknown bot (bnd_ffff…ffff) · 1 attempt · No XP yet']);
    expect(screen.getByText(/frozen at the first acceptance/)).toBeTruthy();
  });

  it('says no bots yet and no evidence for an empty item', () => {
    view();
    expect(screen.getByText('No bots yet. Link an attempt to add one.')).toBeTruthy();
    expect(screen.getByText('No attempts are linked yet.')).toBeTruthy();
  });

  it('words ended, still open and not found, and never calls an ended attempt a result', () => {
    view(itemOf({ attempts: [att(1), att(2, { ended: false, endedMs: null }), att(3, { present: false, startedMs: null, endedMs: null, ended: false })] }));
    const rows = within(screen.getByRole('list', { name: 'Evidence' })).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('span')?.textContent)).toEqual(['Bot turn · att_1111…1111 · Ended', 'Bot turn · att_2222…2222 · Still open', 'Bot turn · att_3333…3333 · Not found']);
    expect(rows[2]?.textContent).toContain('Not found in the attempts record');
    expect(screen.getByText('Ended says only that an attempt closed. It is not a result.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/success|complete|defeat/i);
  });
});

describe('decisions (WD-5, WD-6)', () => {
  const decision = (seq: number, extra: Record<string, unknown> = {}) => ({
    decisionId: `dec_${String(seq).repeat(24)}`,
    seq,
    action: 'submit',
    fromState: 'open',
    toState: 'awaiting-review',
    actor: 'app-owner' as const,
    atMs: seq * 1000,
    note: null,
    evidenceRevision: null,
    ...extra,
  });

  it('lists decisions in the order given with the actor, the states, the note and the short evidence', () => {
    view(itemOf({ decisions: [decision(1), decision(2, { action: 'accept', fromState: 'awaiting-review', toState: 'accepted', note: 'Checked it', evidenceRevision: 'abcdef0123456789abcdef01' })] }));
    const rows = within(screen.getByRole('list', { name: 'Decisions, oldest first' })).getAllByRole('listitem');
    expect(rows[0]?.textContent).toContain('#1 Submitted for review by app-owner. Open to Awaiting your review.');
    expect(rows[1]?.textContent).toContain('#2 Accepted by app-owner. Awaiting your review to Accepted.');
    expect(rows[1]?.textContent).toContain('Checked it');
    expect(rows[1]?.textContent).toContain('Evidence abcdef01');
    expect(screen.getByText('Every decision is recorded as app-owner. Crew gives apps no per-person identity.')).toBeTruthy();
    expect(screen.queryByText('Showing up to 50 decisions.')).toBeNull();
  });

  it('says there are none yet, and notes the cap at fifty', () => {
    view();
    expect(screen.getByText('No decisions yet.')).toBeTruthy();
    document.body.innerHTML = '';
    view(itemOf({ decisions: Array.from({ length: 50 }, (_, index) => decision(index + 1)) }));
    expect(screen.getByText('Showing up to 50 decisions.')).toBeTruthy();
  });

  it('words an action or state it does not know instead of guessing', () => {
    view(itemOf({ decisions: [decision(1, { action: 'teleport', fromState: 'odd', toState: 'open' })] }));
    expect(screen.getByText(/Unknown action \(teleport\) by app-owner\. Unknown state \(odd\) to Open\./)).toBeTruthy();
  });
});

describe('focus and the unknown state (WD-7, WD-9)', () => {
  it('moves focus to the heading when asked and reports it', () => {
    const props = view(itemOf(), { focusOnMount: true });
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Migrate the nightly report' }));
    expect(props.onFocused).toHaveBeenCalledTimes(1);
  });

  it('shows a note and no review controls for an unknown state', () => {
    view(itemOf({ state: 'quarantined' }));
    expect(screen.getByText('Unknown state (quarantined)')).toBeTruthy();
    expect(screen.getByText('This app version does not know this state, so no actions are offered.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Review' })).toBeNull();
  });
});

describe('linking another attempt (K-4)', () => {
  it('links the chosen attempt and announces it', async () => {
    const linkAttempt = vi.fn().mockResolvedValue({ ok: true, item: itemOf({ version: 2 }) });
    const props = view(itemOf(), { actions: stubs({ linkAttempt }), linked: new Map([['att_cccccccccccccccc00010001', 'Another item']]) });
    fireEvent.click(screen.getByRole('button', { name: 'Link another attempt' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Bot' }), { target: { value: ATLAS } });
    const taken = await screen.findByRole('checkbox', { name: /att_cccc…0001 · Still open/ });
    expect((taken as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Tracked in Another item')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Link attempt' }) as HTMLButtonElement).disabled).toBe(true);
    const free = screen.getAllByRole('checkbox').find((box) => !(box as HTMLInputElement).disabled) as HTMLInputElement;
    fireEvent.click(free);
    fireEvent.click(screen.getByRole('button', { name: 'Link attempt' }));
    await vi.waitFor(() => expect(props.onApplied).toHaveBeenCalledTimes(1));
    expect(linkAttempt).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^att_/));
    expect(props.announce).toHaveBeenCalledWith('Attempt linked.');
    expect(screen.queryByRole('button', { name: 'Link attempt' })).toBeNull();
  });

  it('shows a refused link in words and keeps the picker open; Cancel closes it', async () => {
    const linkAttempt = vi.fn().mockResolvedValue({ ok: false, code: 'attempt_already_linked' });
    view(itemOf(), { actions: stubs({ linkAttempt }) });
    fireEvent.click(screen.getByRole('button', { name: 'Link another attempt' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Bot' }), { target: { value: ATLAS } });
    const free = (await screen.findAllByRole('checkbox')).find((box) => !(box as HTMLInputElement).disabled) as HTMLInputElement;
    fireEvent.click(free);
    fireEvent.click(screen.getByRole('button', { name: 'Link attempt' }));
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe('That attempt is already tracked in another work item.'));
    expect(screen.getByRole('button', { name: 'Link attempt' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Link attempt' })).toBeNull();
  });

  it('hides the link control for an accepted item', () => {
    view(itemOf({ state: 'accepted' }));
    expect(screen.queryByRole('button', { name: 'Link another attempt' })).toBeNull();
  });
});
