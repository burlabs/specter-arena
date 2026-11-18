import { useAppApi } from '@kirocrew/app-sdk';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setWorkScenario } from '@kirocrew/app-sdk';
import { WorkView } from './WorkView';
import { announced, bots, click, detail, flush, openWork, selectItem, workList } from './testHarness';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const rowTitles = () => within(workList()).getAllByRole('listitem').map((row) => row.querySelector('strong')?.textContent);
const apiError = (status: number, error: string) => new Response(JSON.stringify({ contractVersion: 1, error }), { status });

describe('states (WV-1..WV-4)', () => {
  it('says it is loading, then shows the empty state and the New work item button', async () => {
    setWorkScenario('work-none');
    render(<WorkView bots={bots} complete onLedgerChanged={() => undefined} />);
    expect(screen.getByRole('status').textContent).toBe('Loading work items…');
    await flush();
    expect(screen.getByText('No work items yet')).toBeTruthy();
    expect(screen.getByText('Observed attempts stay unclassified and earn nothing until you track them as work.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New work item' })).toBeTruthy();
    expect(screen.getByText('Select a work item to see its evidence and decisions.')).toBeTruthy();
  });

  it('explains an older backend instead of showing an error (WV-2)', async () => {
    await openWork('work-unsupported');
    expect(screen.getByText('Work tracking is not supported here')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it.each([
    ['work-failure', 'The app’s database is unavailable'],
    ['work-offline', 'Could not reach the app backend. Nothing was changed.'],
  ] as const)('shows %s as words with Retry (WV-3)', async (scenario, words) => {
    await openWork(scenario);
    expect(screen.getByText('Could not load work items')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(words.replace('’', "'"));
    setWorkScenario('work');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(rowTitles()).toHaveLength(13);
  });

  it('lists thirteen items newest first and selects one into the detail pane (WV-4)', async () => {
    await openWork('work');
    expect(rowTitles()[0]).toBe('Reconcile petty cash');
    expect(rowTitles()).toHaveLength(13);
    await selectItem('Migrate the nightly report');
    expect(within(detail()).getByRole('heading', { level: 2, name: 'Migrate the nightly report' })).toBeTruthy();
    expect(within(workList()).getByRole('button', { name: /^Migrate the nightly report/ }).getAttribute('aria-current')).toBe('true');
  });

  it('notes that a partial roster can leave contributor names unknown', async () => {
    await openWork('work', { complete: false });
    expect(screen.getByText('The roster is partial, so some contributor names may show as unknown.')).toBeTruthy();
  });
});

describe('filter and paging (WV-5)', () => {
  it('reloads with the state filter and keeps the toolbar mounted while it loads', async () => {
    await openWork('work');
    const select = screen.getByRole('combobox', { name: 'Show' });
    fireEvent.change(select, { target: { value: 'awaiting-review' } });
    expect(screen.getByRole('combobox', { name: 'Show' })).toBe(select);
    await flush();
    expect(rowTitles()).toEqual(['Reconcile petty cash', 'Migrate the nightly report']);
    fireEvent.change(select, { target: { value: 'cancelled' } });
    await flush();
    expect(rowTitles()).toEqual(['Clean up stale tickets']);
  });

  it('says so when a filter matches nothing', async () => {
    await openWork('work-none');
    fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), { target: { value: 'accepted' } });
    await flush();
    expect(screen.getByText('No work items in this state.')).toBeTruthy();
  });

  it('loads the older five items on request without duplicates', async () => {
    await openWork('work-many');
    expect(rowTitles()).toHaveLength(25);
    fireEvent.click(screen.getByRole('button', { name: 'Load older work items' }));
    await flush();
    expect(rowTitles()).toHaveLength(30);
    expect(new Set(rowTitles()).size).toBe(30);
    expect(screen.queryByRole('button', { name: 'Load older work items' })).toBeNull();
  });

  it('reports an older page that fails to load', async () => {
    await openWork('work-many');
    setWorkScenario('work-offline');
    fireEvent.click(screen.getByRole('button', { name: 'Load older work items' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('Could not load older work items. Try again.');
  });
});

describe('the item went away', () => {
  it('says so when the detail poll answers unknown_work', async () => {
    await openWork('work');
    const original = useAppApi().get.bind(useAppApi());
    vi.spyOn(useAppApi(), 'get').mockImplementation((path: string) => (/\/work\/wrk_/.test(path) ? Promise.resolve(apiError(404, 'unknown_work')) : original(path)));
    await selectItem('Migrate the nightly report');
    expect(screen.getByText('This work item no longer exists.')).toBeTruthy();
  });
});

describe('no write on open (WV-9)', () => {
  it('opens, selects, filters and refreshes without a single POST', async () => {
    const post = vi.spyOn(useAppApi(), 'post');
    await openWork('work');
    await selectItem('Migrate the nightly report');
    fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), { target: { value: 'open' } });
    await flush();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('create and review journey (WV-6..WV-8, K-8)', () => {
  it('creates an item from an ended attempt, announces it, moves focus to its heading, and accepts it', async () => {
    const onLedger = vi.fn();
    await openWork('work-none', { onLedgerChanged: onLedger });
    await click('New work item', () => screen.getByRole('region', { name: 'Work items' }));
    fireEvent.change(screen.getByRole('textbox', { name: /^Title/ }), { target: { value: 'Tidy the inbox' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Acceptance condition/ }), { target: { value: 'Inbox is empty.' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Bot' }), { target: { value: bots[1]?.bindingId } });
    await flush();
    fireEvent.click(screen.getByRole('checkbox', { name: /Bot turn · .* · Ended/ }));
    await click('Create work item');
    const heading = screen.getByRole('heading', { level: 2, name: 'Tidy the inbox' });
    expect(document.activeElement).toBe(heading);
    expect(announced()).toContain('Work item created.');
    expect(within(detail()).getByText('Open')).toBeTruthy();
    expect(within(detail()).queryByRole('button', { name: 'Accept…' })).toBeNull();
    await click('Submit for review');
    expect(within(detail()).getByText('Awaiting your review')).toBeTruthy();
    expect(announced()).toContain('Sent for review.');
    await click('Accept…');
    expect(within(detail()).getByText(/1 linked attempt: /)).toBeTruthy();
    expect((within(detail()).getByRole('button', { name: 'Accept work' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(detail()).getByRole('checkbox', { name: 'I reviewed the evidence above and accept this work' }));
    await click('Accept work');
    expect(within(detail()).getByText('Accepted', { selector: '.sa-work-badge' })).toBeTruthy();
    expect(within(detail()).getByText(/Accepted by app-owner/)).toBeTruthy();
    expect(onLedger).toHaveBeenCalledTimes(1);
    expect(announced()).toContain('Work accepted.');
    expect(rowTitles()).toEqual(['Tidy the inbox']);
  });

  it('tells the owner when the current filter hides the item just created', async () => {
    await openWork('work-none');
    fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), { target: { value: 'accepted' } });
    await flush();
    await click('New work item', () => screen.getByRole('region', { name: 'Work items' }));
    fireEvent.change(screen.getByRole('textbox', { name: /^Title/ }), { target: { value: 'Hidden one' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Acceptance condition/ }), { target: { value: 'Seen later.' } });
    await click('Create work item');
    expect(announced()).toContain('Created. It is hidden by the current filter.');
    expect(screen.getByRole('heading', { level: 2, name: 'Hidden one' })).toBeTruthy();
    expect(screen.getByText('No work items in this state.')).toBeTruthy();
  });

  it('cancels the create form with Escape and picking an item closes it', async () => {
    await openWork('work');
    await click('New work item', () => screen.getByRole('region', { name: 'Work items' }));
    expect(screen.getByRole('form', { name: 'New work item' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('textbox', { name: /^Title/ }), { key: 'Escape' });
    expect(screen.queryByRole('form', { name: 'New work item' })).toBeNull();
    await click('New work item', () => screen.getByRole('region', { name: 'Work items' }));
    await selectItem('Migrate the nightly report');
    expect(screen.queryByRole('form', { name: 'New work item' })).toBeNull();
  });

  it('marks a milestone and updates the count from the response at once (WV-8)', async () => {
    await openWork('work');
    await selectItem('Migrate the nightly report');
    expect(within(detail()).getByText('1 of 3 milestones done')).toBeTruthy();
    fireEvent.click(within(detail()).getByRole('checkbox', { name: 'Check the totals' }));
    await flush();
    expect(within(detail()).getByText('2 of 3 milestones done')).toBeTruthy();
    expect(within(workList()).getByRole('button', { name: /^Migrate the nightly report/ }).textContent).toContain('2 of 3 milestones done');
    expect(announced()).toContain('Milestone marked: Check the totals.');
  });
});
