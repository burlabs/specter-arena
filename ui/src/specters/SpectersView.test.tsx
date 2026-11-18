import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SpectersView } from './SpectersView';

describe('SpectersView placeholder', () => {
  it('renders the region and the not-yet message', () => {
    render(<SpectersView />);
    expect(screen.getByText('Specters are not part of this build yet')).toBeTruthy();
    expect(screen.getByText(/The roster is unchanged/)).toBeTruthy();
  });
});
