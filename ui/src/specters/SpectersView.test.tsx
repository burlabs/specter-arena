import { useAppApi } from '@kirocrew/app-sdk';
import { setSpecterScenario } from '@kirocrew/app-sdk';
import type { SpecterScenarioName } from '@kirocrew/app-sdk';
import { rosterBody } from '@kirocrew/app-sdk';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RosterItemV1 } from '../contracts/types';
import { clearAssetCache } from './assetCache';
import { SpectersView } from './SpectersView';
import { useSpecters } from './useSpecters';

const bots = rosterBody('default').items;

function Harness({ items = bots, complete = true }: { items?: readonly RosterItemV1[]; complete?: boolean }) {
  const specters = useSpecters();
  return <SpectersView bots={items} complete={complete} specters={specters} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  clearAssetCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = async () => {
  for (let index = 0; index < 4; index += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};

async function open(scenario: SpecterScenarioName, props: Parameters<typeof Harness>[0] = {}) {
  setSpecterScenario(scenario);
  render(<Harness {...props} />);
  await flush();
}

const list = () => screen.getByRole('list', { name: 'Bots with Specters' });
const rowFor = (name: string) => within(list()).getByRole('button', { name: new RegExp(`^${name}`) });

describe('SpectersView states', () => {
  it('says it is loading, then lists every bot with No Specter yet', async () => {
    setSpecterScenario('specters-none');
    render(<Harness />);
    expect(screen.getByRole('status').textContent).toBe('Loading Specters…');
    await flush();
    expect(within(list()).getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getAllByText('No Specter yet')).toHaveLength(7);
    expect(screen.getByText('Select a bot to see its Specter.')).toBeTruthy();
  });

  it('shows each bot with its Specter name', async () => {
    await open('specters');
    expect(rowFor('Atlas').textContent).toContain('Vesper');
    expect(rowFor('Brindle').textContent).toContain('Wren');
    expect(rowFor('Cinder').textContent).toContain('Thistle');
    expect(rowFor('Dune').textContent).toContain('No Specter yet');
  });

  it('explains an old backend instead of showing an error', async () => {
    vi.spyOn(useAppApi(), 'get').mockResolvedValue(new Response('{}', { status: 404 }));
    render(<Harness />);
    await flush();
    expect(screen.getByText('This version of the app backend does not support Specters yet.')).toBeTruthy();
  });

  it('shows an error with Retry for other failures, and Retry reloads', async () => {
    const get = vi.spyOn(useAppApi(), 'get').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Harness />);
    await flush();
    expect(screen.getByRole('alert').textContent).toContain('Could not reach the app backend');
    get.mockRestore();
    setSpecterScenario('specters-none');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush();
    expect(list()).toBeTruthy();
  });

  it('names a server failure differently from being offline', async () => {
    vi.spyOn(useAppApi(), 'get').mockResolvedValue(new Response('{"error":"store_unavailable"}', { status: 503 }));
    render(<Harness />);
    await flush();
    expect(screen.getByRole('alert').textContent).toContain('database is unavailable');
  });

  it('says so when the roster is empty', async () => {
    await open('specters-none', { items: [] });
    expect(screen.getByText('No bots are on the roster yet')).toBeTruthy();
  });

  it('says a selected bot left the roster once the roster is complete', async () => {
    setSpecterScenario('specters-none');
    const view = render(<Harness />);
    await flush();
    fireEvent.click(rowFor('Atlas'));
    view.rerender(<Harness items={bots.slice(1)} />);
    await flush();
    expect(screen.getByRole('status').textContent).toBe('This bot is no longer on the roster.');
  });

  it('keeps asking to select while the roster is still incomplete', async () => {
    setSpecterScenario('specters-none');
    const view = render(<Harness complete={false} />);
    await flush();
    fireEvent.click(rowFor('Atlas'));
    view.rerender(<Harness items={bots.slice(1)} complete={false} />);
    await flush();
    expect(screen.getByText('Select a bot to see its Specter.')).toBeTruthy();
  });
});

describe('SpectersView keyboard and selection', () => {
  it('has one tab stop that follows the arrow keys, Home and End', async () => {
    await open('specters');
    const rows = within(list()).getAllByRole('button');
    expect(rows.filter((row) => row.tabIndex === 0)).toHaveLength(1);
    expect(rows[0]?.tabIndex).toBe(0);
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(list(), { key: 'End' });
    expect(document.activeElement).toBe(rows[6]);
    fireEvent.keyDown(list(), { key: 'Home' });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(list(), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[0]);
    const before = document.activeElement;
    fireEvent.keyDown(list(), { key: 'x' });
    expect(document.activeElement).toBe(before);
  });

  it('marks the selected bot and shows its Specter in the detail panel', async () => {
    await open('specters');
    fireEvent.click(rowFor('Atlas'));
    expect(rowFor('Atlas').getAttribute('aria-current')).toBe('true');
    const detail = screen.getByRole('region', { name: 'Specter detail' });
    expect(within(detail).getByRole('heading', { level: 2, name: 'Vesper' })).toBeTruthy();
    expect(detail.textContent).toContain('Who waits at the door');
    expect(detail.textContent).toContain('Generated through Crew, prompt version summon-1');
  });

  it('shows the bot name and No Specter yet for a bot without one', async () => {
    await open('specters');
    fireEvent.click(rowFor('Dune'));
    const detail = screen.getByRole('region', { name: 'Specter detail' });
    expect(within(detail).getByRole('heading', { level: 2, name: 'Dune' })).toBeTruthy();
    expect(detail.textContent).toContain('No Specter yet');
  });

  it('renders long text as text, never as markup', async () => {
    await open('specters-none');
    fireEvent.click(rowFor('Atlas'));
    fireEvent.click(screen.getByRole('button', { name: 'Write one by hand' }));
    const form = screen.getByRole('form', { name: 'Write a Specter by hand' });
    const hostile = '<img src=x onerror=alert(1)>';
    fireEvent.change(within(form).getByLabelText(/^Name/), { target: { value: 'Ok' } });
    for (const label of ['Personality', 'Appearance', 'Mannerism', 'Why this fits', 'Art brief']) {
      fireEvent.change(within(form).getByLabelText(new RegExp(`^${label}`)), { target: { value: label === 'Appearance' ? hostile : 'fine' } });
    }
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await flush();
    const detail = screen.getByRole('region', { name: 'Specter detail' });
    expect(detail.textContent).toContain(hostile);
    expect(detail.querySelector('img[onerror]')).toBeNull();
    expect(detail.textContent).toContain('Written by you');
  });
});
