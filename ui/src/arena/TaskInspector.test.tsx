import { act, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskItemV1 } from '../contracts/types';
import { TaskInspector } from './TaskInspector';
import { buildSceneModel } from './sceneModel';
import { NOW, botOf, creditedOf, inputsOf, notCreditedOf, taskOf } from './testData';

const api = vi.hoisted(() => ({ mode: 'FIXTURE', getJson: vi.fn(), postJson: vi.fn() }));
vi.mock('../host', async (original) => ({ ...(await original<typeof import('../host')>()), useHostApi: () => api }));

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const bot = botOf(1, { displayName: 'Atlas' });
const list = buildSceneModel(inputsOf({ roster: [bot] }));

async function show(task: TaskItemV1) {
  api.getJson.mockResolvedValue(task);
  const view = render(<TaskInspector taskId={task.taskId} headingRef={createRef<HTMLHeadingElement>()} list={list} bots={[bot]} known={undefined} onClose={vi.fn()} />);
  await flush();
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  api.getJson.mockReset();
});
afterEach(() => vi.useRealTimers());

const facts = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const dt of document.querySelectorAll('dt')) out[dt.textContent ?? ''] = dt.nextElementSibling?.textContent ?? '';
  return out;
};

describe('TaskInspector', () => {
  it('shows the evidence of a credited task and says it was credited automatically', async () => {
    await show(creditedOf(1, bot, { kind: 'worker', runMs: 600_000 }));
    expect(screen.getByRole('heading', { level: 2, name: 'Worker task · 10 min' })).toBeTruthy();
    expect(screen.getByText('Auto-credited when the task ended cleanly.')).toBeTruthy();
    const values = facts();
    expect(values.Kind).toBe('Worker task');
    expect(values.Bot).toBe('Atlas');
    expect(values['Run time']).toBe('10 min');
    expect(values['Size class']).toBe('Medium, ran 2 to under 15 minutes');
    expect(values['Close-out']).toBe('Credited');
    expect(values['XP credited']).toBe('12 XP (xp-policy-2)');
    expect(values.Policy).toBe('xp-policy-2');
    expect(values.Started).not.toBe('');
    expect(values.Ended).not.toBe(values.Started);
  });

  it.each([
    ['unknown-terminal', 'Not credited: this task ended in a way the app could not read as a clean end.'],
    ['coverage-gap', 'Not credited: a collection gap overlapped this task.'],
    ['waiting-at-end', 'Not credited: an approval or a question was still pending when it ended.'],
  ] as const)('says why a %s task earned nothing', async (reason, words) => {
    await show(notCreditedOf(1, bot, reason));
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.queryByText('Auto-credited when the task ended cleanly.')).toBeNull();
    expect(facts()['XP credited']).toBe('No XP');
    expect(facts()['Close-out']).toBe('Not credited');
  });

  it('describes an open running task, an open task that is no longer observed, and one that has ended and awaits close-out', async () => {
    const view = await show(taskOf(1, bot));
    expect(screen.getByText('Open: still running. It closes by itself when it ends.')).toBeTruthy();
    expect(facts().Ended).toBe('Still running');
    expect(facts()['XP credited']).toBe('No XP yet');
    view.unmount();
    const second = await show(taskOf(2, bot, { attemptState: 'unknown' }));
    expect(screen.getByText('Open: the app can no longer observe this task, so it cannot be closed yet.')).toBeTruthy();
    expect(facts().Ended).toBe('Not observed');
    second.unmount();
    await show(taskOf(3, bot, { attemptState: 'ended', endedAtMs: NOW - 1_000 }));
    expect(screen.getByText('Open: it has ended and is waiting to be closed out.')).toBeTruthy();
  });

  it('keeps size to run time: the note says it is not progress, health or effort', async () => {
    await show(taskOf(1, bot, { runMs: 1_000_000 }));
    expect(facts()['Size class']).toBe('Large, ran 15 minutes or more');
    expect(screen.getByText('Size follows how long the task has run. It does not show progress, health or remaining effort.')).toBeTruthy();
    expect(screen.getByText('XP follows what the app observed. It is not a check that the outcome was right.')).toBeTruthy();
  });

  it('offers no accept, reject, reopen or other write control', async () => {
    await show(creditedOf(1, bot));
    const inspector = document.body;
    for (const name of [/accept/i, /reject/i, /reopen/i, /submit/i, /block/i, /cancel/i]) expect(within(inspector).queryByRole('button', { name })).toBeNull();
    expect(api.postJson).not.toHaveBeenCalled();
  });

  it('shows the loading heading with the arena label while the evidence is on its way', () => {
    api.getJson.mockReturnValue(new Promise(() => undefined));
    render(<TaskInspector taskId="tsk_1" headingRef={createRef<HTMLHeadingElement>()} list={list} bots={[bot]} known={taskOf(1, bot, { kind: 'bot-turn', runMs: 90_000 })} onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Bot turn · 1 min' })).toBeTruthy();
    expect(screen.getByText('Loading evidence…')).toBeTruthy();
  });

  it('falls back to a plain heading while loading with no known task', () => {
    api.getJson.mockReturnValue(new Promise(() => undefined));
    render(<TaskInspector taskId="tsk_1" headingRef={createRef<HTMLHeadingElement>()} list={list} bots={[bot]} known={undefined} onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Task' })).toBeTruthy();
  });
});
