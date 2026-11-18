import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { rosterBody } from '@kirocrew/app-sdk';
import { specterOf } from '../specters/testData';
import { RosterList, targetIndex } from './RosterList';

const items = rosterBody('default').items;

function setup(overrides: Partial<Parameters<typeof RosterList>[0]> = {}) {
  const props = {
    items,
    selectedId: null,
    watched: new Set<string>(),
    watchListFull: false,
    onSelect: vi.fn(),
    onToggleWatch: vi.fn(),
    ...overrides,
  };
  render(<RosterList {...props} />);
  return props;
}

const selectButtons = () => screen.getAllByRole('button').filter((button) => button.className.includes('sa-row__select'));

describe('RosterList', () => {
  it('shows each bot with its condition and the chips for two concurrent workers', () => {
    setup();
    const atlas = screen.getAllByRole('listitem')[0];
    expect(atlas?.textContent).toContain('Atlas');
    expect(atlas?.textContent).toContain('Working');
    expect(atlas?.textContent).toContain('1 worker working');
    expect(atlas?.textContent).toContain('1 worker unknown');
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });

  it('has one tab stop: the first row until something is selected or focused', () => {
    setup();
    expect(screen.getAllByRole('button').filter((button) => button.tabIndex === 0)).toHaveLength(2);
    expect(selectButtons()[0]?.tabIndex).toBe(0);
    expect(selectButtons()[1]?.tabIndex).toBe(-1);
  });

  it('starts the tab stop on the selected row', () => {
    setup({ selectedId: items[2]?.bindingId ?? null });
    expect(selectButtons()[2]?.tabIndex).toBe(0);
    expect(selectButtons()[2]?.getAttribute('aria-current')).toBe('true');
  });

  it('moves focus with arrows, Home and End without wrapping', () => {
    setup();
    const list = screen.getByRole('list', { name: 'Bots' });
    const buttons = selectButtons();
    buttons[0]?.focus();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1]?.tabIndex).toBe(0);
    fireEvent.keyDown(list, { key: 'End' });
    expect(document.activeElement).toBe(buttons[6]);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[6]);
    fireEvent.keyDown(list, { key: 'Home' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(list, { key: 'a' });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('selects on click and toggles watch with aria-pressed', () => {
    const props = setup({ watched: new Set([items[1]?.bindingId ?? '']) });
    fireEvent.click(selectButtons()[3] as HTMLElement);
    expect(props.onSelect).toHaveBeenCalledWith(items[3]?.bindingId);
    const second = within(screen.getAllByRole('listitem')[1] as HTMLElement).getByRole('button', { name: 'Watch Brindle' });
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect(second.textContent).toBe('Watching');
    fireEvent.click(second);
    expect(props.onToggleWatch).toHaveBeenCalledWith(items[1]?.bindingId);
  });

  it('disables Watch for an unwatched bot when the watch list is full, but not for a watched one', () => {
    setup({ watchListFull: true, watched: new Set([items[0]?.bindingId ?? '']) });
    expect((screen.getByRole('button', { name: 'Watch Atlas' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Watch Brindle' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('copes with an empty list and with arrows on it', () => {
    setup({ items: [] });
    fireEvent.keyDown(screen.getByRole('list', { name: 'Bots' }), { key: 'ArrowDown' });
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

describe('RosterList with Specters', () => {
  const atlas = items[0];
  const withSpecter = (portrait: boolean) =>
    new Map([[atlas?.bindingId ?? '', specterOf({ bindingId: atlas?.bindingId ?? '', portrait: portrait ? { contractVersion: 1, assetId: 'ast_000000000000000000000001', mediaType: 'image/png', width: 8, height: 8, byteLength: 1, origin: 'bundled', label: 'x', dataBase64: null } : null })]]);

  it('adds a decorative portrait and the Specter name after the chips, leaving the bot name first', () => {
    setup({ specters: withSpecter(false) });
    const row = screen.getAllByRole('listitem')[0] as HTMLElement;
    expect(row.querySelector('.sa-portrait')?.getAttribute('aria-hidden')).toBe('true');
    expect(row.querySelector('strong')?.textContent).toBe('Atlas');
    expect(row.querySelector('.sa-row__specter')?.textContent).toBe('Specter: Lanternwick (placeholder token, not a portrait)');
    expect(screen.getByRole('button', { name: /^Atlas/ })).toBeTruthy();
  });

  it('omits the token note when the Specter has a portrait', () => {
    setup({ specters: withSpecter(true) });
    const row = screen.getAllByRole('listitem')[0] as HTMLElement;
    expect(row.querySelector('.sa-row__specter')?.textContent).toBe('Specter: Lanternwick');
  });

  it('leaves bots without a Specter exactly as before', () => {
    setup({ specters: withSpecter(false) });
    const row = screen.getAllByRole('listitem')[1] as HTMLElement;
    expect(row.querySelector('.sa-portrait')).toBeNull();
    expect(row.querySelector('.sa-row__specter')).toBeNull();
  });

  it('exports the shared arrow-key target rule', () => {
    expect(targetIndex('ArrowDown', 0, 3)).toBe(1);
    expect(targetIndex('End', 0, 3)).toBe(3);
    expect(targetIndex('q', 0, 3)).toBeNull();
  });
});
