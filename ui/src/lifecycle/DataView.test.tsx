import { setDataScenario, useAppApi } from '@kirocrew/app-sdk';
import type { DataScenarioName } from '@kirocrew/app-sdk';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS } from '../observatory/usePolled';
import { DataView } from './DataView';
import { dataBody } from './testData';

const PREFIX = '/apps/specter-arena/api';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};

async function open(scenario: DataScenarioName): Promise<void> {
  setDataScenario(scenario);
  render(<DataView />);
  await flush();
}

const press = async (name: string | RegExp): Promise<void> => {
  fireEvent.click(screen.getByRole('button', { name }));
  await flush();
};
const section = (name: string) => within(screen.getByRole('region', { name: 'Data' })).getByRole('heading', { level: 3, name }).closest('section') as HTMLElement;
const select = () => screen.getByRole('combobox', { name: 'Keep history for' }) as HTMLSelectElement;
const choose = (value: string) => fireEvent.change(select(), { target: { value } });
const alertText = () => screen.getAllByRole('alert').map((node) => node.textContent ?? '').join('|');
const confirmGroup = (name: string) => screen.getByRole('group', { name });

describe('page states', () => {
  it('says it is loading, then shows the sections and the FIXTURE label', async () => {
    setDataScenario('data-none');
    render(<DataView />);
    expect(screen.getByText('Loading data controls…')).toBeTruthy();
    await flush();
    expect(screen.getByRole('heading', { level: 2, name: 'Data and collection' })).toBeTruthy();
    expect(document.querySelector('[data-mode="FIXTURE"]')?.textContent).toBe('FIXTURE — demo data. Nothing here changes your real data.');
    for (const name of ['Collection', 'History', 'Export', 'Uploaded images']) expect(section(name)).toBeTruthy();
  });

  it('explains an older backend without a retry button', async () => {
    await open('data-unsupported');
    expect(screen.getByText('This version of the app has no data controls')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it.each([
    ['data-failure', "The app's database is unavailable"],
    ['data-offline', 'Could not reach the app backend'],
  ] as const)('shows %s as words with Retry, and Retry recovers', async (scenario, words) => {
    await open(scenario);
    expect(screen.getByText('Could not load the data controls')).toBeTruthy();
    expect(alertText()).toContain(words);
    setDataScenario('data');
    await press('Retry');
    expect(screen.getByRole('heading', { level: 3, name: 'Collection' })).toBeTruthy();
  });

  it('keeps the last good body and says it is stale when a later poll fails', async () => {
    await open('data');
    vi.spyOn(useAppApi(), 'get').mockRejectedValue(new TypeError('Failed to fetch'));
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    await flush();
    expect(alertText()).toContain('Showing the last data that loaded. Could not reach the app backend');
    expect(screen.getByRole('heading', { level: 3, name: 'History' })).toBeTruthy();
  });

  it('fails closed on a reply that is not data-lifecycle v1', async () => {
    vi.spyOn(useAppApi(), 'get').mockResolvedValue({ contractVersion: 2 });
    render(<DataView />);
    await flush();
    expect(alertText()).toContain('a reply this page does not understand');
  });
});

describe('collection', () => {
  it('shows a running collector as not paused and pauses it, naming the gap', async () => {
    await open('data-none');
    expect(screen.getByText('Collection is not paused.')).toBeTruthy();
    await press('Pause collection');
    expect(screen.getByText('Collection paused. Nothing new is being recorded.')).toBeTruthy();
    expect(screen.getByText(/never as no activity/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume collection' })).toBeTruthy();
    expect(screen.getAllByRole('status').map((node) => node.textContent).join('|')).toContain('Collection paused.');
  });

  it('starts paused when the store says so, and resume announces it', async () => {
    await open('data-paused');
    expect(screen.getByText('Collection paused. Nothing new is being recorded.')).toBeTruthy();
    await press('Resume collection');
    expect(screen.getByText('Collection is not paused.')).toBeTruthy();
    expect(screen.getAllByRole('status').map((node) => node.textContent).join('|')).toContain('Collection resumed.');
    expect(screen.getByRole('button', { name: 'Pause collection' })).toBeTruthy();
  });

  it('shows the server state again after the next poll', async () => {
    await open('data-none');
    await press('Pause collection');
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    await flush();
    expect(screen.getByText('Collection paused. Nothing new is being recorded.')).toBeTruthy();
  });

  it('keeps keyboard focus on a button while its request is in flight: aria-disabled, never disabled, and a second press does nothing', async () => {
    await open('data-none');
    let release: (value: unknown) => void = () => undefined;
    const post = vi.spyOn(useAppApi(), 'post').mockReturnValue(new Promise((resolve) => (release = resolve)));
    const button = screen.getByRole('button', { name: 'Pause collection' }) as HTMLButtonElement;
    button.focus();
    fireEvent.click(button);
    await flush();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => release({ contractVersion: 1, paused: true, revision: 1, changedAtMs: 1, state: 'paused' }));
    await flush();
    expect(screen.getByRole('button', { name: /(Pause|Resume) collection/ }).getAttribute('aria-disabled')).toBeNull();
  });

  it('ignores Escape, Cancel and a second press on a confirmation while its request is in flight', async () => {
    await open('data');
    await press('Purge…');
    let release: (value: unknown) => void = () => undefined;
    const post = vi.spyOn(useAppApi(), 'post').mockReturnValue(new Promise((resolve) => (release = resolve)));
    const group = confirmGroup('Purge old history');
    fireEvent.click(within(group).getByRole('button', { name: 'Purge history' }));
    await flush();
    fireEvent.keyDown(group, { key: 'Escape' });
    fireEvent.click(within(group).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(group).getByRole('button', { name: 'Purge history' }));
    expect(screen.getByRole('group', { name: 'Purge old history' })).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => release({ contractVersion: 1 }));
    await flush();
    expect(within(confirmGroup('Purge old history')).getByRole('alert').textContent).toContain('a reply this page does not understand');
  });

  it('shows a failed pause in words and leaves the button usable', async () => {
    await open('data-none');
    vi.spyOn(useAppApi(), 'post').mockResolvedValue(new Response(JSON.stringify({ contractVersion: 1, error: 'collector_unavailable' }), { status: 503 }));
    await press('Pause collection');
    expect(alertText()).toContain('The collector is not available');
    expect((screen.getByRole('button', { name: 'Pause collection' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('retention', () => {
  it('offers Keep everything and the four windows, and saves only when changed', async () => {
    await open('data-none');
    expect([...select().options].map((option) => option.textContent)).toEqual(['Keep everything', '30 days', '90 days', '180 days', '365 days']);
    expect(select().value).toBe('');
    expect((screen.getByRole('button', { name: 'Save setting' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Keep everything is selected, so nothing is ever purged/)).toBeTruthy();
    choose('30');
    expect(screen.getByText(/Save the setting before you purge/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Purge…' }) as HTMLButtonElement).disabled).toBe(true);
    await press('Save setting');
    expect(select().value).toBe('30');
    expect(screen.getByText(/A purge now would delete history before/)).toBeTruthy();
    expect(screen.getByText(/1,200 observations, 3 quarantined records and 90 attempt records/)).toBeTruthy();
    expect(screen.getAllByRole('status').map((node) => node.textContent).join('|')).toContain('Retention setting saved. Nothing was deleted.');
    expect((screen.getByRole('button', { name: 'Save setting' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('can go back to Keep everything, which removes the preview', async () => {
    await open('data');
    choose('');
    await press('Save setting');
    expect(screen.queryByText(/A purge now would delete/)).toBeNull();
    expect(screen.getByText(/Keep everything is selected/)).toBeTruthy();
  });

  it('keeps a draft the owner has not saved when the poll answers', async () => {
    await open('data');
    choose('365');
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    await flush();
    expect(select().value).toBe('365');
  });

  it('shows a failed save in words and keeps the draft', async () => {
    await open('data-busy');
    choose('30');
    await press('Save setting');
    expect(alertText()).toContain('Another data action is already running');
    expect(select().value).toBe('30');
  });
});

describe('purge', () => {
  it('shows the preview and says what is never touched and that the file does not shrink', async () => {
    await open('data');
    expect(screen.getByText(/A purge now would delete history before .*: 3,600 observations, 9 quarantined records and 270 attempt records\./)).toBeTruthy();
    expect(screen.getByText(/never touches bot identity, hero assignment, avatars, work items, decisions or XP/)).toBeTruthy();
    expect(screen.getByText(/The database file does not shrink after a purge/)).toBeTruthy();
    expect(screen.getByText(/^History before .* was purged\. Coverage for that time is unknown\.$/)).toBeTruthy();
  });

  it('opens a confirmation with focus on its heading, and Escape closes it and returns focus to the opener', async () => {
    await open('data');
    await press('Purge…');
    const group = confirmGroup('Purge old history');
    expect(document.activeElement).toBe(within(group).getByRole('heading', { level: 4, name: 'Purge old history' }));
    expect(within(group).getByText(/Before it deletes anything the app writes a backup in data\/store\/backups\//)).toBeTruthy();
    expect(select().disabled).toBe(true);
    fireEvent.keyDown(group, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Purge old history' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Purge…' }));
  });

  it('cancels with the Cancel button', async () => {
    await open('data');
    await press('Purge…');
    fireEvent.click(within(confirmGroup('Purge old history')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Purge old history' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Purge…' }));
  });

  it('sends the saved window, shows the result, moves focus to it and leaves nothing to purge', async () => {
    await open('data');
    const post = vi.spyOn(useAppApi(), 'post');
    await press('Purge…');
    fireEvent.click(within(confirmGroup('Purge old history')).getByRole('button', { name: 'Purge history' }));
    await flush();
    expect(post).toHaveBeenCalledWith(`${PREFIX}/data/purge`, { retentionDays: 90 });
    expect(screen.queryByRole('group', { name: 'Purge old history' })).toBeNull();
    const result = screen.getByText(/^Last purge finished .*: deleted 3,600 observations, 9 quarantined records and 270 attempt records\.$/);
    expect(document.activeElement).toBe(result);
    expect(screen.getAllByRole('status').map((node) => node.textContent).join('|')).toContain('Purge finished.');
  });

  it('disables the purge button when nothing is older than the window', async () => {
    await open('data');
    vi.spyOn(useAppApi(), 'get').mockResolvedValue(
      dataBody({ retention: { retentionDays: 90, changedAtMs: 1, revision: 1 }, preview: { cutoffMs: 1, observations: 0, quarantine: 0, attempts: 0 } }),
    );
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    await flush();
    expect(screen.getByText('Nothing is older than the saved window, so there is nothing to purge.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Purge…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    ['data-backup-failed', 'The safety backup could not be written, so nothing was deleted.'],
    ['data-busy', 'Another data action is already running'],
  ] as const)('keeps the confirmation open and shows %s in words', async (scenario, words) => {
    await open(scenario);
    await press('Purge…');
    fireEvent.click(within(confirmGroup('Purge old history')).getByRole('button', { name: 'Purge history' }));
    await flush();
    expect(within(confirmGroup('Purge old history')).getByRole('alert').textContent).toContain(words);
  });

  it('closes the confirmation when the saved window changes underneath it', async () => {
    await open('data');
    await press('Purge…');
    await useAppApi().post(`${PREFIX}/data/retention`, { retentionDays: 30 });
    await act(async () => void (await vi.advanceTimersByTimeAsync(POLL_MS)));
    await flush();
    expect(screen.queryByRole('group', { name: 'Purge old history' })).toBeNull();
    expect(select().value).toBe('30');
  });

  it('says a purge is running and disables every write', async () => {
    await open('data-running');
    expect(screen.getByText(/A purge is running \(started .*\)\. Wait for it to finish\./)).toBeTruthy();
    for (const name of ['Save setting', 'Purge…', 'Export the store', 'Remove unused uploads…']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled, name).toBe(true);
    }
    expect(select().disabled).toBe(true);
  });

  it('says an interrupted purge stays deleted and can be run again', async () => {
    await open('data-interrupted');
    expect(screen.getByText(/was interrupted \(.*\) after it deleted 1,800 observations, 4 quarantined records and 0 attempt records\. What it deleted stays deleted\. Run it again to finish\./)).toBeTruthy();
    expect(screen.getByText(/^History before .* was purged\./)).toBeTruthy();
  });
});

describe('export', () => {
  it('says nothing was exported yet, then names the file under data/exports', async () => {
    await open('data-none');
    expect(screen.getByText('No export has been written yet.')).toBeTruthy();
    await press('Export the store');
    const list = within(section('Export')).getByRole('list', { name: 'Exports' });
    const name = within(list).getAllByRole('listitem')[0]?.querySelector('code')?.textContent ?? '';
    expect(name).toMatch(/^export-v9-\d{8}T\d{12}Z\.db$/);
    expect(screen.getByText(`Saved to data/exports/${name} in the app folder.`)).toBeTruthy();
    expect(within(list).getByText(/SHA-256 [0-9a-f]{64}/)).toBeTruthy();
    expect(within(list).getByText(/4 MB · /)).toBeTruthy();
  });

  it('lists the exports newest first', async () => {
    await open('data');
    await press('Export the store');
    expect(within(section('Export')).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows a failed export in words', async () => {
    await open('data-export-failed');
    await press('Export the store');
    expect(alertText()).toContain('The export could not be written. Nothing in the store changed.');
  });
});

describe('uploads', () => {
  it('shows usage and the unused count before anything is removed', async () => {
    await open('data');
    expect(screen.getByText('12 of 100 uploaded images stored.')).toBeTruthy();
    expect(screen.getByText('3 uploaded images are not used by any avatar, current or past.')).toBeTruthy();
    expect(screen.getByText(/Only uploads older than one hour that no avatar uses are removed\. Bundled art is never removed\./)).toBeTruthy();
  });

  it('removes unused uploads after a confirmation and moves focus to the result', async () => {
    await open('data');
    await press('Remove unused uploads…');
    const group = confirmGroup('Remove unused uploads');
    expect(document.activeElement).toBe(within(group).getByRole('heading', { level: 4 }));
    expect(within(group).getByText(/removes up to 3 uploaded images/)).toBeTruthy();
    fireEvent.click(within(group).getByRole('button', { name: 'Remove unused uploads' }));
    await flush();
    expect(screen.getByText('9 of 100 uploaded images stored.')).toBeTruthy();
    expect(screen.getByText('Every uploaded image is used by an avatar.')).toBeTruthy();
    const result = screen.getByText(/^Last upload cleanup finished .*: removed 3 uploaded images\.$/);
    expect(document.activeElement).toBe(result);
    expect((screen.getByRole('button', { name: 'Remove unused uploads…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('cancels, restoring focus to the opener', async () => {
    await open('data');
    await press('Remove unused uploads…');
    fireEvent.keyDown(confirmGroup('Remove unused uploads'), { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove unused uploads…' }));
  });

  it('says the cap is reached', async () => {
    await open('data-full');
    expect(screen.getByText('100 of 100 uploaded images stored.')).toBeTruthy();
    expect(screen.getByText(/The upload limit is reached/)).toBeTruthy();
  });

  it('disables the button when nothing is unused', async () => {
    await open('data-none');
    expect(screen.getByText('Every uploaded image is used by an avatar.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Remove unused uploads…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the confirmation open and shows a failed cleanup in words', async () => {
    await open('data-backup-failed');
    await press('Remove unused uploads…');
    fireEvent.click(within(confirmGroup('Remove unused uploads')).getByRole('button', { name: 'Remove unused uploads' }));
    await flush();
    expect(within(confirmGroup('Remove unused uploads')).getByRole('alert').textContent).toContain('safety backup could not be written');
  });
});
