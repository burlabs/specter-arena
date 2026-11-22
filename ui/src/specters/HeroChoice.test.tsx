import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HeroesItemV1 } from '../contracts/types';
import { HeroChoice } from './HeroChoice';
import { heroesByHeld } from './heroes';

const hero = (heroId: HeroesItemV1['heroId'], name: string, assignedCount: number): HeroesItemV1 => ({ heroId, name, epithet: 'e', personality: 'p', assigned: assignedCount > 0, assignedCount });
const HEROES = [hero('vell', 'Vell', 2), hero('stitch', 'Stitch', 0), hero('reeve', 'Reeve', 1), hero('rattle', 'Rattle', 0)];

describe('HeroChoice', () => {
  it('is one radio group named for assistive technology, with the hero and how many hold it in each name', () => {
    render(<HeroChoice name="g" label="Heroes" heroes={HEROES} value="stitch" onChange={() => undefined} size={96} />);
    const group = within(screen.getByRole('radiogroup', { name: 'Heroes' }));
    expect(group.getAllByRole('radio')).toHaveLength(4);
    expect(group.getByRole('radio', { name: 'Vell held by 2' })).toBeTruthy();
    expect(group.getByRole('radio', { name: 'Stitch not held yet' })).toBeTruthy();
    expect((group.getByRole('radio', { name: 'Stitch not held yet' }) as HTMLInputElement).checked).toBe(true);
    expect((group.getByRole('radio', { name: 'Vell held by 2' }) as HTMLInputElement).checked).toBe(false);
  });

  it('reports the hero chosen, and can be disabled', () => {
    const onChange = vi.fn();
    const { rerender } = render(<HeroChoice name="g" label="Heroes" heroes={HEROES} value={null} onChange={onChange} size={96} />);
    fireEvent.click(screen.getByRole('radio', { name: /^Reeve/ }));
    expect(onChange).toHaveBeenCalledWith('reeve');
    rerender(<HeroChoice name="g" label="Heroes" heroes={HEROES} value={null} onChange={onChange} size={96} disabled />);
    expect((screen.getByRole('radio', { name: /^Reeve/ }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('heroesByHeld', () => {
  it('puts the fewest holders first and keeps roster order among ties, without changing the input', () => {
    const copy = [...HEROES];
    expect(heroesByHeld(HEROES).map((entry) => entry.heroId)).toEqual(['stitch', 'rattle', 'reeve', 'vell']);
    expect(HEROES).toEqual(copy);
  });
});
