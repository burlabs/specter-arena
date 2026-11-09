import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SpecterArenaApp from './mount';

describe('release entry against the aliased fixture SDK', () => {
  it('resolves @kirocrew/app-sdk to the fixture and shows its canned ping', async () => {
    render(<SpecterArenaApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Check backend connection' }));
    expect((await screen.findByRole('status')).textContent).toBe('Backend reachable at 2000-01-01T00:00:00Z.');
  });
});
