import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { rosterBody } from '@kirocrew/app-sdk';
import { WorkList, xpChipOf } from './WorkList';
import { ATLAS, BRINDLE, itemOf } from './testData';

const bots = rosterBody('default').items;
const item = (n: number, extra: Parameters<typeof itemOf>[0] = {}) => itemOf({ workId: `wrk_${String(n).repeat(24)}`, title: `Item ${n}`, ...extra });
const items = [item(1), item(2), item(3)];

const rows = () => within(screen.getByRole('list', { name: 'Work items' })).getAllByRole('button');

describe('WorkList (WL-1..WL-4)', () => {
  it('shows each row with its state, progress, XP chip and contributor names from the roster (WL-1, WL-2)', () => {
    render(
      <WorkList
        items={[
          item(1, { state: 'awaiting-review', progress: { done: 1, total: 3 }, contributors: [{ bindingId: ATLAS, attemptCount: 1, xpNet: 0 }, { bindingId: 'bnd_ffffffffffffffffffffffff', attemptCount: 1, xpNet: 0 }] }),
        ]}
        selectedId={null}
        bots={bots}
        onSelect={() => undefined}
      />,
    );
    const row = rows()[0] as HTMLElement;
    expect(row.textContent).toContain('Item 1');
    expect(row.textContent).toContain('Awaiting your review');
    expect(row.textContent).toContain('1 of 3 milestones done');
    expect(row.textContent).toContain('100 XP when accepted');
    expect(row.textContent).toContain('Atlas, Unknown bot (bnd_ffff…ffff)');
  });

  it('says no bots are linked and shows unknown progress', () => {
    render(<WorkList items={[item(1)]} selectedId={null} bots={bots} onSelect={() => undefined} />);
    expect(rows()[0]?.textContent).toContain('No bots linked');
    expect(rows()[0]?.textContent).toContain('Progress unknown');
  });

  it('words the XP chip for each kind of item', () => {
    expect(xpChipOf(item(1, { childCount: 2 }))).toBe('Groups parts');
    expect(xpChipOf(item(1, { rewardable: false, bountyXp: 0 }))).toBe('No XP');
    expect(xpChipOf(item(1, { contributors: [{ bindingId: ATLAS, attemptCount: 1, xpNet: 50 }, { bindingId: BRINDLE, attemptCount: 1, xpNet: 50 }] }))).toBe('100 XP awarded');
    expect(xpChipOf(item(1))).toBe('100 XP when accepted');
  });

  it('keeps one tab stop and moves with the arrows, Home and End (WL-3, K-2)', () => {
    render(<WorkList items={items} selectedId={null} bots={bots} onSelect={() => undefined} />);
    expect(rows().filter((row) => row.tabIndex === 0)).toHaveLength(1);
    const list = screen.getByRole('list', { name: 'Work items' });
    fireEvent.keyDown(rows()[0] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows()[1]);
    fireEvent.keyDown(list, { key: 'End' });
    expect(document.activeElement).toBe(rows()[2]);
    expect(rows()[2]?.tabIndex).toBe(0);
    expect(rows()[0]?.tabIndex).toBe(-1);
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows()[1]);
    fireEvent.keyDown(list, { key: 'Home' });
    expect(document.activeElement).toBe(rows()[0]);
    fireEvent.keyDown(list, { key: 'x' });
    expect(document.activeElement).toBe(rows()[0]);
  });

  it('selects on click or Enter and marks the selected row (WL-4, K-3)', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<WorkList items={items} selectedId={null} bots={bots} onSelect={onSelect} />);
    fireEvent.click(rows()[1] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(items[1]?.workId);
    rerender(<WorkList items={items} selectedId={items[2]?.workId ?? null} bots={bots} onSelect={onSelect} />);
    expect(rows()[2]?.getAttribute('aria-current')).toBe('true');
    expect(rows()[2]?.tabIndex).toBe(0);
    expect(rows().filter((row) => row.getAttribute('aria-current') === 'true')).toHaveLength(1);
  });

  it('starts the roving stop on the first row when the selected row has left the list', () => {
    render(<WorkList items={items} selectedId="wrk_gone" bots={bots} onSelect={() => undefined} />);
    expect(rows()[0]?.tabIndex).toBe(0);
  });
});
