// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { afterEach, describe, expect, it } from 'vitest';
import type { RosterItemV1, SpecterV2, TaskItemV1, TasksV1, XpHistoryV1, XpSummariesV3 } from '../src/contracts/types.ts';
import { PING_PATH, ROSTER_PATH, SPECTERS_PATH, TASKS_PATH, XP_PATH, taskPath, tasksPath, xpHistoryPath, xpPagedPath } from '../src/host/paths.ts';
import {
  ARENA_PERF_1,
  ARENA_SCENARIO_NAMES,
  canonicalArenaScenario,
  isArenaScenario,
  perfTasks,
  workingAttemptCount,
} from './arena-scenarios.ts';
import { DECLARED_API, createFixtureClient, setArenaScenario } from './app-sdk.ts';
import { FIXTURE_NOW_MS } from './monitoring-bodies.ts';
import { WATCHED_TASK_ID, closeWatchedTask } from './task-bodies.ts';

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

async function allOf(state: 'open' | 'credited' | 'not-credited'): Promise<TaskItemV1[]> {
  const out: TaskItemV1[] = [];
  let cursor: string | null = null;
  do {
    const page: { status: number; body: TasksV1 } = await read<TasksV1>(tasksPath({ state, limit: 25, cursor }));
    expect(page.status).toBe(200);
    expect(page.body.items.length).toBeLessThanOrEqual(25);
    expect(valid('tasks', page.body), JSON.stringify(ajv.errors)).toBe(true);
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

  it('has 100 open tasks paged 25 at a time with cursors, every one a valid task-item', async () => {
    setArenaScenario('arena-perf-1');
    const first = await read<TasksV1>(tasksPath({ state: 'open', limit: 25, cursor: null }));
    expect(first.body.items).toHaveLength(25);
    expect(first.body.nextCursor).not.toBeNull();
    const open = await allOf('open');
    expect(open).toHaveLength(ARENA_PERF_1.openTasks);
    expect(new Set(open.map((task) => task.taskId)).size).toBe(ARENA_PERF_1.openTasks);
    for (const task of open) expect(valid('task-item', task), JSON.stringify(ajv.errors)).toBe(true);
    expect(open.map((task) => task.updatedAtMs)).toEqual([...open.map((task) => task.updatedAtMs)].sort((a, b) => b - a));
  });

  it('puts 30 working attempts on real roster attempts and credits 12 tasks inside the last 24 hours', async () => {
    setArenaScenario('arena-perf-1');
    const open = await allOf('open');
    expect(open.filter((task) => task.attemptState === 'working')).toHaveLength(ARENA_PERF_1.workingAttempts);
    expect(open.filter((task) => task.attemptState === 'unknown')).toHaveLength(ARENA_PERF_1.openTasks - ARENA_PERF_1.workingAttempts);
    const credited = await allOf('credited');
    expect(credited).toHaveLength(ARENA_PERF_1.recentlyCredited);
    for (const task of credited) {
      expect(task.closedAtMs ?? 0).toBeGreaterThanOrEqual(FIXTURE_NOW_MS - 24 * 3_600_000);
      expect(task).toMatchObject({ closeReason: 'clean-end', policyVersion: 'xp-policy-2' });
      expect(task.xpCredited).toBeGreaterThanOrEqual(10);
    }
  });

  it('spreads run time over all three size classes, by the thresholds', async () => {
    setArenaScenario('arena-perf-1');
    const open = await allOf('open');
    const classes = new Set(open.map((task) => task.sizeClass));
    expect(classes).toEqual(new Set(['small', 'medium', 'large']));
    for (const task of open) expect(task.sizeClass).toBe(task.runMs < 120_000 ? 'small' : task.runMs < 900_000 ? 'medium' : 'large');
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

  it('serves xp summaries v3 that match the credited tasks and both ledgers', async () => {
    setArenaScenario('arena-perf-1');
    const xp = await read<XpSummariesV3>(xpPagedPath(200, null));
    expect(valid('xp-summaries', xp.body, 3), JSON.stringify(ajv.errors)).toBe(true);
    const credited = await allOf('credited');
    const task = credited.reduce((sum, item) => sum + (item.xpCredited ?? 0), 0);
    expect(xp.body.items.reduce((sum, item) => sum + item.totalXp, 0)).toBe(task + 100);
    expect(xp.body.items.reduce((sum, item) => sum + item.creditedTaskCount, 0)).toBe(ARENA_PERF_1.recentlyCredited);
  });

  it('builds one task page quickly enough for the preview', async () => {
    setArenaScenario('arena-perf-1');
    const started = performance.now();
    await read(tasksPath({ state: 'open', limit: 25, cursor: null }));
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('plans 100 open and 12 credited tasks over all three run times', () => {
    const plan = perfTasks();
    expect(plan.filter((task) => !task.credited)).toHaveLength(100);
    expect(plan.filter((task) => task.credited)).toHaveLength(12);
    expect(plan.filter((task) => !task.credited && task.workingAttempt !== null)).toHaveLength(30);
    expect(new Set(plan.map((task) => task.runMinutes))).toEqual(new Set([1, 4, 20]));
  });
});

describe('the other arena scenarios', () => {
  it('arena serves the demo data: seven bots, tasks of every size and close-out, seven heroes', async () => {
    setArenaScenario('arena');
    expect((await read<{ items: unknown[] }>(ROSTER_PATH)).body.items).toHaveLength(7);
    const open = await allOf('open');
    expect(new Set(open.map((task) => task.sizeClass))).toEqual(new Set(['small', 'medium', 'large']));
    expect(open.some((task) => task.attemptState === 'unknown')).toBe(true);
    const credited = await allOf('credited');
    expect(credited.length).toBeGreaterThanOrEqual(2);
    const notCredited = await allOf('not-credited');
    expect(new Set(notCredited.map((task) => task.closeReason))).toEqual(new Set(['unknown-terminal', 'coverage-gap', 'waiting-at-end']));
    for (const task of [...open, ...credited, ...notCredited]) expect(valid('task-item', task), JSON.stringify(ajv.errors)).toBe(true);
    expect((await read<{ items: unknown[] }>(SPECTERS_PATH)).body.items).toHaveLength(7);
  });

  it('builds tasks the way the backend does: a worker at once, a bot turn from 60 seconds', async () => {
    setArenaScenario('arena');
    const all = [...(await allOf('open')), ...(await allOf('credited')), ...(await allOf('not-credited'))];
    for (const task of all.filter((item) => item.kind === 'bot-turn')) expect(task.runMs).toBeGreaterThanOrEqual(60_000);
    expect(all.some((task) => task.kind === 'worker')).toBe(true);
  });

  it('arena-empty has no bindings, no tasks and no Specters', async () => {
    setArenaScenario('arena-empty');
    expect((await read<{ items: unknown[] }>(ROSTER_PATH)).body.items).toHaveLength(0);
    expect((await read<TasksV1>(TASKS_PATH)).body.items).toHaveLength(0);
    expect((await read<{ items: unknown[] }>(SPECTERS_PATH)).body.items).toHaveLength(0);
  });

  it('arena-stale answers 404 unknown_task for a task detail read and drops one roster binding after the first read', async () => {
    setArenaScenario('arena-stale');
    const first = await read<{ items: unknown[] }>(ROSTER_PATH);
    expect(first.body.items).toHaveLength(7);
    const second = await read<{ items: unknown[] }>(ROSTER_PATH);
    expect(second.body.items).toHaveLength(6);
    const list = await read<TasksV1>(TASKS_PATH);
    expect(list.body.items.length).toBeGreaterThan(5);
    const detail = await read<{ error: string }>(taskPath(list.body.items[0]?.taskId ?? ''));
    expect(detail.status).toBe(404);
    expect(detail.body.error).toBe('unknown_task');
  });

  it('arena-no-art keeps the data and refuses the scene assets', async () => {
    setArenaScenario('arena-no-art');
    expect((await read<{ items: unknown[] }>(ROSTER_PATH)).body.items).toHaveLength(7);
    expect((await read('/apps/specter-arena/api/scene-assets/arena-map')).status).toBe(404);
  });

  it('an unknown scenario name still falls back to the module defaults', async () => {
    expect((await read<{ items: unknown[] }>(ROSTER_PATH)).body.items).toHaveLength(7);
    expect((await read<TasksV1>(TASKS_PATH)).body.items).toHaveLength(0);
    expect((await client.get(PING_PATH)) as unknown).toBeDefined();
  });
});

describe('tasks and xp on the fixture routes', () => {
  it('serves one task by id and answers an unknown id 404 unknown_task', async () => {
    setArenaScenario('arena');
    const [task] = await allOf('credited');
    const one = await read<TaskItemV1>(taskPath(task?.taskId ?? ''));
    expect(one).toMatchObject({ status: 200, body: task });
    expect(valid('task-item', one.body)).toBe(true);
    expect(await read(taskPath('tsk_ffffffffffffffffffffffff'))).toMatchObject({ status: 404, body: { error: 'unknown_task' } });
  });

  it('filters by state and bot, refuses a bad state or cursor, and orders newest update first', async () => {
    setArenaScenario('arena');
    const atlas = (await read<{ items: RosterItemV1[] }>(ROSTER_PATH)).body.items[0]?.bindingId ?? '';
    const mine = await read<TasksV1>(tasksPath({ bindingId: atlas, limit: 25, cursor: null }));
    expect(mine.body.items.length).toBeGreaterThan(0);
    expect(mine.body.items.every((task) => task.bindingId === atlas)).toBe(true);
    expect(mine.body.items.map((task) => task.updatedAtMs)).toEqual([...mine.body.items.map((task) => task.updatedAtMs)].sort((a, b) => b - a));
    expect((await read(`${TASKS_PATH}?state=accepted`)).status).toBe(400);
    expect((await read(`${TASKS_PATH}?cursor=zzz`)).status).toBe(400);
  });

  it('refuses every write to a task route', async () => {
    const response = (await client.post(TASKS_PATH, {})) as Response;
    expect(response.status).toBe(405);
  });

  it('pages xp summaries v3 by binding id and counts legacy XP with the task awards', async () => {
    setArenaScenario('arena');
    const small = await read<XpSummariesV3>(xpPagedPath(1, null));
    expect(small.body).toMatchObject({ contractVersion: 3 });
    expect(small.body.items).toHaveLength(1);
    expect(small.body.nextCursor).not.toBeNull();
    const walked: XpSummariesV3['items'] = [];
    let cursor: string | null = null;
    do {
      const page: { body: XpSummariesV3 } = await read<XpSummariesV3>(xpPagedPath(1, cursor));
      expect(valid('xp-summaries', page.body, 3), JSON.stringify(ajv.errors)).toBe(true);
      walked.push(...page.body.items);
      cursor = page.body.nextCursor;
    } while (cursor !== null);
    const atlas = walked.find((item) => item.bindingId.endsWith('0001'));
    expect(atlas).toMatchObject({ acceptedWorkCount: 1, policyVersion: 'xp-policy-2' });
    expect(atlas?.totalXp).toBeGreaterThan(100);
    expect(atlas?.creditedTaskCount).toBeGreaterThan(0);
    expect((await read(`${XP_PATH}?view=all`)).status).toBe(400);
    expect((await read(`${XP_PATH}?view=tasks&cursor=zzz`)).status).toBe(400);
    expect((await read(`${XP_PATH}?view=tasks&limit=x`)).status).toBe(400);
  });

  it('keeps the frozen history route to the manual ledger, with a v1 summary that does not carry task awards', async () => {
    setArenaScenario('arena');
    const atlas = (await read<{ items: RosterItemV1[] }>(ROSTER_PATH)).body.items[0]?.bindingId ?? '';
    const history = await read<XpHistoryV1>(xpHistoryPath(atlas));
    expect(valid('xp-history', history.body), JSON.stringify(ajv.errors)).toBe(true);
    expect(history.body.items).toHaveLength(1);
    expect(history.body.summary.totalXp).toBe(100);
    expect((await read(xpHistoryPath('bnd_unknownunknownunknown00'))).status).toBe(404);
    expect((await read(xpHistoryPath(atlas, 50, 'bad'))).status).toBe(400);
  });
});

describe('the watched task', () => {
  it('runs until it is closed, then is credited once with the bounty for its run time, and the bot XP follows', async () => {
    setArenaScenario('arena');
    const before = await read<TaskItemV1>(taskPath(WATCHED_TASK_ID));
    expect(before.body).toMatchObject({ state: 'open', attemptState: 'working', xpCredited: null, closeReason: null });
    const atlas = before.body.bindingId;
    const xpOf = async () => (await read<XpSummariesV3>(xpPagedPath(200, null))).body.items.find((item) => item.bindingId === atlas);
    const totalBefore = (await xpOf())?.totalXp ?? 0;
    closeWatchedTask();
    const after = await read<TaskItemV1>(taskPath(WATCHED_TASK_ID));
    expect(valid('task-item', after.body), JSON.stringify(ajv.errors)).toBe(true);
    expect(after.body).toMatchObject({ state: 'credited', attemptState: 'ended', closeReason: 'clean-end', xpCredited: 13, runMs: 360_000, sizeClass: 'medium' });
    expect(after.body.taskId).toBe(before.body.taskId);
    expect((await xpOf())?.totalXp).toBe(totalBefore + 13);
  });
});

describe('failure scenarios', () => {
  it.each([
    ['tasks-failure', 503],
    ['tasks-expired', 403],
    ['tasks-unsupported', 404],
  ] as const)('%s answers %s on a task read', async (scenario, status) => {
    const { setTaskScenario } = await import('./task-bodies.ts');
    setTaskScenario(scenario);
    expect(((await client.get(TASKS_PATH)) as Response).status).toBe(status);
    setTaskScenario(null);
  });

  it('tasks-offline rejects the request', async () => {
    const { setTaskScenario } = await import('./task-bodies.ts');
    setTaskScenario('tasks-offline');
    await expect(client.get(TASKS_PATH)).rejects.toThrow('Failed to fetch');
    setTaskScenario(null);
  });

  it('tasks-many has more than one page of closed tasks', async () => {
    const { setTaskScenario } = await import('./task-bodies.ts');
    setTaskScenario('tasks-many');
    const closed = [...(await allOf('credited')), ...(await allOf('not-credited'))];
    expect(closed.length).toBeGreaterThan(25);
    setTaskScenario(null);
  });
});
