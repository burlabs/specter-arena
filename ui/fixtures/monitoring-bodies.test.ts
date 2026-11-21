// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import {
  ALL_BOT_REASONS,
  FIXTURE_NOW_MS,
  SCENARIO_NAMES,
  activeScenario,
  attemptsBody,
  monitoringResponse,
  rosterBody,
  rosterV2Body,
  setFixtureScenario,
} from './monitoring-bodies.ts';

const schemasDir = fileURLToPath(new URL('../../contracts/schemas/', import.meta.url));
const ajv = new Ajv({ strict: true });
for (const name of readdirSync(schemasDir).filter((file) => file.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(`${schemasDir}${name}`, 'utf8')) as object);
}
const validateRoster = ajv.getSchema('urn:specter-arena:contract:roster:v1');
const validateRosterV2 = ajv.getSchema('urn:specter-arena:contract:roster:v2');
const validateAttempts = ajv.getSchema('urn:specter-arena:contract:attempts:v1');

describe('fixture scenarios', () => {
  it('lists the fifteen scenarios, two of them internal to the arena scenarios', () => {
    expect(SCENARIO_NAMES).toHaveLength(15);
  });

  describe.each(SCENARIO_NAMES)('%s', (scenario) => {
    it('serves a roster that validates against roster.v1', () => {
      const body = rosterBody(scenario);
      expect(validateRoster?.(body), JSON.stringify(validateRoster?.errors)).toBe(true);
    });

    it('serves a signals roster that validates against roster.v2 and matches v1 item for item', () => {
      const body = rosterV2Body(scenario);
      expect(validateRosterV2?.(body), JSON.stringify(validateRosterV2?.errors)).toBe(true);
      const { items: v2Items, ...v2Rest } = body;
      const { items: v1Items, ...v1Rest } = rosterBody(scenario);
      expect({ ...v2Rest, contractVersion: 1 }).toEqual(v1Rest);
      expect(v2Items.map(({ tokenReading, ...item }) => ({ ...item, contractVersion: 1 }))).toEqual(v1Items);
    });

    it('serves attempts that validate and keep the window invariants and the roster counts', () => {
      for (const item of rosterBody(scenario).items) {
        const attempts = attemptsBody(scenario, item.bindingId);
        expect(attempts).not.toBeNull();
        if (attempts === null) continue;
        expect(validateAttempts?.(attempts), JSON.stringify(validateAttempts?.errors)).toBe(true);
        const workers = attempts.items.filter((attempt) => attempt.kind === 'worker');
        expect(item.workers.running).toBe(workers.filter((attempt) => attempt.condition.state === 'working').length);
        expect(item.workers.unknown).toBe(workers.filter((attempt) => attempt.condition.state === 'unknown').length);
        expect(item.workers.seen).toBe(workers.length);
        for (const window of [attempts.activity.last24h, attempts.activity.last7d]) {
          expect(window.toMs - window.fromMs).toBe(window.windowMs);
          expect(window.fromMs <= window.observedFromMs && window.observedFromMs <= window.toMs).toBe(true);
          expect(window.coveredMs).toBeGreaterThanOrEqual(0);
          expect(window.coveredMs).toBeLessThanOrEqual(window.toMs - window.observedFromMs);
          expect(window.sampleSize).toBe(window.botTurnsStarted + window.workersStarted);
          expect(window.sampleSize).toBe(window.ended + window.stillOpen + window.unknown);
        }
      }
    });
  });

  it('puts Atlas in the two-concurrent scenario with one working and one unknown worker', () => {
    const [atlas] = rosterBody('two-concurrent').items;
    expect(atlas?.displayName).toBe('Atlas');
    expect(atlas?.workers).toEqual({ running: 1, seen: 2, unknown: 1 });
    const attempts = attemptsBody('two-concurrent', atlas?.bindingId ?? '');
    expect(attempts?.activity.last24h.coveredMs).toBe(6_200_000);
    expect(attempts?.activity.last24h.sampleSize).toBe(3);
  });

  it('shows the not-collected scenario with no covered time and no sample', () => {
    const [bot] = rosterBody('not-collected').items;
    const attempts = attemptsBody('not-collected', bot?.bindingId ?? '');
    expect(attempts?.activity.last24h).toMatchObject({ coveredMs: 0, sampleSize: 0, observedFromMs: FIXTURE_NOW_MS - 5 * 3_600_000 });
  });

  it('carries one bot per reason in all-reasons', () => {
    expect(rosterBody('all-reasons').items.map((item) => item.condition.reasonCode)).toEqual([...ALL_BOT_REASONS]);
  });

  it('carries the crew-signals bots: a waiting bot per reason, a reading, none, and a real zero', () => {
    const items = rosterV2Body('crew-signals').items;
    const waiting = items.filter((item) => item.condition.state === 'waiting');
    expect(waiting.map((item) => item.condition.reasonCode)).toEqual(['approval-pending', 'question-pending']);
    expect(items.map((item) => item.tokenReading?.used ?? null)).toEqual([48_000, null, 0, 151_250, null, null]);
    const flagOnly = items.find((item) => item.displayName === 'Flag only');
    expect([flagOnly?.condition.state, flagOnly?.condition.signals.waitingForInput]).toEqual(['settled', true]);
  });

  it('serves v2 only for view=signals', async () => {
    const v2 = (await (await monitoringResponse('/apps/specter-arena/api/roster', '?view=signals'))?.json()) as { contractVersion: number };
    const v1 = (await (await monitoringResponse('/apps/specter-arena/api/roster', '?limit=200'))?.json()) as { contractVersion: number };
    expect([v2.contractVersion, v1.contractVersion]).toEqual([2, 1]);
  });

  it('returns null for a binding that is not on the roster', () => {
    expect(attemptsBody('default', 'bnd_missing')).toBeNull();
  });
});

