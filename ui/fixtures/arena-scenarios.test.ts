// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { afterEach, describe, expect, it } from 'vitest';
import type { RosterItemV1, SpecterV2, WorkItemV1, WorkItemsV2, XpSummariesV2, XpSummaryV1 } from '../src/contracts/types.ts';
import { PING_PATH, ROSTER_PATH, SPECTERS_PATH, WORK_PATH, XP_PATH, workListPath, workPath, xpPagedPath } from '../src/host/paths.ts';
import {
  ARENA_PERF_1,
  ARENA_SCENARIO_NAMES,
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
const valid = (schema: string, body: unknown, version = 1): boolean => {
  const validate = ajv.getSchema(`urn:specter-arena:contract:${schema}:v${version}`);
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

/** The unchanged v1 read: full items, validated against the FROZEN work-item.v1 schema. */
const v1ListPath = (state: string, cursor: string | null): string => `${WORK_PATH}?state=${state}&limit=25${cursor === null ? '' : `&cursor=${cursor}`}`;

async function allOf(state: string): Promise<WorkItemV1[]> {
  const out: WorkItemV1[] = [];
  let cursor: string | null = null;
  do {
    const page: { status: number; body: WorkPage } = await read<WorkPage>(v1ListPath(state, cursor));
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
    const first = await read<WorkPage>(v1ListPath('open', null));
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

  it('gives every one of the 20 bots a hero, wrapping at 11', async () => {
    setArenaScenario('arena-perf-1');
    const specters = await read<{ items: SpecterV2[] }>(SPECTERS_PATH);
    expect(specters.body.items).toHaveLength(20);
    expect(specters.body.items.map((specter) => specter.displayName).slice(0, 3)).toEqual(['Vell', 'Stitch', 'Reeve']);
    expect(specters.body.items[11]?.displayName).toBe('Vell II');
    expect(specters.body.items[19]?.displayName).toBe('Lume II');
    const roster = await read<{ items: RosterItemV1[] }>(ROSTER_PATH);
    const withSpecter = new Set(specters.body.items.map((specter) => specter.bindingId));
    expect(roster.body.items.filter((bot) => !withSpecter.has(bot.bindingId))).toHaveLength(0);
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
    await read(workListPath('open', 25, null, 'updated'));
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('plans leaf states 54 open, 18 awaiting review, 12 blocked, 6 reopened', () => {
    const leaves = perfItems().filter((item) => item.n > 10 && item.n <= 100);
    const count = (state: string) => leaves.filter((item) => item.state === state).length;
    expect([count('open'), count('awaiting-review'), count('blocked'), count('reopened')]).toEqual([54, 18, 12, 6]);
  });
});

describe('the other arena scenarios', () => {
  it('arena serves the existing demo data: seven bots, thirteen items, seven heroes', async () => {
    setArenaScenario('arena');
    expect((await read<{ items: unknown[] }>(ROSTER_PATH)).body.items).toHaveLength(7);
    expect((await read<WorkPage>(WORK_PATH)).body.items).toHaveLength(13);
    expect((await read<{ items: unknown[] }>(SPECTERS_PATH)).body.items).toHaveLength(7);
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

describe('view=list and view=paged on the fixture routes (FP-18)', () => {
  const FULL_ONLY = ['acceptanceCondition', 'policyVersion', 'milestones', 'evidenceRevision', 'review', 'decisions'];

  async function listAll(state: string, order: 'created' | 'updated'): Promise<WorkItemsV2['items']> {
    const out: WorkItemsV2['items'] = [];
    let cursor: string | null = null;
    do {
      const page: { status: number; body: WorkItemsV2 } = await read<WorkItemsV2>(workListPath(state, 25, cursor, order));
      expect(page.status).toBe(200);
      expect(page.body).toMatchObject({ contractVersion: 2, order });
      expect(valid('work-items', page.body, 2), JSON.stringify(ajv.errors)).toBe(true);
      out.push(...page.body.items);
      cursor = page.body.nextCursor;
    } while (cursor !== null);
    return out;
  }

  it('serves the list projection: the v1 list fields of every item, nothing else, plus everAccepted', async () => {
    setArenaScenario('arena-perf-1');
    const full = new Map((await Promise.all(['open', 'awaiting-review', 'blocked', 'reopened', 'accepted'].map(allOf))).flat().map((item) => [item.workId, item]));
    const rows = (await Promise.all(['open', 'awaiting-review', 'blocked', 'reopened', 'accepted'].map((state) => listAll(state, 'updated')))).flat();
    expect(rows).toHaveLength(112);
    for (const row of rows) {
      const item = full.get(row.workId) as WorkItemV1;
      for (const key of FULL_ONLY) expect(key in row, key).toBe(false);
      expect(Object.keys(row).sort()).toEqual(
        ['attempts', 'bountyXp', 'childCount', 'childrenAccepted', 'contractVersion', 'contributors', 'createdAtMs', 'everAccepted', 'parentId', 'progress', 'rewardable', 'state', 'title', 'updatedAtMs', 'version', 'workId'],
      );
      const { everAccepted, ...rest } = row;
      expect(everAccepted).toBe(item.decisions.some((decision) => decision.action === 'accept'));
      for (const [key, value] of Object.entries(rest)) expect(value, key).toEqual(item[key as keyof WorkItemV1]);
    }
  });

  it('orders by update time or creation time and refuses a cursor from the other order', async () => {
    setArenaScenario('arena-perf-1');
    const updated = await listAll('accepted', 'updated');
    expect(updated.map((row) => row.updatedAtMs)).toEqual([...updated.map((row) => row.updatedAtMs)].sort((a, b) => b - a));
    const created = await listAll('open', 'created');
    expect(created.map((row) => row.createdAtMs)).toEqual([...created.map((row) => row.createdAtMs)].sort((a, b) => b - a));
    const first = await read<WorkItemsV2>(workListPath('open', 25, null, 'updated'));
    const cursor = first.body.nextCursor;
    expect(cursor).not.toBeNull();
    const crossed = await read<{ error: string }>(workListPath('open', 25, cursor, 'created'));
    expect(crossed).toMatchObject({ status: 400, body: { error: 'invalid_cursor' } });
  });

  it('answers a bad view or an order without view=list with 400 and leaves the v1 read unchanged', async () => {
    setArenaScenario('arena-perf-1');
    expect((await read(`${WORK_PATH}?view=full`)).status).toBe(400);
    expect((await read(`${WORK_PATH}?order=updated`)).status).toBe(400);
    expect((await read(`${WORK_PATH}?view=list&order=newest`)).status).toBe(400);
    const v1 = await read<{ contractVersion: number; items: WorkItemV1[] }>(v1ListPath('open', null));
    expect(v1.body.contractVersion).toBe(1);
    expect(v1.body.items[0]).toHaveProperty('decisions');
  });

  it('pages xp summaries by binding id and keeps the unpaged read as it was', async () => {
    setArenaScenario('arena-perf-1');
    const unpaged = await read<{ contractVersion: number; items: XpSummaryV1[] }>(XP_PATH);
    expect(unpaged.body.contractVersion).toBe(1);
    const small = await read<XpSummariesV2>(xpPagedPath(1, null));
    expect(small.body).toMatchObject({ contractVersion: 2 });
    expect(small.body.items).toHaveLength(1);
    expect(small.body.nextCursor).not.toBeNull();
    const walked: XpSummaryV1[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: XpSummariesV2 } = await read<XpSummariesV2>(xpPagedPath(2, cursor));
      expect(valid('xp-summaries', page.body, 2), JSON.stringify(ajv.errors)).toBe(true);
      walked.push(...page.body.items);
      cursor = page.body.nextCursor;
    } while (cursor !== null);
    expect(walked).toEqual(unpaged.body.items);
    expect((await read(`${XP_PATH}?view=all`)).status).toBe(400);
    expect((await read(`${XP_PATH}?view=paged&cursor=zzz`)).status).toBe(400);
  });
});

