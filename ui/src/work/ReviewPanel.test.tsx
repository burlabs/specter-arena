import { useAppApi } from '@kirocrew/app-sdk';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS } from '../observatory/usePolled';
import { announced, click, detail, flush, openWork, selectItem } from './testHarness';
import { setWorkScenario } from '@kirocrew/app-sdk';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const buttons = () => within(detail()).queryAllByRole('button').map((button) => button.textContent);
const reviewButtons = () => buttons().filter((name) => /^(Submit for review|Accept…|Reject…|Mark blocked|Unblock|Cancel work item…|Reopen…)$/.test(name ?? ''));
const tick = (name: RegExp | string) => fireEvent.click(within(detail()).getByRole('checkbox', { name }));
const ACK = 'I reviewed the evidence above and accept this work';

describe('buttons follow the state (RV-1, E-4)', () => {
  it.each([
    ['Summarize the support backlog', ['Submit for review', 'Mark blocked', 'Cancel work item…']],
    ['Rotate the staging keys', ['Submit for review', 'Mark blocked', 'Cancel work item…']],
    ['Migrate the nightly report', ['Accept…', 'Reject…', 'Mark blocked', 'Cancel work item…']],
    ['Audit the shared drive permissions', ['Unblock', 'Cancel work item…']],
    ['Rewrite the runbook intro', ['Reopen…', 'Cancel work item…']],
    ['Reconcile the Q3 invoices', ['Reopen…']],
    ['Clean up stale tickets', []],
  ])('%s offers %j', async (title, expected) => {
    await openWork('work');
    await selectItem(title);
    expect(reviewButtons()).toEqual(expected);
  });

  it('offers no action at all for a state this version does not know', async () => {
    const original = useAppApi().get.bind(useAppApi());
    vi.spyOn(useAppApi(), 'get').mockImplementation(async (path: string) => {
      const response = (await original(path)) as Response;
      if (!/\/work(\/|\?|$)/.test(path)) return response;
      const body = (await response.json()) as { items?: Array<{ state: string }>; state?: string };
      if (body.items !== undefined) body.items = body.items.map((item) => ({ ...item, state: 'quarantined' }));
      else body.state = 'quarantined';
      return new Response(JSON.stringify(body), { status: 200 });
    });
    await openWork('work');
    await selectItem('Migrate the nightly report');
    await flush();
    expect(within(detail()).getByText('Unknown state (quarantined)')).toBeTruthy();
    expect(reviewButtons()).toEqual([]);
    expect(within(detail()).queryByRole('button', { name: 'Link another attempt' })).toBeNull();
  });

  it('lists why an item awaiting review cannot be accepted and disables Accept', async () => {
    await openWork('work');
    await selectItem('Reconcile petty cash');
    const accept = within(detail()).getByRole('button', { name: 'Accept…' }) as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    expect(within(detail()).getByText('An attempt is no longer in the attempts record.')).toBeTruthy();
    expect(accept.getAttribute('aria-describedby')).not.toBeNull();
  });
});

