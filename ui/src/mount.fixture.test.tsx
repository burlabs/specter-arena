import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setFixtureScenario } from '@kirocrew/app-sdk';
import SpecterArenaApp from './mount';

describe('release entry against the aliased fixture SDK', () => {
  it('resolves @kirocrew/app-sdk to the fixture and lists the default scenario bots', async () => {
    render(<SpecterArenaApp />);
    const list = await screen.findByRole('list', { name: 'Bots' });
    expect(list.querySelectorAll('li')).toHaveLength(7);
    expect(screen.getByText('Atlas')).toBeTruthy();
  });

  it('shows the empty roster scenario', async () => {
    setFixtureScenario('empty');
    render(<SpecterArenaApp />);
    expect(await screen.findByRole('heading', { name: 'No bots are on the roster yet' })).toBeTruthy();
  });
});
