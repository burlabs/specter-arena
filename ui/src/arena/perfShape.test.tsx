import { setArenaScenario } from '@kirocrew/app-sdk';
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ObservatoryPage } from '../observatory/ObservatoryPage';
import { fireEvent } from '@testing-library/react';

describe('arena-perf-1 shape (SC10-8)', () => {
  it('draws at most 160 sprite nodes and 80 enemies, lists everything, and says what is not drawn', async () => {
    setArenaScenario('arena-perf-1');
    const { container } = render(<ObservatoryPage />);
    await screen.findByRole('list', { name: 'Bots' });
    fireEvent.click(screen.getByRole('tab', { name: 'Arena' }));
    await screen.findByRole('group', { name: 'Arena map' });
    await waitFor(() => expect(container.querySelectorAll('[data-sprite="enemy"]').length).toBeGreaterThan(0));

    const sprites = container.querySelectorAll('[data-sprite]').length;
    expect(sprites).toBeLessThanOrEqual(160);
    expect(container.querySelectorAll('[data-scene-node]')).toHaveLength(sprites);
    expect(container.querySelectorAll('[data-sprite="specter"]')).toHaveLength(20);
    expect(container.querySelectorAll('[data-sprite="enemy"]')).toHaveLength(80);

    const rows = (caption: string) => within(screen.getByRole('table', { name: caption })).getAllByRole('row').length - 1;
    expect(rows('Specters')).toBe(20);
    expect(rows('Work')).toBe(112);
    expect(screen.getByText('32 more on-field items are listed below and not drawn in the scene.')).toBeTruthy();
    expect(screen.getAllByText('Not drawn in the scene')).toHaveLength(32);
  });

  it('keeps the visible text free of percentages and the forbidden words', async () => {
    setArenaScenario('arena-perf-1');
    render(<ObservatoryPage />);
    await screen.findByRole('list', { name: 'Bots' });
    fireEvent.click(screen.getByRole('tab', { name: 'Arena' }));
    await screen.findByRole('group', { name: 'Arena map' });
    const text = within(screen.getByRole('region', { name: 'Arena' })).getByRole('group', { name: 'Arena map' }).parentElement?.parentElement?.parentElement?.textContent ?? '';
    expect(text.length).toBeGreaterThan(100);
    expect(text).not.toMatch(/\d\s?%/);
    expect(text).not.toMatch(/\b(idle|healthy|waiting on you)\b/i);
  });
});
