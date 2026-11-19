import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ArenaStats } from './ArenaStats';

describe('ArenaStats', () => {
  it('shows the three values it is given under their words', () => {
    render(<ArenaStats botsObserved={7} coverageUnknown={2} committedXp={340} />);
    const stats = screen.getByRole('group', { name: 'Arena summary' });
    expect(within(stats).getByText('Bots observed').nextElementSibling?.textContent).toBe('7');
    expect(within(stats).getByText('Coverage unknown').nextElementSibling?.textContent).toBe('2');
    expect(within(stats).getByText('Committed XP').nextElementSibling?.textContent).toBe('340');
  });

  it('shows zeros, not blanks, for an empty arena', () => {
    const { container } = render(<ArenaStats botsObserved={0} coverageUnknown={0} committedXp={0} />);
    expect([...container.querySelectorAll('dd')].map((cell) => cell.textContent)).toEqual(['0', '0', '0']);
  });
});
