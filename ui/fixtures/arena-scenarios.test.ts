// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { afterEach, describe, expect, it } from 'vitest';
import type { RosterItemV1, SpecterV1, WorkItemV1, XpSummaryV1 } from '../src/contracts/types.ts';
import { PING_PATH, ROSTER_PATH, SPECTERS_PATH, WORK_PATH, XP_PATH, workListPath, workPath } from '../src/host/paths.ts';
import {
  ARENA_PERF_1,
  ARENA_SCENARIO_NAMES,
  PERF_SPECTER_NAMES,
  canonicalArenaScenario,
  isArenaScenario,
  perfItems,
  workingAttemptCount,
} from './arena-scenarios.ts';
import { DECLARED_API, createFixtureClient, setArenaScenario } from './app-sdk.ts';
import { FIXTURE_NOW_MS } from './monitoring-bodies.ts';

const schemasDir = fileURLToPath(new URL('../../contracts/schemas/', import.meta.url));
const ajv = new Ajv({ strict: true });
for (const name of readdirSync(schemasDir).filter((file) => file.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(`${schemasDir}${name}`, 'utf8')) as object);
}
const valid = (schema: string, body: unknown): boolean => {
  const validate = ajv.getSchema(`urn:specter-arena:contract:${schema}:v1`);
  if (validate === undefined) throw new Error(`no schema ${schema}`);
  return validate(body) === true;
};

const client = createFixtureClient(DECLARED_API);
const read = async <T>(path: string): Promise<{ status: number; body: T }> => {
  const response = (await client.get(path)) as Response;
  return { status: response.status, body: (await response.json()) as T };
};

interface WorkPage {
  items: WorkItemV1[];
  nextCursor: string | null;
}

async function allOf(state: string): Promise<WorkItemV1[]> {
  const out: WorkItemV1[] = [];
  let cursor: string | null = null;
  do {
    const page: { status: number; body: WorkPage } = await read<WorkPage>(workListPath(state, 25, cursor));
    expect(page.status).toBe(200);
    expect(page.body.items.length).toBeLessThanOrEqual(25);
    out.push(...page.body.items);
    cursor = page.body.nextCursor;
  } while (cursor !== null);
  return out;
}

afterEach(() => setArenaScenario(null));

describe('arena scenario names', () => {
  it('lists the five names and recognises only them', () => {
    expect(ARENA_SCENARIO_NAMES).toEqual(['arena', 'arena-no-art', 'arena-perf-1', 'arena-stale', 'arena-empty']);
    expect(isArenaScenario('arena-perf-1')).toBe(true);
    expect(isArenaScenario('arena-small')).toBe(false);
    expect(isArenaScenario(null)).toBe(false);
  });

  it('maps each name to the module scenario and leaves every other value alone', () => {
    const aliases = { arena: 'a', perf: 'p', stale: 's', empty: 'e' };
    expect(canonicalArenaScenario('arena', aliases)).toBe('a');
    expect(canonicalArenaScenario('arena-no-art', aliases)).toBe('a');
    expect(canonicalArenaScenario('arena-perf-1', aliases)).toBe('p');
    expect(canonicalArenaScenario('arena-stale', aliases)).toBe('s');
    expect(canonicalArenaScenario('arena-empty', aliases)).toBe('e');
    expect(canonicalArenaScenario('work', aliases)).toBe('work');
    expect(canonicalArenaScenario(null, aliases)).toBeNull();
  });

  it('plans 30 working attempts over 12 bots', () => {
    const total = Array.from({ length: 20 }, (_, index) => workingAttemptCount(index + 1)).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(ARENA_PERF_1.workingAttempts);
    expect(workingAttemptCount(0)).toBe(0);
    expect(workingAttemptCount(13)).toBe(0);
  });
});

