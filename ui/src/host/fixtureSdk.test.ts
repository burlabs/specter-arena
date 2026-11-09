import { describe, expect, it } from 'vitest';
import { DECLARED_API, isPathPermitted } from '../../fixtures/api-allowlist';
import { createFixtureClient, useAppApi } from '../../fixtures/app-sdk';
import { APP_API_PREFIX, PING_PATH, appApiPath } from './paths';

describe('fixture SDK allowlist (mirrors the host matcher)', () => {
  it('lets /x/* cover /x and /x/...', () => {
    expect(isPathPermitted(['/x/*'], '/x')).toBe(true);
    expect(isPathPermitted(['/x/*'], '/x/y/z')).toBe(true);
    expect(isPathPermitted(['/x/*'], '/xy')).toBe(false);
  });

  it('treats a bare entry as exact or a path-segment prefix, and a trailing * as a string prefix', () => {
    expect(isPathPermitted(['/a'], '/a')).toBe(true);
    expect(isPathPermitted(['/a'], '/a/b')).toBe(true);
    expect(isPathPermitted(['/a'], '/ab')).toBe(false);
    expect(isPathPermitted(['/a*'], '/abc')).toBe(true);
  });

  it('ignores blank entries and rejects everything when nothing is declared', () => {
    expect(isPathPermitted(['  '], '/a')).toBe(false);
    expect(isPathPermitted([], '/api/ping')).toBe(false);
  });

  it('rejects an undeclared path with the host error text', async () => {
    const client = createFixtureClient([]);
    await expect(client.get('/api/ping')).rejects.toThrow(
      '[app-sdk] App "specter-arena" not permitted to access /api/ping. Declared: []',
    );
    await expect(client.post('/api/ping', {})).rejects.toThrow('not permitted');
  });

  it('ignores the query string when matching', async () => {
    await expect(createFixtureClient(['/a/*']).get('/a/b?x=1')).resolves.toBeDefined();
  });
});

describe('release manifest allowlist', () => {
  it('declares exactly the own-namespace entry the page calls through', () => {
    expect(DECLARED_API).toEqual([`${APP_API_PREFIX}/*`]);
  });

  it('permits the ping path and the probe paths, and rejects the gateway namespace', async () => {
    const client = useAppApi();
    await expect(client.get(PING_PATH)).resolves.toBeDefined();
    await expect(client.post(appApiPath('/probe/run'), {})).resolves.toBeDefined();
    await expect(client.get('/api/ping')).rejects.toThrow('not permitted to access /api/ping');
    await expect(client.get('/api/agents')).rejects.toThrow('not permitted');
  });
});
