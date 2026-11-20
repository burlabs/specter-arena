import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArenaListView } from './ArenaListView';
import { ArenaMinimap } from './ArenaMinimap';
import { ArenaRail } from './ArenaRail';
import { assignSlots, placeScene, slotIdsOf } from './sceneLayout';
import { buildSceneModel } from './sceneModel';
import { NOW, attemptOf, botOf, inputsOf, specterOf, workOf, xpOf } from './testData';

const atlas = botOf(1, { displayName: 'Atlas', state: 'working' });
const brindle = botOf(2, { displayName: 'Brindle' });
const dune = botOf(3, { displayName: 'Dune', state: 'unknown' });
const bots = [atlas, brindle, dune];
const parent = workOf(1, { title: 'Quarter close', childCount: 1, childrenAccepted: 0 });
const work = [
  parent,
  workOf(2, { title: 'Books', parentId: parent.workId, state: 'blocked', attempts: [attemptOf(atlas, 1)] }),
  workOf(3, { title: 'Review me', state: 'awaiting-review', progress: { done: 1, total: 2 } }),
  workOf(4, { title: 'Shipped', state: 'accepted', updatedAtMs: NOW, contributors: [{ bindingId: atlas.bindingId, attemptCount: 1, xpNet: 100 }] }),
  workOf(5, { title: 'Plain', contributors: [{ bindingId: brindle.bindingId, attemptCount: 1, xpNet: 0 }] }),
];
const specters = new Map([[atlas.bindingId, specterOf(atlas, 'Vesper')]]);
const inputs = inputsOf({ roster: bots, specters: [...specters.values()], xp: [xpOf(atlas, 100, 2)], work });
const model = buildSceneModel(inputs);
const items = new Map(work.map((item) => [item.workId, item]));

describe('ArenaRail', () => {
  it('lists every Specter once with the roster words, selects and collapses', () => {
    const onSelect = vi.fn();
    render(<ArenaRail model={model} bots={bots} specters={specters} xp={new Map([[atlas.bindingId, xpOf(atlas, 100, 2)]])} selection={{ kind: 'specter', bindingId: brindle.bindingId }} onSelect={onSelect} />);
    const rail = screen.getByRole('complementary', { name: 'Specters' });
    expect(within(rail).getAllByRole('listitem')).toHaveLength(3);
    expect(within(rail).getByText('Vesper')).toBeTruthy();
    expect(within(rail).getByText('for Atlas')).toBeTruthy();
    expect(within(rail).getByText('Working')).toBeTruthy();
    expect(within(rail).getByText('No turn running')).toBeTruthy();
    expect(within(rail).getByText('Unknown')).toBeTruthy();
    expect(within(rail).getByText('Level 2')).toBeTruthy();
    expect(within(rail).getByText('100 XP')).toBeTruthy();
    expect(within(rail).getByText('1 open attempt')).toBeTruthy();
    expect(within(rail).getAllByText('Level 1')).toHaveLength(2);
    expect(within(rail).queryAllByRole('progressbar')).toHaveLength(0);
    expect(rail.querySelectorAll('.sa-xp-bar[aria-hidden="true"]')).toHaveLength(1);
    const pressed = within(rail).getAllByRole('button', { pressed: true });
    expect(pressed).toHaveLength(1);
    fireEvent.click(within(rail).getByText('Vesper'));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'specter', bindingId: atlas.bindingId });
    const toggle = within(rail).getByRole('button', { name: 'Hide Specter rail' });
    fireEvent.click(toggle);
    expect(within(rail).getByRole('button', { name: 'Show Specter rail' }).getAttribute('aria-expanded')).toBe('false');
  });
});

describe('ArenaMinimap', () => {
  const placement = placeScene(model, assignSlots(new Map(), slotIdsOf(model)));

  it('draws one dot per placed token and a frame for the view, and toggles', () => {
    const onToggle = vi.fn();
    const { container } = render(<ArenaMinimap placement={placement} view={{ x: 0.1, y: 0.2, width: 0.5, height: 0.4 }} hasMap open onToggle={onToggle} />);
    expect(screen.getByRole('img', { name: 'Arena overview' })).toBeTruthy();
    expect(container.querySelectorAll('.sa-arena-minimap__dot')).toHaveLength(placement.specters.size + placement.enemies.size);
    expect(container.querySelector<HTMLElement>('.sa-arena-minimap__view')?.style.width).toBe('50%');
    fireEvent.click(screen.getByRole('button', { name: 'Hide overview' }));
    expect(onToggle).toHaveBeenCalled();
  });

  it('draws three decorative structure markers at the layout points', () => {
    const { container } = render(<ArenaMinimap placement={placement} view={{ x: 0, y: 0, width: 1, height: 1 }} hasMap open onToggle={vi.fn()} />);
    const markers = [...container.querySelectorAll<HTMLElement>('.sa-arena-minimap__structure')];
    expect(markers.map((marker) => marker.dataset.structure)).toEqual(['sanctum', 'citadel', 'camp']);
    expect(markers.map((marker) => [marker.style.left, marker.style.top])).toEqual([
      ['16.21%', '71.2%'],
      ['82.06%', '15.94%'],
      ['48.09%', '63.66%'],
    ]);
    for (const marker of markers) {
      expect(marker.getAttribute('aria-hidden')).toBe('true');
      expect(marker.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(marker.querySelector('title')).toBeNull();
    }
  });

  it('paints the map behind the frame only when there is a map', () => {
    const { container, rerender } = render(<ArenaMinimap placement={placement} view={{ x: 0, y: 0, width: 1, height: 1 }} hasMap open onToggle={vi.fn()} />);
    expect(container.querySelector('.sa-arena-minimap__frame')?.className).toContain('sa-has-art');
    rerender(<ArenaMinimap placement={placement} view={{ x: 0, y: 0, width: 1, height: 1 }} hasMap={false} open onToggle={vi.fn()} />);
    expect(container.querySelector('.sa-arena-minimap__frame')?.className).not.toContain('sa-has-art');
  });

  it('hides the panel when closed', () => {
    const { container } = render(<ArenaMinimap placement={placement} view={{ x: 0, y: 0, width: 1, height: 1 }} hasMap open={false} onToggle={vi.fn()} />);
    expect(container.querySelector('[hidden]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Show overview' }).getAttribute('aria-expanded')).toBe('false');
  });
});

