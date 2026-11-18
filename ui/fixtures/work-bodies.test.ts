// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { beforeEach, describe, expect, it } from 'vitest';
import { SCENARIO_NAMES, attemptsBody, rosterBody, setFixtureScenario } from './monitoring-bodies.ts';
import { SPECTER_SCENARIO_NAMES } from './specter-bodies.ts';
import { WORK_SCENARIO_NAMES, activeWorkScenario, resetWorkFixtures, setWorkScenario, workResponse } from './work-bodies.ts';
import type { WorkScenarioName } from './work-bodies.ts';

const schemasDir = fileURLToPath(new URL('../../contracts/schemas/', import.meta.url));
const ajv = new Ajv({ strict: true });
for (const name of readdirSync(schemasDir).filter((file) => file.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(`${schemasDir}${name}`, 'utf8')) as object);
}
const validator = (name: string) => {
  const validate = ajv.getSchema(`urn:specter-arena:contract:${name}:v1`);
  if (validate === undefined) throw new Error(`no schema ${name}`);
  return validate;
};

const PREFIX = '/apps/specter-arena/api';
const ROSTER = rosterBody('default').items;
const ATLAS = ROSTER[0]?.bindingId ?? '';
const BRINDLE = ROSTER[1]?.bindingId ?? '';
const CINDER = ROSTER[2]?.bindingId ?? '';
const attemptOf = (bindingId: string, index: number): string => attemptsBody('default', bindingId)?.items[index]?.attemptId ?? '';
const REQ = (n: number) => `wrq_${String(n).padStart(24, '0')}`;