describe('accepting (RV-2..RV-6, K-5)', () => {
  it('opens a form with focus on its heading, the evidence, the owner sentence and the XP line', async () => {
    await openWork('work');
    await selectItem('Migrate the nightly report');
    await click('Accept…');
    const form = within(detail()).getByRole('form', { name: 'Accept this work' });
    expect(document.activeElement).toBe(within(form).getByRole('heading', { name: 'Accept this work' }));
    expect(form.textContent).toMatch(/2 linked attempts: att_[^,]+, att_/);
    expect(form.textContent).toContain('You are accepting this as the app owner.');
    expect(form.textContent).toContain('Accepting awards 100 XP in total, split across 2 contributors. Exact amounts appear after you accept.');
    expect((within(form).getByRole('button', { name: 'Accept work' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(detail()).getByRole('button', { name: 'Accept…' }).getAttribute('aria-expanded')).toBe('true');
    expect((within(detail()).getByRole('button', { name: 'Reject…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the tab order note, checkbox, Accept, Go back (K-5)', async () => {
    await openWork('work');
    await selectItem('Migrate the nightly report');
    await click('Accept…');
    const form = within(detail()).getByRole('form', { name: 'Accept this work' });
    tick(ACK);
    const order = [...form.querySelectorAll('textarea, input, button')].map((node) => node.textContent || (node as HTMLInputElement).type);
    expect(order).toEqual(['textarea', 'checkbox', 'Accept work', 'Go back']);
  });

  it('sends the evidence revision it captured, an optional note, and applies the answer', async () => {
    const onLedger = vi.fn();
    await openWork('work', { onLedgerChanged: onLedger });
    await selectItem('Migrate the nightly report');
    const revision = (await (await useAppApi().get(`/apps/specter-arena/api/work/wrk_${'4'.padStart(24, '0')}`) as Response).json()).evidenceRevision as string;
    const post = vi.spyOn(useAppApi(), 'post');
    await click('Accept…');
    fireEvent.change(within(detail()).getByRole('textbox', { name: 'Note (optional)' }), { target: { value: ' Looks right ' } });
    tick(ACK);
    await click('Accept work');
    expect(post).toHaveBeenCalledWith(`/apps/specter-arena/api/work/wrk_${'4'.padStart(24, '0')}/decisions`, expect.objectContaining({ action: 'accept', evidenceRevision: revision, note: 'Looks right', expectedVersion: 2 }));
    expect(within(detail()).getByText('Accepted', { selector: '.sa-work-badge' })).toBeTruthy();
    expect(within(detail()).queryByRole('form')).toBeNull();
    expect(document.activeElement).toBe(within(detail()).getByRole('heading', { level: 2 }));
    expect(announced()).toContain('Work accepted.');
    expect(onLedger).toHaveBeenCalledTimes(1);
    expect(within(detail()).getByText(/Looks right/)).toBeTruthy();
    expect(within(detail()).getByText(/Evidence [0-9a-f]{8}/)).toBeTruthy();
    expect(within(detail()).getAllByText(/· 50 XP$/)).toHaveLength(2);
  });

  it('closes with Escape or Go back and returns focus to the button that opened it (K-6)', async () => {
    await openWork('work');
    await selectItem('Migrate the nightly report');
    await click('Accept…');
    fireEvent.keyDown(within(detail()).getByRole('textbox', { name: 'Note (optional)' }), { key: 'Escape' });
    await flush();
    expect(within(detail()).queryByRole('form')).toBeNull();
    expect(document.activeElement).toBe(within(detail()).getByRole('button', { name: 'Accept…' }));
    await click('Accept…');
    await click('Go back');
    expect(document.activeElement).toBe(within(detail()).getByRole('button', { name: 'Accept…' }));
  });

  it('shows a refusal in words, clears the tick, and reloads the item (RV-7)', async () => {
    await openWork('work-conflict');
    await selectItem('Migrate the nightly report');
    await click('Accept…');
    tick(ACK);
    await click('Accept work');
    expect(within(detail()).getByRole('alert').textContent).toBe('This work item changed somewhere else. It was reloaded; review it and try again.');
    expect((within(detail()).getByRole('checkbox', { name: ACK }) as HTMLInputElement).checked).toBe(false);
    tick(ACK);
    await click('Accept work');
    expect(within(detail()).getByText('Accepted', { selector: '.sa-work-badge' })).toBeTruthy();
  });

  it('reports a network failure and lets the owner retry (RV-8)', async () => {
    await openWork('work');
    await selectItem('Migrate the nightly report');
    await click('Accept…');
    tick(ACK);
    const post = vi.spyOn(useAppApi(), 'post').mockRejectedValue(new TypeError('Failed to fetch'));
    await click('Accept work');
    expect(within(detail()).getByRole('alert').textContent).toBe('Could not reach the app backend. Nothing was changed.');
    post.mockRestore();
    tick(ACK);
    await click('Accept work');
    expect(within(detail()).getByText('Accepted', { selector: '.sa-work-badge' })).toBeTruthy();
  });
});

describe('stale evidence (RV-9..RV-11, E-6)', () => {
  it('flips to a stale alert on the server refusal, disables Accept, and succeeds after Review again', async () => {
    const onLedger = vi.fn();
    await openWork('work-stale', { onLedgerChanged: onLedger });
    await selectItem('Migrate the nightly report');
    await click('Accept…');
    tick(ACK);
    await click('Accept work');
    const alert = within(detail()).getByRole('alert');
    expect(alert.textContent).toContain('The evidence changed after you opened this review, so nothing was decided.');
    expect(onLedger).not.toHaveBeenCalled();
    expect((within(detail()).getByRole('button', { name: 'Accept…' }) as HTMLButtonElement).disabled).toBe(true);
    await click('Review again');
    expect(within(detail()).getByRole('form', { name: 'Accept this work' })).toBeTruthy();
    tick(ACK);
    await click('Accept work');
    expect(within(detail()).getByText('Accepted', { selector: '.sa-work-badge' })).toBeTruthy();
    expect(onLedger).toHaveBeenCalledTimes(1);
  });

  it('goes stale when a poll shows other evidence while the form is open, and Review again reopens it on the new evidence', async () => {
    await openWork('work');
    await selectItem('Migrate the nightly report');
    await click('Accept…');
    const base = '/apps/specter-arena/api/work/wrk_000000000000000000000004';
    const current = (await (await useAppApi().get(base) as Response).json()) as { version: number };
    await useAppApi().post(`${base}/attempts`, { expectedVersion: current.version, attemptId: 'att_dddddddddddddddd00010003' });
    await act();
    expect(within(detail()).getByRole('alert').textContent).toContain('The evidence changed after you opened this review');
    expect((within(detail()).getByRole('button', { name: 'Review again' }) as HTMLButtonElement).disabled).toBe(false);
    await click('Review again');
    expect(within(detail()).getByText(/3 linked attempts: /)).toBeTruthy();
    await click('Go back');
    expect(within(detail()).queryByRole('form')).toBeNull();
  });

  it('closes the form and says so when the item changed to a state that no longer allows the action', async () => {
    await openWork('work');
    await selectItem('Migrate the nightly report');
    await click('Accept…');
    const base = '/apps/specter-arena/api/work/wrk_000000000000000000000004';
    const current = (await (await useAppApi().get(base) as Response).json()) as { version: number };
    await useAppApi().post(`${base}/decisions`, { requestId: 'wrq_elsewhere0001', expectedVersion: current.version, action: 'block' });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await flush();
    expect(within(detail()).queryByRole('form')).toBeNull();
    expect(announced()).toContain('This work changed. Review it again.');
    expect(within(detail()).getByText('Blocked')).toBeTruthy();
  });
});

async function act(): Promise<void> {
  await vi.advanceTimersByTimeAsync(POLL_MS);
  await flush();
}

describe('direct actions and the other confirms (RV-12..RV-14)', () => {
  it('submits, blocks and unblocks without a confirm step and with a fresh request id each time', async () => {
    await openWork('work');
    await selectItem('Summarize the support backlog');
    const post = vi.spyOn(useAppApi(), 'post');
    await click('Submit for review');
    expect(within(detail()).getByText('Awaiting your review', { selector: '.sa-work-badge' })).toBeTruthy();
    await click('Mark blocked');
    expect(within(detail()).getByText('Blocked', { selector: '.sa-work-badge' })).toBeTruthy();
    await click('Unblock');
    expect(within(detail()).getByText('Open', { selector: '.sa-work-badge' })).toBeTruthy();
    const ids = post.mock.calls.map((call) => (call[1] as { requestId: string }).requestId);
    expect(new Set(ids).size).toBe(3);
    expect(post.mock.calls.map((call) => (call[1] as { action: string }).action)).toEqual(['submit', 'block', 'unblock']);
    expect(announced()).toContain('Work unblocked.');
  });

  it('shows a refused direct action in words and reloads', async () => {
    await openWork('work-conflict');
    await selectItem('Summarize the support backlog');
    await click('Submit for review');
    expect(within(detail()).getByRole('alert').textContent).toContain('changed somewhere else');
    await click('Submit for review');
    expect(within(detail()).getByText('Awaiting your review', { selector: '.sa-work-badge' })).toBeTruthy();
    expect(within(detail()).queryByRole('alert')).toBeNull();
  });

  it('rejects after a confirm that promises no XP, and the item can then be reopened', async () => {
    const onLedger = vi.fn();
    await openWork('work', { onLedgerChanged: onLedger });
    await selectItem('Migrate the nightly report');
    await click('Reject…');
    expect(within(detail()).getByText('Rejecting awards no XP. You can reopen it later.')).toBeTruthy();
    fireEvent.change(within(detail()).getByRole('textbox', { name: 'Reason (optional)' }), { target: { value: 'Not yet' } });
    await click('Reject work');
    expect(within(detail()).getByText('Rejected', { selector: '.sa-work-badge' })).toBeTruthy();
    expect(within(detail()).getByText(/Not yet/)).toBeTruthy();
    expect(onLedger).not.toHaveBeenCalled();
  });

  it('warns that a cancelled item cannot be reopened and then offers no action', async () => {
    await openWork('work');
    await selectItem('Summarize the support backlog');
    await click('Cancel work item…');
    expect(within(detail()).getByText('A cancelled item cannot be reopened.')).toBeTruthy();
    await click('Cancel work item');
    expect(within(detail()).getByText('Cancelled', { selector: '.sa-work-badge' })).toBeTruthy();
    expect(reviewButtons()).toEqual([]);
    expect(within(detail()).queryByRole('button', { name: 'Link another attempt' })).toBeNull();
  });

  it('warns that reopening takes XP back only when the contributors hold XP, and refreshes the ledger then', async () => {
    const onLedger = vi.fn();
    await openWork('work', { onLedgerChanged: onLedger });
    await selectItem('Reconcile the Q3 invoices');
    await click('Reopen…');
    expect(within(detail()).getByText('Reopening takes back the XP it earned. Accepting it again restores exactly the same amount, never more.')).toBeTruthy();
    await click('Reopen work');
    expect(within(detail()).getByText('Reopened', { selector: '.sa-work-badge' })).toBeTruthy();
    expect(onLedger).toHaveBeenCalledTimes(1);
    expect(within(detail()).getByText('Atlas · 1 attempt · No XP yet')).toBeTruthy();
  });

  it('says reopening a rejected item changes no XP and does not refresh the ledger', async () => {
    const onLedger = vi.fn();
    await openWork('work', { onLedgerChanged: onLedger });
    await selectItem('Rewrite the runbook intro');
    await click('Reopen…');
    expect(within(detail()).getByText('Reopening changes no XP.')).toBeTruthy();
    await click('Reopen work');
    expect(within(detail()).getByText('Reopened', { selector: '.sa-work-badge' })).toBeTruthy();
    expect(onLedger).not.toHaveBeenCalled();
  });

  it('words what accepting a container and an item without XP means', async () => {
    await openWork('work');
    await selectItem('Check the vendor invoice totals');
    await click('Submit for review');
    await click('Accept…');
    expect(within(detail()).getByText('This item is tracked without XP.')).toBeTruthy();
    await click('Go back');
    setWorkScenario('work');
    await selectItem('Quarterly close');
    await click('Submit for review');
    expect(within(detail()).getByText('Every part must be accepted first.')).toBeTruthy();
    expect((within(detail()).getByRole('button', { name: 'Accept…' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the stale panel before the new evidence has loaded', () => {
  it('keeps Review again off until the item shows a different revision', async () => {
    const { render } = await import('@testing-library/react');
    const { ReviewPanel } = await import('./ReviewPanel');
    const { itemOf } = await import('./testData');
    const item = itemOf({ state: 'awaiting-review', attempts: [], review: { canAccept: true, blockers: [] }, evidenceRevision: 'c'.repeat(24) });
    const decide = vi.fn().mockResolvedValue({ ok: false, code: 'stale_evidence' });
    const onRefresh = vi.fn();
    render(
      <div role="region" aria-label="Work detail">
        <ReviewPanel
          item={item}
          actions={{ busy: false, create: vi.fn(), linkAttempt: vi.fn(), setMilestone: vi.fn(), decide }}
          onApplied={vi.fn()}
          onRefresh={onRefresh}
          onLedgerChanged={vi.fn()}
          announce={vi.fn()}
          focusHeading={vi.fn()}
        />
      </div>,
    );
    await click('Accept…');
    expect(within(detail()).getByText('No linked attempts. This item groups other work.')).toBeTruthy();
    tick(ACK);
    await click('Accept work');
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(within(detail()).getByText('Reloading the latest evidence…')).toBeTruthy();
    expect((within(detail()).getByRole('button', { name: 'Review again' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
