import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DECLARED_API, isPathPermitted } from '../fixtures/api-allowlist';
import * as entry from './mount';
import SpecterArenaApp from './mount';

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@kirocrew/app-sdk', () => ({ useAppApi: () => client }));

beforeEach(() => {
  client.get.mockReset();
});

describe('release entry', () => {
  it('default-exports a component and no mount function', () => {
    expect(typeof entry.default).toBe('function');
    expect(Object.keys(entry)).toEqual(['default']);
  });

  it('renders the stub shell before any check', () => {
    render(<SpecterArenaApp />);
    expect(screen.getByRole('heading', { level: 1, name: 'Specter Arena' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Specter Arena' }).textContent).toContain('No product features yet.');
    expect(screen.getByRole('status').textContent).toBe('Backend connection not checked.');
  });

  it('shows the ping time when the backend answers', async () => {
    client.get.mockResolvedValue({ ok: true, at: '2000-01-01T00:00:00Z' });
    render(<SpecterArenaApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Check backend connection' }));
    expect((await screen.findByRole('status')).textContent).toBe('Backend reachable at 2000-01-01T00:00:00Z.');
    expect(client.get).toHaveBeenCalledWith('/apps/specter-arena/api/ping');
    expect(isPathPermitted(DECLARED_API, '/apps/specter-arena/api/ping')).toBe(true);
  });

  it('shows the error text when the check fails', async () => {
    client.get.mockRejectedValue(new Error('app_not_enabled'));
    render(<SpecterArenaApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Check backend connection' }));
    expect((await screen.findByText(/Backend check failed/)).textContent).toBe(
      'Backend check failed: app_not_enabled',
    );
  });

  it('stringifies a non-Error rejection', async () => {
    client.get.mockRejectedValue('plain failure');
    render(<SpecterArenaApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Check backend connection' }));
    expect((await screen.findByText(/Backend check failed/)).textContent).toBe('Backend check failed: plain failure');
  });
});