describe('scenario selection and responses', () => {
  it('uses default, the override, and falls back to default for an unknown name', () => {
    expect(activeScenario()).toBe('default');
    setFixtureScenario('empty');
    expect(activeScenario()).toBe('empty');
    setFixtureScenario(null);
    expect(activeScenario()).toBe('default');
  });

  it('answers only the roster and attempts paths', () => {
    expect(monitoringResponse('/apps/specter-arena/api/ping')).toBeNull();
    expect(monitoringResponse('/apps/specter-arena/api/roster/x/y/attempts')).toBeNull();
  });

  it('serves roster and attempts as Responses, and 404 for an unknown binding', async () => {
    const roster = await monitoringResponse('/apps/specter-arena/api/roster');
    expect(roster?.status).toBe(200);
    const [first] = ((await roster?.json()) as { items: { bindingId: string }[] }).items;
    const attempts = await monitoringResponse(`/apps/specter-arena/api/roster/${encodeURIComponent(first?.bindingId ?? '')}/attempts`);
    expect(attempts?.status).toBe(200);
    const gone = await monitoringResponse('/apps/specter-arena/api/roster/%E0%A4%A/attempts');
    expect(gone?.status).toBe(404);
    expect(await gone?.json()).toEqual({ contractVersion: 1, error: 'unknown_binding' });
  });

  it('models the failure scenarios', async () => {
    setFixtureScenario('offline');
    await expect(monitoringResponse('/apps/specter-arena/api/roster')).rejects.toThrow('Failed to fetch');
    setFixtureScenario('store-not-ready');
    const notReady = await monitoringResponse('/apps/specter-arena/api/roster');
    expect([notReady?.status, await notReady?.json()]).toEqual([503, { contractVersion: 1, error: 'store_not_ready' }]);
    setFixtureScenario('expired');
    expect((await monitoringResponse('/apps/specter-arena/api/roster'))?.status).toBe(403);
    setFixtureScenario('attempt-gone');
    const roster = await monitoringResponse('/apps/specter-arena/api/roster');
    expect(roster?.status).toBe(200);
    const gone = await monitoringResponse('/apps/specter-arena/api/roster/bnd_aaaaaaaaaaaaaaaaaaaa0001/attempts');
    expect(gone?.status).toBe(404);
  });
});
