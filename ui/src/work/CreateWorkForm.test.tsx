import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateWorkForm } from './CreateWorkForm';
import { bots, flush } from './testHarness';
import { BRINDLE, itemOf } from './testData';
import type { WorkActions } from './useWorkActions';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const created = itemOf({ workId: 'wrk_new' });

function setup(overrides: Partial<WorkActions> = {}, existing = [itemOf({ workId: 'wrk_a', title: 'Open parent' })]) {
  const create = vi.fn().mockResolvedValue({ ok: true, item: created });
  const actions: WorkActions = { busy: false, create, linkAttempt: vi.fn(), setMilestone: vi.fn(), decide: vi.fn(), ...overrides };
  const onCreated = vi.fn();
  const onCancel = vi.fn();
  render(<CreateWorkForm bots={bots} existing={existing} linked={new Map()} actions={actions} onCreated={onCreated} onCancel={onCancel} />);
  return { create: actions.create as ReturnType<typeof vi.fn>, onCreated, onCancel };
}

const title = () => screen.getByRole('textbox', { name: /^Title/ });
const condition = () => screen.getByRole('textbox', { name: /^Acceptance condition/ });
const fill = (text = 'Tidy up', cond = 'It is tidy.') => {
  fireEvent.change(title(), { target: { value: text } });
  fireEvent.change(condition(), { target: { value: cond } });
};
const submit = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Create work item' }));
  await flush();
};

describe('CreateWorkForm (CF-1..CF-9)', () => {
  it('focuses the title and starts with XP on and a note that zero attempts are allowed (CF-4, CF-5)', () => {
    setup();
    expect(document.activeElement).toBe(title());
    expect((screen.getByRole('checkbox', { name: 'Award XP for this work' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/You can create an item with no attempts and link them later/)).toBeTruthy();
  });

  it('needs a title and an acceptance condition within the limits and sends nothing otherwise (CF-1, CF-2)', async () => {
    const { create } = setup();
    await submit();
    expect(screen.getByRole('alert').textContent).toBe('Add a title and an acceptance condition within the limits.');
    fill('x'.repeat(121), 'ok');
    await submit();
    expect(screen.getByRole('alert')).toBeTruthy();
    fill('ok', 'x'.repeat(281));
    await submit();
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText('281 of 280')).toBeTruthy();
  });

  it('refuses a milestone label past 80 characters', async () => {
    const { create } = setup();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Add milestone' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Milestone 1' }), { target: { value: 'm'.repeat(81) } });
    await submit();
    expect(create).not.toHaveBeenCalled();
  });

  it('adds up to eight milestone rows, removes one, and drops blank rows from the request (CF-3)', async () => {
    const { create } = setup();
    fill();
    const add = screen.getByRole('button', { name: 'Add milestone' }) as HTMLButtonElement;
    for (let index = 0; index < 8; index += 1) fireEvent.click(add);
    expect(add.disabled).toBe(true);
    expect(screen.getAllByRole('textbox', { name: /^Milestone \d/ })).toHaveLength(8);
    fireEvent.change(screen.getByRole('textbox', { name: 'Milestone 1' }), { target: { value: ' First ' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Milestone 3' }), { target: { value: 'Third' } });
    for (let n = 8; n >= 4; n -= 1) fireEvent.click(screen.getByRole('button', { name: `Remove milestone ${n}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove milestone 2' }));
    await submit();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ milestones: ['First', 'Third'] }));
  });

  it('offers only parents that are open and have no accepted decision (CF-6)', () => {
    const accepted = itemOf({ workId: 'wrk_b', title: 'Done before', state: 'accepted' });
    const reopened = itemOf({ workId: 'wrk_c', title: 'Once accepted', state: 'reopened', decisions: [{ decisionId: 'dec_1', seq: 1, action: 'accept', fromState: 'awaiting-review', toState: 'accepted', actor: 'app-owner', atMs: 1, note: null, evidenceRevision: null }] });
    const cancelled = itemOf({ workId: 'wrk_d', title: 'Dropped', state: 'cancelled' });
    setup({}, [itemOf({ workId: 'wrk_a', title: 'Open parent' }), accepted, reopened, cancelled]);
    expect(within(screen.getByRole('combobox', { name: /^Part of/ })).getAllByRole('option').map((option) => option.textContent)).toEqual(['Not part of another item', 'Open parent']);
  });

  it('builds the exact request with a chosen parent, no XP and the ticked attempts (CF-7)', async () => {
    const { create, onCreated } = setup();
    fill('  Tidy  ', ' It is tidy. ');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Award XP for this work' }));
    fireEvent.change(screen.getByRole('combobox', { name: /^Part of/ }), { target: { value: 'wrk_a' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Bot' }), { target: { value: BRINDLE } });
    await flush();
    fireEvent.click(screen.getAllByRole('checkbox').find((box) => box.closest('label')?.textContent?.includes('Ended')) as HTMLElement);
    expect(screen.queryByText(/You can create an item with no attempts/)).toBeNull();
    await submit();
    expect(create).toHaveBeenCalledWith({
      title: 'Tidy',
      acceptanceCondition: 'It is tidy.',
      rewardable: false,
      parentId: 'wrk_a',
      attemptIds: ['att_cccccccccccccccc00020001'],
      milestones: [],
    });
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it('prints a server refusal in words and keeps the form (CF-8)', async () => {
    const { onCreated } = setup({ create: vi.fn().mockResolvedValue({ ok: false, code: 'parent_locked' }) });
    fill();
    await submit();
    expect(screen.getByRole('alert').textContent).toBe('That parent already has XP or is closed, so it cannot take new parts.');
    expect(onCreated).not.toHaveBeenCalled();
    expect(title()).toBeTruthy();
  });

  it('cancels with Escape or the Cancel button (CF-9)', () => {
    const { onCancel } = setup();
    fireEvent.keyDown(title(), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(title(), { key: 'a' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('disables Create while a write is in flight', () => {
    setup({ busy: true });
    expect((screen.getByRole('button', { name: 'Create work item' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
