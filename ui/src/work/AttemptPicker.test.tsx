import { useAppApi } from '@kirocrew/app-sdk';
import { setFixtureScenario, attemptsBody } from '@kirocrew/app-sdk';
import type { ScenarioName } from '@kirocrew/app-sdk';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttemptPicker } from './AttemptPicker';
import type { PickedAttempt } from './AttemptPicker';
import { bots, flush } from './testHarness';
import { ATLAS, BRINDLE } from './testData';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function Harness({ linked = new Map<string, string>(), max = 16, single = false }: { linked?: Map<string, string>; max?: number; single?: boolean }) {
  const [picked, setPicked] = useState<ReadonlyMap<string, PickedAttempt>>(new Map());
  const toggle = (attempt: PickedAttempt) =>
    setPicked((previous) => {
      const next = new Map(single ? [] : previous);
      if (previous.has(attempt.attemptId)) next.delete(attempt.attemptId);
      else next.set(attempt.attemptId, attempt);
      return next;
    });
  return <AttemptPicker bots={bots} selected={picked} linked={linked} max={max} single={single} onToggle={toggle} />;
}

async function chooseBot(bindingId: string, scenario: ScenarioName = 'default') {
  setFixtureScenario(scenario);
  fireEvent.change(screen.getByRole('combobox', { name: 'Bot' }), { target: { value: bindingId } });
  await flush();
}

const boxes = () => screen.getAllByRole('checkbox') as HTMLInputElement[];

describe('AttemptPicker (AP-1..AP-6)', () => {
  it('lists the chosen bot’s attempts, each marked Ended or Still open (AP-1, AP-5)', async () => {
    render(<Harness />);
    expect(screen.getByText('No attempts selected.')).toBeTruthy();
    await chooseBot(ATLAS);
    const labels = boxes().map((box) => box.closest('label')?.textContent ?? '');
    expect(labels).toHaveLength(3);
    expect(labels.filter((label) => label.includes('Ended'))).toHaveLength(1);
    expect(labels.filter((label) => label.includes('Still open'))).toHaveLength(2);
  });

  it('keeps selections from two bots in the summary when the bot changes (AP-2)', async () => {
    render(<Harness />);
    await chooseBot(ATLAS);
    fireEvent.click(boxes()[2] as HTMLInputElement);
    await chooseBot(BRINDLE);
    fireEvent.click(boxes()[0] as HTMLInputElement);
    expect(screen.getByText('2 of 16 selected')).toBeTruthy();
    const summary = within(screen.getByRole('list', { name: 'Selected attempts' })).getAllByRole('listitem');
    expect(summary.map((row) => row.textContent?.split(' · ')[0])).toEqual(['Atlas', 'Brindle']);
  });

  it('disables an attempt that another item tracks and says which (AP-3)', async () => {
    render(<Harness linked={new Map([['att_cccccccccccccccc00010003', 'Reconcile the Q3 invoices']])} />);
    await chooseBot(ATLAS);
    const taken = boxes().find((box) => box.closest('label')?.textContent?.includes('Tracked in'));
    expect(taken?.disabled).toBe(true);
    expect(screen.getByText('Tracked in Reconcile the Q3 invoices')).toBeTruthy();
  });

  it('stops at the maximum with a message, but still lets a ticked row be cleared (AP-4)', async () => {
    render(<Harness max={2} />);
    await chooseBot(ATLAS);
    fireEvent.click(boxes()[0] as HTMLInputElement);
    fireEvent.click(boxes()[1] as HTMLInputElement);
    expect(boxes()[2]?.disabled).toBe(true);
    expect(boxes()[0]?.disabled).toBe(false);
    expect(screen.getByText('You can track up to 2 attempts in one item.')).toBeTruthy();
    fireEvent.click(boxes()[0] as HTMLInputElement);
    expect(boxes()[2]?.disabled).toBe(false);
  });

  it('replaces the choice in single mode and never hits the cap', async () => {
    render(<Harness single />);
    await chooseBot(ATLAS);
    expect(screen.getByText('Choose one attempt')).toBeTruthy();
    fireEvent.click(boxes()[0] as HTMLInputElement);
    fireEvent.click(boxes()[1] as HTMLInputElement);
    expect(boxes().filter((box) => box.checked)).toHaveLength(1);
    expect(boxes()[1]?.checked).toBe(true);
  });

  it('says it is loading, failed, empty or that the bot has left', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Bot' }), { target: { value: ATLAS } });
    expect(screen.getByRole('status').textContent).toBe('Loading attempts…');
    await flush();
    await chooseBot(ATLAS, 'offline');
    fireEvent.change(screen.getByRole('combobox', { name: 'Bot' }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Bot' }), { target: { value: BRINDLE } });
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('Could not load attempts for this bot.');
    await chooseBot(ATLAS, 'attempt-gone');
    fireEvent.change(screen.getByRole('combobox', { name: 'Bot' }), { target: { value: BRINDLE } });
    await flush();
    expect(screen.getByRole('status').textContent).toBe('This bot is no longer on the roster.');
    setFixtureScenario('default');
    fireEvent.change(screen.getByRole('combobox', { name: 'Bot' }), { target: { value: bots[3]?.bindingId } });
    await flush();
    expect(screen.getByText('This bot has no recorded attempts.')).toBeTruthy();
  });

  it('loads older attempts on request and reports a failure (AP-6)', async () => {
    const client = useAppApi();
    const original = client.get.bind(client);
    const base = attemptsBody('default', ATLAS);
    if (base === null) throw new Error('fixture');
    vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
      if (!path.includes('/attempts')) return original(path);
      if (path.includes('cursor=c1')) {
        const [first] = base.items;
        return new Response(JSON.stringify({ ...base, items: [{ ...(first as object), attemptId: 'att_eeeeeeeeeeeeeeeeeeeeeeee' }], nextCursor: null }));
      }
      return new Response(JSON.stringify({ ...base, nextCursor: 'c1' }));
    });
    render(<Harness />);
    await chooseBot(ATLAS);
    expect(boxes()).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Load older attempts' }));
    await flush();
    expect(boxes()).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Load older attempts' })).toBeNull();
  });

  it('reports an older page that fails', async () => {
    const client = useAppApi();
    const original = client.get.bind(client);
    const base = attemptsBody('default', ATLAS);
    if (base === null) throw new Error('fixture');
    vi.spyOn(client, 'get').mockImplementation(async (path: string) => {
      if (!path.includes('/attempts')) return original(path);
      if (path.includes('cursor=c1')) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ ...base, nextCursor: 'c1' }));
    });
    render(<Harness />);
    await chooseBot(ATLAS);
    fireEvent.click(screen.getByRole('button', { name: 'Load older attempts' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('Could not load older attempts. Try again.');
  });
});