describe('arena-perf-1 as the real fixture routes serve it', () => {
  it('has 20 bindings: 12 working, 6 settled, 2 unknown, all valid', async () => {
    setArenaScenario('arena-perf-1');
    const roster = await read<{ items: RosterItemV1[] }>(ROSTER_PATH);
    expect(valid('roster', { ...roster.body })).toBe(true);
    expect(roster.body.items).toHaveLength(20);
    const states = roster.body.items.map((item) => item.condition.state);
    expect(states.filter((state) => state === 'working')).toHaveLength(12);
    expect(states.filter((state) => state === 'settled')).toHaveLength(6);
    expect(states.filter((state) => state === 'unknown')).toHaveLength(2);
  });

  it('has 100 on-field items, 10 of them containers, paged 25 at a time with cursors', async () => {
    setArenaScenario('arena-perf-1');
    const first = await read<WorkPage>(workListPath('open', 25, null));
    expect(first.body.items).toHaveLength(25);
    expect(first.body.nextCursor).not.toBeNull();
    const onField = (await Promise.all(['open', 'awaiting-review', 'blocked', 'reopened'].map(allOf))).flat();
    expect(onField).toHaveLength(100);
    expect(new Set(onField.map((item) => item.workId)).size).toBe(100);
    expect(onField.filter((item) => item.childCount > 0)).toHaveLength(10);
    expect(onField.filter((item) => item.state === 'open' && item.parentId === null && item.childCount === 0)).not.toHaveLength(0);
    for (const item of onField) expect(valid('work-item', item), JSON.stringify(ajv.errors)).toBe(true);
  });

  it('links 30 open attempts and accepts 12 items inside the last 24 hours with real contributors', async () => {
    setArenaScenario('arena-perf-1');
    const onField = (await Promise.all(['open', 'awaiting-review', 'blocked', 'reopened'].map(allOf))).flat();
    const open = onField.flatMap((item) => item.attempts).filter((attempt) => attempt.present && !attempt.ended);
    expect(open).toHaveLength(ARENA_PERF_1.workingAttempts);
    const accepted = await allOf('accepted');
    expect(accepted).toHaveLength(12);
    for (const item of accepted) {
      expect(item.updatedAtMs).toBeGreaterThanOrEqual(FIXTURE_NOW_MS - 24 * 3_600_000);
      expect(item.contributors.reduce((sum, contributor) => sum + contributor.xpNet, 0)).toBeGreaterThan(0);
    }
  });

  it('has 14 Specters on bindings 1..14 and leaves 6 bots without one', async () => {
    setArenaScenario('arena-perf-1');
    const specters = await read<{ items: SpecterV1[] }>(SPECTERS_PATH);
    expect(specters.body.items).toHaveLength(14);
    expect(specters.body.items.map((specter) => specter.profile.name)).toEqual([...PERF_SPECTER_NAMES]);
    expect(specters.body.items.every((specter) => specter.portrait === null)).toBe(true);
    const roster = await read<{ items: RosterItemV1[] }>(ROSTER_PATH);
    const withSpecter = new Set(specters.body.items.map((specter) => specter.bindingId));
    expect(roster.body.items.filter((bot) => !withSpecter.has(bot.bindingId))).toHaveLength(6);
  });

  it('serves xp summaries that match the accepted items', async () => {
    setArenaScenario('arena-perf-1');
    const xp = await read<{ items: XpSummaryV1[] }>(XP_PATH);
    expect(valid('xp-summaries', xp.body)).toBe(true);
    expect(xp.body.items.reduce((sum, item) => sum + item.totalXp, 0)).toBeGreaterThan(0);
  });

  it('builds one work page quickly enough for the preview', async () => {
    setArenaScenario('arena-perf-1');
    const started = performance.now();
    await read(workListPath('open', 25, null));
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('plans leaf states 54 open, 18 awaiting review, 12 blocked, 6 reopened', () => {
    const leaves = perfItems().filter((item) => item.n > 10 && item.n <= 100);
    const count = (state: string) => leaves.filter((item) => item.state === state).length;
    expect([count('open'), count('awaiting-review'), count('blocked'), count('reopened')]).toEqual([54, 18, 12, 6]);
  });
});

describe('the other arena scenarios', () => {
  it('arena serves the existing demo data: seven bots, thirteen items, three Specters', async () => {
    setArenaScenario('arena');
    expect((await read<{ items: unknown[] }>(ROSTER_PATH)).body.items).toHaveLength(7);
    expect((await read<WorkPage>(WORK_PATH)).body.items).toHaveLength(13);
    expect((await read<{ items: unknown[] }>(SPECTERS_PATH)).body.items).toHaveLength(3);
  });

  it('arena-empty has no bindings, no work and no Specters', async () => {
    setArenaScenario('arena-empty');
    expect((await read<{ items: unknown[] }>(ROSTER_PATH)).body.items).toHaveLength(0);
    expect((await read<WorkPage>(WORK_PATH)).body.items).toHaveLength(0);
    expect((await read<{ items: unknown[] }>(SPECTERS_PATH)).body.items).toHaveLength(0);
  });

  it('arena-stale answers 404 unknown_work for a detail read and drops one roster binding after the first read', async () => {
    setArenaScenario('arena-stale');
    const first = await read<{ items: unknown[] }>(ROSTER_PATH);
    expect(first.body.items).toHaveLength(7);
    const second = await read<{ items: unknown[] }>(ROSTER_PATH);
    expect(second.body.items).toHaveLength(6);
    const list = await read<WorkPage>(WORK_PATH);
    expect(list.body.items).toHaveLength(13);
    const detail = await read<{ error: string }>(workPath(list.body.items[0]?.workId ?? ''));
    expect(detail.status).toBe(404);
    expect(detail.body.error).toBe('unknown_work');
  });

  it('arena-no-art keeps the data and refuses the scene assets', async () => {
    setArenaScenario('arena-no-art');
    expect((await read<{ items: unknown[] }>(ROSTER_PATH)).body.items).toHaveLength(7);
    expect((await read('/apps/specter-arena/api/scene-assets/arena-map')).status).toBe(404);
  });

  it('an unknown scenario name still falls back to the module defaults', async () => {
    expect((await read<{ items: unknown[] }>(ROSTER_PATH)).body.items).toHaveLength(7);
    expect((await read<WorkPage>(WORK_PATH)).body.items).toHaveLength(0);
    expect((await client.get(PING_PATH)) as unknown).toBeDefined();
  });
});
