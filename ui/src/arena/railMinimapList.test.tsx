import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArenaListView } from './ArenaListView';
import { ArenaMinimap } from './ArenaMinimap';
import { ArenaRail } from './ArenaRail';
import { assignSlots, placeScene, slotIdsOf } from './sceneLayout';
import { buildSceneModel } from './sceneModel';
import { botOf, creditedOf, inputsOf, notCreditedOf, specterOf, taskOf, xpOf } from './testData';

const atlas = botOf(1, { displayName: 'Atlas', state: 'working' });
const brindle = botOf(2, { displayName: 'Brindle' });
const dune = botOf(3, { displayName: 'Dune', state: 'unknown' });
const bots = [atlas, brindle, dune];
const tasks = [
  taskOf(1, atlas, { runMs: 90_000, kind: 'bot-turn' }),
  taskOf(2, atlas, { runMs: 1_000_000 }),
  taskOf(3, dune, { attemptState: 'unknown', runMs: 300_000 }),
  creditedOf(4, atlas, { xpCredited: 14, runMs: 600_000 }),
  taskOf(5, brindle, { attemptState: 'ended', endedAtMs: 1, runMs: 300_000 }),
  notCreditedOf(6, brindle, 'coverage-gap', { runMs: 240_000 }),
];
const specters = new Map([[atlas.bindingId, specterOf(atlas, 'Vesper')]]);
const inputs = inputsOf({ roster: bots, specters: [...specters.values()], xp: [xpOf(atlas, 100, 2)], tasks });
const model = buildSceneModel(inputs);
const items = new Map(tasks.map((task) => [task.taskId, task]));

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
    expect(within(rail).getByText('2 open attempts')).toBeTruthy();
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
  const drawn = new Set(model.enemies.filter((enemy) => enemy.workId !== tasks[4]!.taskId).map((enemy) => enemy.workId));
  const view = (selection = null as null | { kind: 'work'; workId: string }, onSelect = vi.fn(), listModel = model) =>
    render(<ArenaListView model={listModel} bots={bots} items={items} drawn={drawn} selection={selection} onSelect={onSelect} />);
  const rowsOf = (caption: string) => within(screen.getByRole('table', { name: caption })).getAllByRole('row').slice(1);
  const rowWith = (text: string) => rowsOf('Tasks').find((row) => within(row).queryByText(text) !== null)!;

  it('lists every Specter, every enemy and every not-credited task, with the mode label in its heading', () => {
    view();
    expect(rowsOf('Specters')).toHaveLength(3);
    expect(rowsOf('Tasks')).toHaveLength(6);
    expect(within(screen.getByRole('region', { name: 'Arena list' })).getByText('FIXTURE — demo data, not Crew activity')).toBeTruthy();
  });

  it('prints close-out, size and run time, bot and XP, and the reason a task earned nothing', () => {
    view();
    const credited = rowWith('Worker task · 10 min');
    expect(within(credited).getByText('Credited')).toBeTruthy();
    expect(within(credited).getByText('Auto-credited when the task ended cleanly.')).toBeTruthy();
    expect(within(credited).getByText('Medium · 10 min')).toBeTruthy();
    expect(within(credited).getByText('Atlas')).toBeTruthy();
    expect(within(credited).getByText('14 XP')).toBeTruthy();
    const gap = rowWith('Worker task · 4 min');
    expect(within(gap).getByText('Not credited')).toBeTruthy();
    expect(within(gap).getByText('Not credited: a collection gap overlapped this task.')).toBeTruthy();
    expect(within(gap).getByText('No XP')).toBeTruthy();
    const running = rowWith('Bot turn · 1 min');
    expect(within(running).getByText('Open')).toBeTruthy();
    expect(within(running).getByText('Small · 1 min')).toBeTruthy();
    expect(within(running).getByText('No XP yet')).toBeTruthy();
    expect(within(rowWith('Worker task · 16 min')).getByText('Large · 16 min')).toBeTruthy();
  });

  it('never prints a percentage, a health word or a progress word for size', () => {
    const { container } = view();
    expect(container.textContent).not.toMatch(/%|health|hp\b|progress|remaining/i);
  });

  it('says which rows the scene does not draw', () => {
    view();
    expect(screen.getAllByText('Not drawn in the scene')).toHaveLength(1);
    expect(screen.getByText('1 more open task is listed below and not drawn in the scene.')).toBeTruthy();
  });

  it('says the counts are a minimum when the read was cut short', () => {
    view(null, vi.fn(), { ...model, overflow: { enemies: 0, truncated: true } });
    expect(screen.getByText(/first 8 pages of open tasks/)).toBeTruthy();
    expect(screen.getByText(/25 most recently updated/)).toBeTruthy();
  });

  it.each([
    ['Running', 1, 2],
    ['Credited', 0, 1],
    ['Not credited', 0, 1],
    ['Unknown', 1, 1],
    ['All', 3, 6],
  ])('filters %s to %i Specters and %i task rows', (label, specterRows, taskRows) => {
    view();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
    const specterTable = screen.getByRole('table', { name: 'Specters' });
    expect(within(specterTable).queryAllByRole('row').length - 1).toBe(specterRows);
    expect(within(screen.getByRole('table', { name: 'Tasks' })).queryAllByRole('row').length - 1).toBe(taskRows);
  });

  it('selects from a Specter row and a task row and marks the current one', () => {
    const onSelect = vi.fn();
    view({ kind: 'work', workId: tasks[2]!.taskId }, onSelect);
    fireEvent.click(screen.getByRole('button', { name: 'Atlas' }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'specter', bindingId: atlas.bindingId });
    fireEvent.click(screen.getByRole('button', { name: 'Worker task · 10 min' }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'work', workId: tasks[3]!.taskId });
    const current = [...document.querySelectorAll('[aria-current="true"]')];
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe('Worker task · 5 min');
    expect(current[0]?.closest('th')?.textContent).toContain('Started');
  });

  it('lists nothing for an enemy whose task is missing from the item map, and names an unknown bot', () => {
    render(<ArenaListView model={model} bots={[]} items={new Map()} drawn={drawn} selection={null} onSelect={vi.fn()} />);
    expect(within(screen.getByRole('table', { name: 'Tasks' })).queryAllByRole('row')).toHaveLength(1);
    cleanup();
    render(<ArenaListView model={model} bots={[]} items={items} drawn={drawn} selection={null} onSelect={vi.fn()} />);
    expect(screen.getAllByText(/^Unknown bot \(/).length).toBeGreaterThan(0);
  });
});