describe('ArenaListView', () => {
  const drawn = new Set(model.enemies.filter((enemy) => enemy.workId !== work[4]!.workId).map((enemy) => enemy.workId));
  const view = (selection = null as null | { kind: 'work'; workId: string }, onSelect = vi.fn(), listModel = model) =>
    render(<ArenaListView model={listModel} bots={bots} items={items} drawn={drawn} selection={selection} onSelect={onSelect} />);
  const rowsOf = (caption: string) => within(screen.getByRole('table', { name: caption })).getAllByRole('row').slice(1);

  it('lists every Specter and every enemy, with the mode label in its heading', () => {
    view();
    expect(rowsOf('Specters')).toHaveLength(3);
    expect(rowsOf('Work')).toHaveLength(5);
    expect(within(screen.getByRole('region', { name: 'Arena list' })).getByText('FIXTURE — demo data, not Crew activity')).toBeTruthy();
  });

  it('prints state, progress, contributors and XP in the words of the Work tab', () => {
    view();
    const shipped = rowsOf('Work').find((row) => within(row).queryByText('Shipped') !== null)!;
    expect(within(shipped).getByText('Accepted')).toBeTruthy();
    expect(within(shipped).getByText('Atlas')).toBeTruthy();
    expect(within(shipped).getByText('100 XP awarded')).toBeTruthy();
    const review = rowsOf('Work').find((row) => within(row).queryByText('Review me') !== null)!;
    expect(within(review).getByText('Awaiting your review')).toBeTruthy();
    expect(within(review).getByText('1 of 2 milestones done')).toBeTruthy();
    expect(within(review).getByText('No bots linked')).toBeTruthy();
    const books = rowsOf('Work').find((row) => within(row).queryByText('Books') !== null)!;
    expect(within(books).getByText('Part of Quarter close')).toBeTruthy();
    expect(within(books).getByText('Blocked')).toBeTruthy();
    const close = rowsOf('Work').find((row) => within(row).queryByText('Quarter close') !== null)!;
    expect(within(close).getByText('0 of 1 part accepted')).toBeTruthy();
    expect(within(close).getByText('Groups parts')).toBeTruthy();
  });

  it('says which rows the scene does not draw', () => {
    view();
    expect(screen.getAllByText('Not drawn in the scene')).toHaveLength(1);
    expect(screen.getByText('1 more on-field item is listed below and not drawn in the scene.')).toBeTruthy();
  });

  it('says the counts are a minimum when the read was cut short', () => {
    view(null, vi.fn(), { ...model, overflow: { enemies: 0, truncated: true } });
    expect(screen.getByText(/first 8 pages of each state/)).toBeTruthy();
    expect(screen.getByText(/newest-created page only/)).toBeTruthy();
  });

  it.each([
    ['Working', 1, 1],
    ['Blocked', 0, 1],
    ['Awaiting your review', 0, 1],
    ['Defeated', 0, 1],
    ['Unknown', 1, 0],
    ['All', 3, 5],
  ])('filters %s to %i Specters and %i work rows', (label, specterRows, workRows) => {
    view();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryAllByRole('table', { name: 'Specters' })[0] === undefined ? 0 : within(screen.getByRole('table', { name: 'Specters' })).queryAllByRole('row').length - 1).toBe(specterRows);
    expect(within(screen.getByRole('table', { name: 'Work' })).queryAllByRole('row').length - 1).toBe(workRows);
  });

  it('selects from a Specter row and a work row and marks the current one', () => {
    const onSelect = vi.fn();
    view({ kind: 'work', workId: work[2]!.workId }, onSelect);
    fireEvent.click(screen.getByRole('button', { name: 'Atlas' }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'specter', bindingId: atlas.bindingId });
    fireEvent.click(screen.getByRole('button', { name: 'Shipped' }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'work', workId: work[3]!.workId });
    expect(screen.getByRole('button', { name: 'Review me' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: 'Shipped' }).getAttribute('aria-current')).toBeNull();
  });

  it('copes with a row whose work item is not in the item map', () => {
    render(<ArenaListView model={model} bots={[]} items={new Map()} drawn={drawn} selection={null} onSelect={vi.fn()} />);
    expect(rowsOf('Work')).toHaveLength(5);
    expect(screen.getAllByText('No XP').length).toBeGreaterThan(0);
  });
});
