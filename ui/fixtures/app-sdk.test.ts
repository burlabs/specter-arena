import { describe, expect, it } from 'vitest';
import { DECLARED_API, isPathPermitted } from '../test-support/api-allowlist.ts';
import { createFixtureClient, useAppApi } from './app-sdk.ts';
import { APP_API_PREFIX, PING_PATH, ROSTER_PATH, WORK_PATH, XP_PATH, appApiPath, attemptsPath, workListPath } from '../src/host/paths.ts';
import { setFixtureScenario } from './monitoring-bodies.ts';

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
  it('declares the own-namespace entry the page calls through and the agents and summoning grants', () => {
    expect(DECLARED_API).toEqual([`${APP_API_PREFIX}/*`, '/api/agents', '/api/chat']);
  });

  it('permits the ping path and the probe paths, and rejects the rest of the gateway namespace', async () => {
    const client = useAppApi();
    await expect(client.get(PING_PATH)).resolves.toBeDefined();
    await expect(client.post(appApiPath('/probe/run'), {})).resolves.toBeDefined();
    await expect(client.get('/api/ping')).rejects.toThrow('not permitted to access /api/ping');
    await expect(client.get('/api/usage')).rejects.toThrow('not permitted');
    await expect(client.get('/api/members')).rejects.toThrow('not permitted');
    await expect(client.get('/api/spawn')).rejects.toThrow('not permitted');
    await expect(client.get('/api/jobs')).rejects.toThrow('not permitted');
  });
});

describe('monitoring routes', () => {
  it('serves the roster and attempts as real Responses', async () => {
    const client = useAppApi();
    const roster = (await client.get(ROSTER_PATH)) as Response;
    expect(roster.status).toBe(200);
    expect(((await roster.json()) as { items: unknown[] }).items).toHaveLength(7);
    const attempts = (await client.get(attemptsPath('bnd_aaaaaaaaaaaaaaaaaaaa0001'))) as Response;
    expect(attempts.status).toBe(200);
  });

  it('rejects when the offline scenario is active, and still answers ping', async () => {
    const client = useAppApi();
    setFixtureScenario('offline');
    await expect(client.get(ROSTER_PATH)).rejects.toThrow('Failed to fetch');
    await expect(client.get(PING_PATH)).resolves.toMatchObject({ ok: true });
  });

  it('still rejects an undeclared path', async () => {
    await expect(createFixtureClient([]).get(ROSTER_PATH)).rejects.toThrow('not permitted');
  });
});

describe('work routes', () => {
  it('serves the work list with its query string and the xp list as real Responses', async () => {
    const client = useAppApi();
    const work = (await client.get(workListPath('open', 25, null))) as Response;
    expect(work.status).toBe(200);
    expect(((await work.json()) as { items: unknown[] }).items).toEqual([]);
    const xp = (await client.get(XP_PATH)) as Response;
    expect(xp.status).toBe(200);
  });

  it('still answers a foreign path with the canned body and rejects an undeclared work path', async () => {
    await expect(useAppApi().get(appApiPath('/elsewhere'))).resolves.toMatchObject({ ok: true });
    await expect(createFixtureClient([]).get(WORK_PATH)).rejects.toThrow('not permitted');
  });
});
