import { act, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkDecisionV1 } from '../contracts/types';
import { itemOf } from '../work/testData';
import { WorkInspector } from './WorkInspector';
import { buildSceneModel } from './sceneModel';
import { botOf, inputsOf } from './testData';

const api = vi.hoisted(() => ({ mode: 'FIXTURE', getJson: vi.fn(), postJson: vi.fn() }));
vi.mock('../host', async (original) => ({ ...(await original<typeof import('../host')>()), useHostApi: () => api }));

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const bot = botOf(1, { displayName: 'Atlas' });
const list = buildSceneModel(inputsOf({ roster: [bot] }));

const decision = (seq: number, action: string, note: string | null): WorkDecisionV1 => ({
  decisionId: `dec_${seq}`,
  seq,
  action,
  fromState: 'open',
  toState: action === 'block' ? 'blocked' : 'awaiting-review',
  actor: 'app-owner',
  atMs: 1_000 * seq,
  note,
  evidenceRevision: null,
});

async function show(item: ReturnType<typeof itemOf>, decisionId: string | null = null) {
  api.getJson.mockResolvedValue(item);
  const view = render(
    <WorkInspector workId={item.workId} decisionId={decisionId} headingRef={createRef<HTMLHeadingElement>()} list={list} bots={[bot]} known={undefined} onClose={vi.fn()} onLedgerChanged={vi.fn()} onWorkChanged={vi.fn()} />,
  );
  await flush();
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  api.getJson.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('WorkInspector', () => {
  it('says no reason was written for a block without a note, and uses the newest block note otherwise', async () => {
    const view = await show(itemOf({ state: 'blocked', decisions: [decision(1, 'block', null)] }));
    expect(screen.getByText('Blocked. No reason was written.')).toBeTruthy();
    view.unmount();
    await show(itemOf({ state: 'blocked', decisions: [decision(1, 'block', 'old reason'), decision(2, 'block', 'new reason')] }));
    expect(screen.getByText('Blocked because: new reason')).toBeTruthy();
  });

  it('marks the decision an XP entry pointed at and no other', async () => {
    await show(itemOf({ decisions: [decision(1, 'submit', null), decision(2, 'block', 'x')] }), 'dec_1');
    const marked = document.querySelectorAll('[aria-current="true"]');
    expect(marked).toHaveLength(1);
    expect(within(marked[0] as HTMLElement).getByText('Opened from an XP entry')).toBeTruthy();
  });

  it('shows the loading heading with the arena title while the evidence is on its way', () => {
    api.getJson.mockReturnValue(new Promise(() => undefined));
    render(
      <WorkInspector workId="wrk_1" decisionId={null} headingRef={createRef<HTMLHeadingElement>()} list={list} bots={[bot]} known={itemOf({ title: 'Known title' })} onClose={vi.fn()} onLedgerChanged={vi.fn()} onWorkChanged={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Known title' })).toBeTruthy();
    expect(screen.getByText('Loading evidence…')).toBeTruthy();
  });

  it('explains a container by its parts and an unrewarded item by saying it earns nothing', async () => {
    const view = await show(itemOf({ childCount: 3, childrenAccepted: 1 }));
    expect(screen.getByText('1 of 3 parts accepted')).toBeTruthy();
    expect(screen.getByText('Groups 3 parts and earns no XP itself')).toBeTruthy();
    view.unmount();
    await show(itemOf({ rewardable: false }));
    expect(screen.getByText('Tracked without XP')).toBeTruthy();
  });
});