interface Reply {
  status: number;
  body: any;
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Reply> {
  const [pathname = '', search = ''] = path.split('?');
  const response = await workResponse(`${PREFIX}${pathname}`, method, body, search === '' ? '' : `?${search}`);
  if (response === null) throw new Error(`not a work route: ${path}`);
  return { status: response.status, body: await response.json() };
}

const create = (n: number, attemptIds: string[], extra: Record<string, unknown> = {}) =>
  call('POST', '/work', { requestId: REQ(n), title: `Item ${n}`, acceptanceCondition: 'Looks right.', rewardable: true, attemptIds, milestones: [], ...extra });

const decide = (workId: string, version: number, action: string, extra: Record<string, unknown> = {}, n = Math.random() * 1e9) =>
  call('POST', `/work/${workId}/decisions`, { requestId: REQ(Math.floor(n)), expectedVersion: version, action, ...extra });

async function acceptFlow(attemptIds: string[], n: number): Promise<Reply> {
  const created = await create(n, attemptIds);
  const submitted = await decide(created.body.workId, created.body.version, 'submit');
  return decide(submitted.body.workId, submitted.body.version, 'accept', { evidenceRevision: submitted.body.evidenceRevision });
}

const xpOf = async (bindingId: string): Promise<number> => ((await call('GET', '/xp')).body.items.find((item: any) => item.bindingId === bindingId)?.totalXp ?? 0) as number;

beforeEach(() => {
  resetWorkFixtures();
  setFixtureScenario(null);
});

describe('F-1 scenario names and routing', () => {
  it('are unique across the monitoring, Specter and Work families', () => {
    const all = [...SCENARIO_NAMES, ...SPECTER_SCENARIO_NAMES, ...WORK_SCENARIO_NAMES];
    expect(new Set(all).size).toBe(all.length);
  });

  it('defaults to work-none and follows the override', () => {
    expect(activeWorkScenario()).toBe('work-none');
    setWorkScenario('work');
    expect(activeWorkScenario()).toBe('work');
  });

  it('serves nothing for paths that are not Work routes', () => {
    expect(workResponse(`${PREFIX}/roster`, 'GET')).toBeNull();
    expect(workResponse(`${PREFIX}/specters`, 'GET')).toBeNull();
    expect(workResponse(`${PREFIX}/roster/${ATLAS}/attempts`, 'GET')).toBeNull();
  });

  it('refuses the wrong method on a Work route', async () => {
    expect((await call('POST', '/xp', {})).status).toBe(405);
    expect((await call('GET', '/work/wrk_000000000000000000000001/decisions')).status).toBe(405);
  });
});

describe.each(WORK_SCENARIO_NAMES.filter((name) => ['work-none', 'work', 'work-many', 'work-long', 'work-stale', 'work-conflict'].includes(name)))(
  'F-2 %s bodies validate against the contracts',
  (scenario: WorkScenarioName) => {
    it('serves work-items, each work-item, xp-summaries and each xp-history', async () => {
      setWorkScenario(scenario);
      const list = await call('GET', '/work');
      expect(validator('work-items')(list.body), JSON.stringify(validator('work-items').errors)).toBe(true);
      for (const item of list.body.items) {
        const one = await call('GET', `/work/${item.workId}`);
        expect(validator('work-item')(one.body), JSON.stringify(validator('work-item').errors)).toBe(true);
        expect(one.body).toEqual(item);
      }
      const summaries = await call('GET', '/xp');
      expect(validator('xp-summaries')(summaries.body), JSON.stringify(validator('xp-summaries').errors)).toBe(true);
      for (const summary of summaries.body.items) {
        const history = await call('GET', `/roster/${summary.bindingId}/xp`);
        expect(validator('xp-history')(history.body), JSON.stringify(validator('xp-history').errors)).toBe(true);
        expect(history.body.summary).toEqual(summary);
      }
    });
  },
);

describe('seeds in the work scenario', () => {
  beforeEach(() => setWorkScenario('work'));

  it('lists thirteen items newest first', async () => {
    const list = await call('GET', '/work');
    expect(list.body.items).toHaveLength(13);
    expect(list.body.items[0].title).toBe('Reconcile petty cash');
    expect(list.body.items.map((item: any) => item.createdAtMs)).toEqual([...list.body.items.map((item: any) => item.createdAtMs)].sort((a, b) => b - a));
  });

  it('prints the xp summaries Atlas 150, Brindle 50, Cinder 100', async () => {
    const { items } = (await call('GET', '/xp')).body;
    expect(items.map((item: any) => [item.bindingId, item.totalXp, item.level, item.acceptedWorkCount])).toEqual([
      [ATLAS, 150, 2, 2],
      [BRINDLE, 50, 1, 1],
      [CINDER, 100, 2, 1],
    ]);
    expect(items[0]).toMatchObject({ levelFloorXp: 100, nextLevelXp: 250, levelTableVersion: 'levels-1', policyVersion: 'xp-policy-1' });
  });

  it('shows Brindle an award, an award and a correction', async () => {
    const { items } = (await call('GET', `/roster/${BRINDLE}/xp`)).body;
    expect(items.map((entry: any) => [entry.kind, entry.amount])).toEqual([
      ['correction', -100],
      ['award', 100],
      ['award', 50],
    ]);
  });

  it('gives each state its seeded item, with unknown progress, a container, a missing attempt and an unrewarded item', async () => {
    const byTitle = new Map<string, any>((await call('GET', '/work')).body.items.map((item: any) => [item.title, item]));
    expect(new Set([...byTitle.values()].map((item) => item.state))).toEqual(new Set(['accepted', 'reopened', 'awaiting-review', 'open', 'blocked', 'rejected', 'cancelled']));
    expect(byTitle.get('Migrate the nightly report')).toMatchObject({ progress: { done: 1, total: 3 }, review: { canAccept: true, blockers: [] } });
    expect(byTitle.get('Migrate the nightly report').contributors.map((c: any) => c.bindingId)).toEqual([ATLAS, BRINDLE]);
    expect(byTitle.get('Summarize the support backlog')).toMatchObject({ progress: null });
    expect(byTitle.get('Summarize the support backlog').review.blockers).toContain('attempts-not-ended');
    expect(byTitle.get('Quarterly close')).toMatchObject({ childCount: 2, childrenAccepted: 1 });
    expect(byTitle.get('Quarterly close').review.blockers).toContain('children-not-accepted');
    expect(byTitle.get('Reconcile petty cash')).toMatchObject({ review: { canAccept: false, blockers: ['attempt-missing'] } });
    expect(byTitle.get('Reconcile petty cash').attempts[0]).toMatchObject({ present: false, ended: false, startedMs: null });
    expect(byTitle.get('Check the vendor invoice totals')).toMatchObject({ rewardable: false, bountyXp: 0 });
    expect(byTitle.get('Rotate the staging keys').contributors[0].xpNet).toBe(0);
    expect(byTitle.get('Reconcile the Q3 invoices').decisions.map((d: any) => [d.seq, d.action, d.actor])).toEqual([
      [1, 'submit', 'app-owner'],
      [2, 'accept', 'app-owner'],
    ]);
  });
});

describe('F-3 the bounty split', () => {
  it.each([
    [[() => attemptOf(BRINDLE, 0)], [100]],
    [[() => attemptOf(BRINDLE, 0), () => attemptOf(ATLAS, 2)], [50, 50]],
  ])('splits 100 across the contributors of one accepted item', async (pickers, expected) => {
    const result = await acceptFlow(pickers.map((pick) => pick()), 1);
    expect(result.status).toBe(200);
    expect(result.body.state).toBe('accepted');
    expect(result.body.contributors.map((c: any) => c.xpNet)).toEqual(expected);
    expect(result.body.contributors.reduce((sum: number, c: any) => sum + c.xpNet, 0)).toBe(100);
  });

  it('gives the first contributors the remainder when 100 does not divide', async () => {
    setWorkScenario('work');
    const spare = (bot: number, index: number) => `att_${'d'.repeat(16)}${bot.toString(16).padStart(4, '0')}${(index + 1).toString(16).padStart(4, '0')}`;
    const result = await acceptFlow([spare(1, 2), spare(2, 4), spare(3, 2)], 5);
    expect(result.body.state).toBe('accepted');
    expect(result.body.contributors.map((c: any) => [c.bindingId, c.xpNet])).toEqual([
      [ATLAS, 34],
      [BRINDLE, 33],
      [CINDER, 33],
    ]);
  });

  it('refuses to accept while a linked attempt is still open', async () => {
    const result = await acceptFlow([attemptOf(ATLAS, 0)], 6);
    expect(result.body.error).toBe('attempts_not_ended');
  });
});

describe('F-4 refusals write nothing', () => {
  it('names each refusal and leaves state, version and xp unchanged', async () => {
    const open = (await create(1, [attemptOf(ATLAS, 0)])).body;
    const submitted = (await decide(open.workId, open.version, 'submit')).body;
    const before = JSON.stringify([(await call('GET', `/work/${open.workId}`)).body, await call('GET', '/xp')]);
    const open1 = await decide(submitted.workId, submitted.version, 'accept', { evidenceRevision: submitted.evidenceRevision });
    expect(open1.body.error).toBe('attempts_not_ended');
    const none = (await create(2, [])).body;
    const noneSubmitted = (await decide(none.workId, none.version, 'submit')).body;
    expect((await decide(none.workId, noneSubmitted.version, 'accept', { evidenceRevision: noneSubmitted.evidenceRevision })).body.error).toBe('no_evidence');
    expect((await decide(noneSubmitted.workId, noneSubmitted.version, 'accept', { evidenceRevision: '0'.repeat(24) })).body.error).toBe('stale_evidence');
    expect((await decide(noneSubmitted.workId, noneSubmitted.version + 5, 'block')).body.error).toBe('version_conflict');
    expect((await decide(noneSubmitted.workId, noneSubmitted.version, 'unblock')).body.error).toBe('invalid_transition');
    expect((await call('GET', `/work/${none.workId}`)).body).toEqual(noneSubmitted);
    expect(JSON.stringify([(await call('GET', `/work/${open.workId}`)).body, await call('GET', '/xp')])).toBe(before);
    expect(await xpOf(ATLAS)).toBe(0);
  });

  it('refuses an evidence action without a revision and a revision on another action', async () => {
    const made = (await create(1, [attemptOf(BRINDLE, 0)])).body;
    expect((await decide(made.workId, made.version, 'accept')).body.error).toBe('invalid_body');
    expect((await decide(made.workId, made.version, 'submit', { evidenceRevision: made.evidenceRevision })).body.error).toBe('invalid_body');
    expect((await decide(made.workId, made.version, 'explode')).body.error).toBe('invalid_body');
    expect((await decide(made.workId, made.version, 'submit', { surprise: 1 })).body.error).toBe('invalid_body');
  });

  it('refuses an accepted parent when its children are not accepted', async () => {
    setWorkScenario('work');
    const close = (await call('GET', '/work')).body.items.find((item: any) => item.title === 'Quarterly close');
    const submitted = (await decide(close.workId, close.version, 'submit')).body;
    expect((await decide(close.workId, submitted.version, 'accept', { evidenceRevision: submitted.evidenceRevision })).body.error).toBe('children_not_accepted');
  });
});

describe('F-5 reopen and re-accept', () => {
  it('takes the award back and reinstates the same amount, never more', async () => {
    const accepted = (await acceptFlow([attemptOf(BRINDLE, 0)], 1)).body;
    expect(await xpOf(BRINDLE)).toBe(100);
    const reopened = (await decide(accepted.workId, accepted.version, 'reopen')).body;
    expect(reopened.state).toBe('reopened');
    expect(await xpOf(BRINDLE)).toBe(0);
    const submitted = (await decide(reopened.workId, reopened.version, 'submit')).body;
    const again = (await decide(submitted.workId, submitted.version, 'accept', { evidenceRevision: submitted.evidenceRevision })).body;
    expect(again.state).toBe('accepted');
    expect(await xpOf(BRINDLE)).toBe(100);
    const history = (await call('GET', `/roster/${BRINDLE}/xp`)).body.items.map((entry: any) => [entry.kind, entry.amount]);
    expect(history).toEqual([
      ['reinstatement', 100],
      ['correction', -100],
      ['award', 100],
    ]);
  });

  it('awards nothing for an item without xp and for a rejection', async () => {
    const plain = (await create(1, [attemptOf(BRINDLE, 0)], { rewardable: false })).body;
    const submitted = (await decide(plain.workId, plain.version, 'submit')).body;
    await decide(plain.workId, submitted.version, 'accept', { evidenceRevision: submitted.evidenceRevision });
    expect(await xpOf(BRINDLE)).toBe(0);
    const other = (await create(2, [attemptOf(ATLAS, 2)])).body;
    const otherSubmitted = (await decide(other.workId, other.version, 'submit')).body;
    const rejected = (await decide(other.workId, otherSubmitted.version, 'reject', { evidenceRevision: otherSubmitted.evidenceRevision, note: 'No.' })).body;
    expect(rejected).toMatchObject({ state: 'rejected' });
    expect(rejected.decisions.at(-1)).toMatchObject({ note: 'No.', action: 'reject' });
    expect(await xpOf(ATLAS)).toBe(0);
  });
});

describe('F-6 idempotent create and decide', () => {
  it('replays the same request id as 200 and refuses it with different fields', async () => {
    const first = await create(1, [attemptOf(BRINDLE, 0)]);
    expect(first.status).toBe(201);
    const again = await create(1, [attemptOf(BRINDLE, 0)]);
    expect(again.status).toBe(200);
    expect(again.body.workId).toBe(first.body.workId);
    expect((await create(1, [attemptOf(BRINDLE, 0)], { title: 'Different' })).body.error).toBe('request_reused');
    expect((await call('GET', '/work')).body.items).toHaveLength(1);
  });

  it('records a decision once when its request id is retried', async () => {
    const made = (await create(1, [attemptOf(BRINDLE, 0)])).body;
    const body = { requestId: REQ(777), expectedVersion: made.version, action: 'submit' };
    const first = await call('POST', `/work/${made.workId}/decisions`, body);
    const second = await call('POST', `/work/${made.workId}/decisions`, body);
    expect(second.status).toBe(200);
    expect(second.body.decisions).toHaveLength(1);
    expect(first.body.version).toBe(second.body.version);
    expect((await call('POST', `/work/${made.workId}/decisions`, { ...body, action: 'block' })).body.error).toBe('request_reused');
  });
});

describe('F-7 linking attempts', () => {
  it('refuses an attempt that is linked, unknown, or past the limit, and unknown keys', async () => {
    const made = (await create(1, [attemptOf(BRINDLE, 0)])).body;
    expect((await create(2, [attemptOf(BRINDLE, 0)])).body.error).toBe('attempt_already_linked');
    expect((await create(3, ['att_' + 'f'.repeat(24)])).body.error).toBe('unknown_attempt');
    expect((await create(4, [], { surprise: true })).body.error).toBe('invalid_body');
    expect((await create(5, Array.from({ length: 17 }, (_, i) => `att_${String(i).padStart(24, '0')}`))).body.error).toBe('invalid_body');
    expect((await call('POST', `/work/${made.workId}/attempts`, { expectedVersion: made.version, attemptId: attemptOf(BRINDLE, 0) })).body.error).toBe('attempt_already_linked');
    expect((await call('POST', `/work/${made.workId}/attempts`, { expectedVersion: made.version + 1, attemptId: attemptOf(ATLAS, 2) })).body.error).toBe('version_conflict');
    expect((await call('POST', `/work/${made.workId}/attempts`, { expectedVersion: made.version, attemptId: 'att_' + 'f'.repeat(24) })).body.error).toBe('unknown_attempt');
    const linked = await call('POST', `/work/${made.workId}/attempts`, { expectedVersion: made.version, attemptId: attemptOf(ATLAS, 2) });
    expect(linked.body.attempts).toHaveLength(2);
    expect(linked.body.version).toBe(made.version + 1);
  });

  it('refuses a missing item and a locked parent', async () => {
    expect((await call('GET', '/work/wrk_000000000000000000000fff')).body.error).toBe('unknown_work');
    expect((await call('GET', '/work/not-an-id')).status).toBe(404);
    expect((await create(1, [], { parentId: 'wrk_000000000000000000000fff' })).body.error).toBe('unknown_work');
    const accepted = (await acceptFlow([attemptOf(BRINDLE, 0)], 2)).body;
    expect((await create(3, [], { parentId: accepted.workId })).body.error).toBe('parent_locked');
    const parent = (await create(4, [])).body;
    const child = await create(5, [attemptOf(ATLAS, 2)], { parentId: parent.workId });
    expect(child.body.parentId).toBe(parent.workId);
    expect((await call('GET', `/work/${parent.workId}`)).body).toMatchObject({ childCount: 1, childrenAccepted: 0 });
  });
});

describe('milestones', () => {
  it('toggles a milestone and counts progress, and refuses a bad position or a stale version', async () => {
    const made = (await create(1, [], { milestones: ['One', 'Two'] })).body;
    expect(made.progress).toEqual({ done: 0, total: 2 });
    const marked = await call('POST', `/work/${made.workId}/milestones`, { expectedVersion: made.version, position: 2, done: true });
    expect(marked.body.progress).toEqual({ done: 1, total: 2 });
    expect(marked.body.milestones[1].doneAtMs).not.toBeNull();
    const cleared = await call('POST', `/work/${made.workId}/milestones`, { expectedVersion: marked.body.version, position: 2, done: false });
    expect(cleared.body.milestones[1].doneAtMs).toBeNull();
    expect((await call('POST', `/work/${made.workId}/milestones`, { expectedVersion: made.version, position: 1, done: true })).body.error).toBe('version_conflict');
    expect((await call('POST', `/work/${made.workId}/milestones`, { expectedVersion: cleared.body.version, position: 3, done: true })).body.error).toBe('invalid_body');
    expect((await call('POST', `/work/${made.workId}/milestones`, { expectedVersion: cleared.body.version, position: 1, done: 1 })).body.error).toBe('invalid_body');
    expect((await call('POST', '/work/wrk_000000000000000000000fff/milestones', { expectedVersion: 1, position: 1, done: true })).body.error).toBe('unknown_work');
  });
});

describe('F-8 paging, filters and one-shot failures', () => {
  it('serves thirty items as 25 and 5, filters by state and refuses a bad filter or cursor', async () => {
    setWorkScenario('work-many');
    const first = await call('GET', '/work');
    expect(first.body.items).toHaveLength(25);
    expect(first.body.nextCursor).toBe('c_25');
    const second = await call('GET', `/work?cursor=${first.body.nextCursor}`);
    expect(second.body.items).toHaveLength(5);
    expect(second.body.nextCursor).toBeNull();
    expect(new Set([...first.body.items, ...second.body.items].map((item: any) => item.workId)).size).toBe(30);
    expect((await call('GET', '/work?state=accepted')).body.items).toEqual([]);
    expect((await call('GET', '/work?state=open&limit=3')).body.items).toHaveLength(3);
    expect((await call('GET', '/work?state=bogus')).body.error).toBe('invalid_state');
    expect((await call('GET', '/work?cursor=nope')).body.error).toBe('invalid_cursor');
  });

  it('pages sixty xp entries as 50 and 10', async () => {
    setWorkScenario('work-many');
    const first = (await call('GET', `/roster/${ATLAS}/xp`)).body;
    expect(first.items).toHaveLength(50);
    const second = (await call('GET', `/roster/${ATLAS}/xp?cursor=${first.nextCursor}`)).body;
    expect(second.items).toHaveLength(10);
    expect(second.nextCursor).toBeNull();
    expect(first.summary).toMatchObject({ totalXp: 300, acceptedWorkCount: 60 });
  });

  it('fails the first stale accept once, with a new evidence revision, then accepts', async () => {
    setWorkScenario('work-stale');
    const item = (await call('GET', '/work')).body.items.find((entry: any) => entry.title === 'Migrate the nightly report');
    const refused = await decide(item.workId, item.version, 'accept', { evidenceRevision: item.evidenceRevision });
    expect(refused).toMatchObject({ status: 409, body: { error: 'stale_evidence' } });
    const reloaded = (await call('GET', `/work/${item.workId}`)).body;
    expect(reloaded.evidenceRevision).not.toBe(item.evidenceRevision);
    expect(reloaded.version).toBe(item.version);
    const accepted = await decide(item.workId, reloaded.version, 'accept', { evidenceRevision: reloaded.evidenceRevision });
    expect(accepted.body.state).toBe('accepted');
  });

  it('fails the first decision with a version conflict, then succeeds', async () => {
    setWorkScenario('work-conflict');
    const item = (await call('GET', '/work')).body.items.find((entry: any) => entry.title === 'Summarize the support backlog');
    const refused = await decide(item.workId, item.version, 'submit');
    expect(refused).toMatchObject({ status: 409, body: { error: 'version_conflict' } });
    const reloaded = (await call('GET', `/work/${item.workId}`)).body;
    expect(reloaded.version).toBe(item.version + 1);
    expect((await decide(item.workId, reloaded.version, 'submit')).body.state).toBe('awaiting-review');
  });

  it('serves a long item with the longest fields', async () => {
    setWorkScenario('work-long');
    const item = (await call('GET', '/work')).body.items[0];
    expect(item.attempts).toHaveLength(16);
    expect(item.milestones).toHaveLength(8);
    expect([...item.title].length).toBeGreaterThan(100);
    expect(item.decisions.map((d: any) => [...d.note].length)).toEqual([280, 280]);
  });
});

describe('F-9 history for a bot without entries', () => {
  it('returns the zero summary and no entries, and 404 for an unknown binding', async () => {
    const empty = (await call('GET', `/roster/${ATLAS}/xp`)).body;
    expect(empty).toMatchObject({ items: [], nextCursor: null, summary: { totalXp: 0, level: 1, levelFloorXp: 0, nextLevelXp: 100, acceptedWorkCount: 0 } });
    expect((await call('GET', '/roster/bnd_zzz/xp')).body.error).toBe('unknown_binding');
    expect((await call('GET', `/roster/bnd_${'9'.repeat(24)}/xp`)).status).toBe(404);
  });

  it('lists no xp summary for a store without entries', async () => {
    expect((await call('GET', '/xp')).body.items).toEqual([]);
    expect((await call('GET', '/work')).body.items).toEqual([]);
  });
});

describe('failure scenarios', () => {
  it.each([
    ['work-failure', 503, 'store_not_ready'],
    ['work-unsupported', 404, 'not_found'],
  ] as const)('%s answers every list and xp route', async (scenario, status, error) => {
    setWorkScenario(scenario);
    for (const path of ['/work', '/xp', `/roster/${ATLAS}/xp`]) {
      expect(await call('GET', path)).toMatchObject({ status, body: { error } });
    }
  });

  it('rejects when offline and answers 403 with no body when expired', async () => {
    setWorkScenario('work-offline');
    await expect(workResponse(`${PREFIX}/work`, 'GET')).rejects.toThrow('Failed to fetch');
    setWorkScenario('work-expired');
    expect((await workResponse(`${PREFIX}/xp`, 'GET'))?.status).toBe(403);
  });
});
