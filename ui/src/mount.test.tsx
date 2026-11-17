import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DECLARED_API, isPathPermitted } from '../test-support/api-allowlist.ts';
import * as entry from './mount';
import SpecterArenaApp from './mount';
import { ROSTER_PATH, attemptsPath, rosterPath } from './host/paths';

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@kirocrew/app-sdk', () => ({ useAppApi: () => client }));

const { rosterBody } = await vi.importActual<typeof import('@kirocrew/app-sdk')>('@kirocrew/app-sdk');

beforeEach(() => {
  client.get.mockReset();
  client.post.mockReset();
});

describe('release entry', () => {
  it('default-exports a component and no mount function', () => {
    expect(typeof entry.default).toBe('function');
    expect(Object.keys(entry)).toEqual(['default']);
  });

  it('renders the observatory heading and a loading status before the roster arrives', () => {
    client.get.mockReturnValue(new Promise(() => undefined));
    render(<SpecterArenaApp />);
    expect(screen.getByRole('heading', { level: 1, name: 'Specter Arena' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Loading bots…');
  });

  it('renders a roster read through the host client', async () => {
    client.get.mockResolvedValue(new Response(JSON.stringify(rosterBody('default'))));
    render(<SpecterArenaApp />);
    expect(await screen.findByText('Atlas')).toBeTruthy();
    expect(client.get).toHaveBeenCalledWith(rosterPath(200, null));
    expect(client.post).not.toHaveBeenCalled();
  });

  it('shows the offline state when the host client rejects', async () => {
    client.get.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<SpecterArenaApp />);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the app backend');
  });

  it('only calls paths the manifest permits', () => {
    expect(isPathPermitted(DECLARED_API, ROSTER_PATH)).toBe(true);
    expect(isPathPermitted(DECLARED_API, attemptsPath('bnd_1').split('?')[0] ?? '')).toBe(true);
  });
});
