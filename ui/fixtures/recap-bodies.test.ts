// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { afterEach, describe, expect, it } from 'vitest';
import { parseRecap } from '../src/arena/recapParse.ts';
import { buildTimeline } from '../src/arena/recapTimeline.ts';
import { periodOf } from '../src/arena/recapPeriods.ts';
import { recapPath } from '../src/host/paths.ts';
import { createFixtureClient, DECLARED_API, setArenaScenario } from './app-sdk.ts';

const schemasDir = fileURLToPath(new URL('../../contracts/schemas/', import.meta.url));
const ajv = new Ajv({ strict: true });
for (const name of readdirSync(schemasDir).filter((file) => file.endsWith('.schema.json'))) ajv.addSchema(JSON.parse(readFileSync(`${schemasDir}${name}`, 'utf8')) as object);

const client = createFixtureClient(DECLARED_API);
const NOW = Date.UTC(2026, 10, 25, 20);
afterEach(() => setArenaScenario(null));

describe('the FIXTURE recap route', () => {
  it.each(['today', 'yesterday', 'week'] as const)('answers a %s period with a body recap.v1 accepts and the reader reads', async (kind) => {
    setArenaScenario('arena');
    const period = periodOf(kind, NOW, 'America/Denver');
    const body = (await client.get(recapPath(period.fromMs, period.toMs))) as Response;
    const json: unknown = await body.json();
    expect(ajv.getSchema('urn:specter-arena:contract:recap:v1')?.(json)).toBe(true);
    const recap = parseRecap(json);
    expect(recap.tasks).toHaveLength(6);
    expect(recap.coverage.spans.map((span) => span.reason)).toEqual(['collecting', 'paused', 'collecting', 'collector-gap', 'collecting']);
    const timeline = buildTimeline(recap, kind);
    expect(timeline.segments.some((segment) => segment.kind === 'beat')).toBe(true);
    expect(timeline.segments.some((segment) => segment.kind === 'play' && segment.notCollected !== null)).toBe(true);
    expect(timeline.markers.length).toBeGreaterThan(0);
  });

  it('answers an empty period fully collected when the task scenario has no tasks', async () => {
    setArenaScenario('arena-empty');
    const response = (await client.get(recapPath(10_000_000, 10_002_000))) as Response;
    const recap = parseRecap(await response.json());
    expect(recap.tasks).toEqual([]);
    expect(recap.coverage.spans).toEqual([{ fromMs: 10_000_000, toMs: 10_002_000, state: 'covered', reason: 'collecting' }]);
  });

  it.each(['/recap', '/recap?fromMs=5&toMs=5', '/recap?fromMs=5', '/recap?fromMs=x&toMs=9', '/recap?fromMs=0&toMs=700000000'])('refuses %s as bad_period', async (path) => {
    setArenaScenario('arena');
    const response = (await client.get(`/apps/specter-arena/api${path}`)) as Response;
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ contractVersion: 1, error: 'bad_period' });
  });

  it('refuses a write and follows the task scenario failures', async () => {
    setArenaScenario('arena');
    expect(((await client.post(recapPath(1, 2))) as Response).status).toBe(405);
    for (const [scenario, status] of [['tasks-failure', 503], ['tasks-expired', 403], ['tasks-unsupported', 404]] as const) {
      const { setTaskScenario } = await import('./task-bodies.ts');
      setTaskScenario(scenario);
      expect(((await client.get(recapPath(1, 2))) as Response).status).toBe(status);
    }
    const { setTaskScenario } = await import('./task-bodies.ts');
    setTaskScenario('tasks-offline');
    await expect(client.get(recapPath(1, 2))).rejects.toThrow('Failed to fetch');
  });
});
