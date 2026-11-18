import { rosterBody, setWorkScenario } from '@kirocrew/app-sdk';
import type { WorkScenarioName } from '@kirocrew/app-sdk';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { WorkView } from './WorkView';

/** Lets fake timers run every pending fixture response and the renders that follow. */
export const flush = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
};

export const bots = rosterBody('default').items;

export async function openWork(scenario: WorkScenarioName, props: { onLedgerChanged?: () => void; complete?: boolean } = {}): Promise<void> {
  setWorkScenario(scenario);
  render(<WorkView bots={bots} complete={props.complete ?? true} onLedgerChanged={props.onLedgerChanged ?? (() => undefined)} />);
  await flush();
}

export const detail = () => screen.getByRole('region', { name: 'Work detail' });
export const workList = () => screen.getByRole('list', { name: 'Work items' });

export async function selectItem(title: string): Promise<void> {
  fireEvent.click(within(workList()).getByRole('button', { name: new RegExp(`^${title}`) }));
  await flush();
}

export const click = async (name: string | RegExp, scope: () => HTMLElement = detail): Promise<void> => {
  fireEvent.click(within(scope()).getByRole('button', { name }));
  await flush();
};

export const announced = (): string => screen.getAllByRole('status').map((node) => node.textContent ?? '').join('|');
