// SPECTER-DIAGNOSTIC-ONLY
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import DiagnosticEntry from './entry';
import { DIAGNOSTIC_MARKER } from './model';

afterEach(cleanup);

describe('DiagnosticEntry skeleton', () => {
  it('renders the placeholder with no snapshot and the not-wired message', () => {
    const { container } = render(<DiagnosticEntry />);
    expect(screen.getByRole('heading', { name: 'Specter diagnostic' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('probe not wired yet');
    expect(container.querySelector('[data-has-snapshot="false"]')).not.toBeNull();
  });

  it('carries the diagnostic marker at runtime', () => {
    const { container } = render(<DiagnosticEntry />);
    expect(container.querySelector(`[data-marker="${DIAGNOSTIC_MARKER}"]`)).not.toBeNull();
  });
});
