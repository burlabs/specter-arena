import { describe, expect, it } from 'vitest';
import { DECLARED_API, isPathPermitted } from '../test-support/api-allowlist.ts';
import { createFixtureClient, fixtureCalls, resetFixtureCalls, setArenaScenario, useAppApi } from './app-sdk.ts';
import { APP_API_PREFIX, PING_PATH, ROSTER_PATH, WORK_PATH, XP_PATH, appApiPath, attemptsPath, sceneAssetPath, workListPath } from '../src/host/paths.ts';
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
  it('declares the own-namespace entry the page calls through and the agents grant, and no chat grant', () => {
    expect(DECLARED_API).toEqual([`${APP_API_PREFIX}/*`, '/api/agents']);
    expect(DECLARED_API.some((entry) => entry.startsWith('/api/chat'))).toBe(false);
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
    const work = (await client.get(workListPath('open', 25, null, 'created'))) as Response;
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

describe('scene-asset route', () => {
  it('serves a scene asset through the guarded client and answers an unknown key 404 unknown_scene_asset', async () => {
    const client = createFixtureClient(DECLARED_API);
    const served = (await client.get(sceneAssetPath('arena-map'))) as Response;
    expect(served.status).toBe(200);
    expect(((await served.json()) as { key: string }).key).toBe('arena-map');
    const unknown = (await client.get(sceneAssetPath('nope'))) as Response;
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ contractVersion: 1, error: 'unknown_scene_asset' });
  });
});

describe('fixture client mode seam and call log', () => {
  it('reports FIXTURE and records every request, newest last, on the window for the preview harness', async () => {
    const client = createFixtureClient(DECLARED_API);
    expect(client.sourceMode).toBe('FIXTURE');
    resetFixtureCalls();
    await client.get(`${PING_PATH}?x=1`);
    await client.post(appApiPath('/probe/run'), {});
    expect(fixtureCalls).toEqual([
      { method: 'GET', path: `${PING_PATH}?x=1` },
      { method: 'POST', path: appApiPath('/probe/run') },
    ]);
    expect((window as unknown as { __specterFixtureCalls: unknown }).__specterFixtureCalls).toBe(fixtureCalls);
    resetFixtureCalls();
    expect(fixtureCalls).toEqual([]);
  });

  it('records a refused request too', async () => {
    resetFixtureCalls();
    await expect(createFixtureClient([]).get('/api/ping')).rejects.toThrow('not permitted');
    expect(fixtureCalls).toEqual([{ method: 'GET', path: '/api/ping' }]);
  });
});

describe('setArenaScenario', () => {
  it('points the roster, work and Specter fixtures at one scenario and clears them on null', async () => {
    const client = createFixtureClient(DECLARED_API);
    setArenaScenario('arena-perf-1');
    const roster = (await client.get(ROSTER_PATH)) as Response;
    expect(((await roster.json()) as { items: unknown[] }).items).toHaveLength(20);
    setArenaScenario('arena-empty');
    const empty = (await client.get(ROSTER_PATH)) as Response;
    expect(((await empty.json()) as { items: unknown[] }).items).toHaveLength(0);
    setArenaScenario(null);
    const back = (await client.get(ROSTER_PATH)) as Response;
    expect(((await back.json()) as { items: unknown[] }).items).toHaveLength(7);
  });

  it('turns the scene assets off only for arena-no-art', async () => {
    const client = createFixtureClient(DECLARED_API);
    setArenaScenario('arena-no-art');
    expect(((await client.get(sceneAssetPath('arena-map'))) as Response).status).toBe(404);
    setArenaScenario('arena');
    expect(((await client.get(sceneAssetPath('arena-map'))) as Response).status).toBe(200);
    setArenaScenario(null);
  });

  it('refuses a name that is not an arena scenario', () => {
    expect(() => setArenaScenario('nope' as never)).toThrow('Unknown arena scenario');
  });
});
