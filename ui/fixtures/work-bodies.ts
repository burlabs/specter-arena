// SPECTER-FIXTURE-ONLY: FIXTURE Work and XP routes for the preview harness and unit tests; never imported by ui/src.
import type { WorkAttemptV1, WorkDecisionV1, WorkItemV1, WorkListItemV1, XpEntryV1, XpSummaryV1 } from '../src/contracts/types.ts';
import { appApiPath } from '../src/host/paths.ts';
import { canonicalArenaScenario, perfItems } from './arena-scenarios.ts';
import { FIXTURE_NOW_MS, activeScenario, attemptsBody, rosterBody } from './monitoring-bodies.ts';

export const WORK_SCENARIO_NAMES = [
  'work-none',
  'work',
  'work-many',
  'work-long',
  'work-stale',
  'work-conflict',
  'work-failure',
  'work-offline',
  'work-expired',
  'work-unsupported',
  'arena-perf-work',
  'arena-stale-work',
] as const;
export type WorkScenarioName = (typeof WORK_SCENARIO_NAMES)[number];

const POLICY_VERSION = 'xp-policy-1';
const LEVEL_TABLE_VERSION = 'levels-1';
const BOUNTY_XP = 100;
const MAX_ATTEMPTS = 16;
const MAX_MILESTONES = 8;
const LIST_PAGE = 25;
const HISTORY_PAGE = 50;
const STEP_MS = 60_000;

/** Copy of LEVEL_FLOORS in backend/specter_arena/store/xp_policy.py (SC8-2); the backend is the authority. */
const LEVEL_FLOORS: readonly number[] = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200];

const STATES = ['open', 'awaiting-review', 'blocked', 'rejected', 'cancelled', 'accepted', 'reopened'];

/** The transition table of the backend (store/work.py TRANSITIONS). */
const TRANSITIONS: Readonly<Record<string, { from: readonly string[]; to: string }>> = {
  submit: { from: ['open', 'reopened'], to: 'awaiting-review' },
  accept: { from: ['awaiting-review'], to: 'accepted' },
  reject: { from: ['awaiting-review'], to: 'rejected' },
  block: { from: ['open', 'reopened', 'awaiting-review'], to: 'blocked' },
  unblock: { from: ['blocked'], to: 'open' },
  cancel: { from: ['open', 'awaiting-review', 'blocked', 'rejected', 'reopened'], to: 'cancelled' },
  reopen: { from: ['accepted', 'rejected'], to: 'reopened' },
};

const hex = (n: number, width: number): string => n.toString(16).padStart(width, '0');
const bindingIdOf = (n: number): string => `bnd_${'a'.repeat(20)}${hex(n, 4)}`;
const workIdOf = (n: number): string => `wrk_${hex(n, 24)}`;
const decisionIdOf = (n: number): string => `dec_${hex(n, 24)}`;
const entryIdOf = (n: number): string => `xpe_${hex(n, 24)}`;
const syntheticAttemptId = (bot: number, index: number): string => `att_${'d'.repeat(16)}${hex(bot, 4)}${hex(index + 1, 4)}`;

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const BINDING_ID = /^bnd_[0-9a-f]{24}$/;
const WORK_ID = /^wrk_[0-9a-f]{24}$/;
const ATTEMPT_ID = /^att_[0-9a-f]{24}$/;
const REVISION = /^[0-9a-f]{24}$/;

const hashHex = (text: string): string => {
  let out = '';
  for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b1]) {
    let h = seed;
    for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 0x01000193) >>> 0;
    out += hex(h, 8);
  }
  return out;
};

interface Fact {
  attemptId: string;
  bindingId: string;
  kind: string;
  startedMs: number;
  endedMs: number | null;
  endSignal: string | null;
}

const SYNTHETIC_ENDED_MS = FIXTURE_NOW_MS - 7_200_000;

/** Attempts the seeds link that the monitoring fixtures do not list. They are ended, so a review can accept them. */
const syntheticFact = (bot: number, index: number): Fact => ({
  attemptId: syntheticAttemptId(bot, index),
  bindingId: bindingIdOf(bot),
  kind: 'bot-turn',
  startedMs: SYNTHETIC_ENDED_MS - 600_000,
  endedMs: SYNTHETIC_ENDED_MS,
  endSignal: 'chat-done',
});

interface Stored {
  workId: string;
  parentId: string | null;
  title: string;
  condition: string;
  rewardable: boolean;
  state: string;
  version: number;
  createdAtMs: number;
  updatedAtMs: number;
  attemptIds: string[];
  milestones: { label: string; doneAtMs: number | null }[];
  decisions: WorkDecisionV1[];
  salt: number;
  requestToken: string;
  fingerprint: string;
}

interface Entry {
  entryId: string;
  workId: string;
  workTitle: string;
  bindingId: string;
  kind: string;
  amount: number;
  decisionId: string;
  createdAtMs: number;
}

interface FixtureState {
  scenario: WorkScenarioName;
  items: Map<string, Stored>;
  entries: Entry[];
  synthetic: Map<string, Fact>;
  decisionReplays: Map<string, { key: string; item: Stored }>;
  failedOnce: Set<string>;
  counter: number;
  tick: number;
}

let override: WorkScenarioName | null = null;

export function setWorkScenario(name: WorkScenarioName | null): void {
  override = name;
}

const isWorkScenario = (value: string | null): value is WorkScenarioName => WORK_SCENARIO_NAMES.some((name) => name === value);

/** The test override, else `?scenario=` on the page URL; every other name is `work-none`. */
export function activeWorkScenario(): WorkScenarioName {
  if (override !== null) return override;
  const requested = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('scenario');
  const named = canonicalArenaScenario(requested, { arena: 'work', perf: 'arena-perf-work', stale: 'arena-stale-work', empty: 'work-none' });
  return isWorkScenario(named) ? named : 'work-none';
}

let store: FixtureState | null = null;

export function resetWorkFixtures(): void {
  store = null;
  override = null;
}

const clock = (state: FixtureState): number => {
  state.tick += 1;
  return FIXTURE_NOW_MS + state.tick * STEP_MS;
};

/** An attempt as the attempts record reports it now: a synthetic seed fact or one of the monitoring scenario's attempts. */
function lookupFact(state: FixtureState, attemptId: string): Fact | null {
  const known = state.synthetic.get(attemptId);
  if (known !== undefined) return known;
  const monitoring = activeScenario();
  for (const bot of rosterBody(monitoring).items) {
    const found = attemptsBody(monitoring, bot.bindingId)?.items.find((item) => item.attemptId === attemptId);
    if (found !== undefined) {
      return {
        attemptId,
        bindingId: bot.bindingId,
        kind: found.kind,
        startedMs: found.startedMs,
        endedMs: found.endedMs,
        endSignal: found.endSignal,
      };
    }
  }
  return null;
}

function attemptViews(state: FixtureState, item: Stored): WorkAttemptV1[] {
  return item.attemptIds.map((attemptId) => {
    const fact = lookupFact(state, attemptId);
    if (fact === null) {
      return { attemptId, bindingId: bindingIdOf(1), kind: 'bot-turn', startedMs: null, endedMs: null, endSignal: null, ended: false, present: false };
    }
    return {
      attemptId,
      bindingId: fact.bindingId,
      kind: fact.kind,
      startedMs: fact.startedMs,
      endedMs: fact.endedMs,
      endSignal: fact.endSignal,
      ended: fact.endedMs !== null,
      present: true,
    };
  });
}

/** Fixture-grade stand-in for the backend's sha256 evidence revision: a 24-hex hash of the same canonical facts. */
const revisionOf = (item: Stored, attempts: readonly WorkAttemptV1[]): string =>
  hashHex(
    JSON.stringify([
      item.salt,
      [...attempts]
        .map((a) => [a.attemptId, a.bindingId, a.kind, a.startedMs, a.endedMs, a.present && !a.ended, a.endSignal])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    ]),
  );

const childrenOf = (state: FixtureState, workId: string): Stored[] => [...state.items.values()].filter((other) => other.parentId === workId);

const netFor = (state: FixtureState, workId: string, bindingId: string): number =>
  state.entries.filter((entry) => entry.workId === workId && entry.bindingId === bindingId).reduce((sum, entry) => sum + entry.amount, 0);

function blockersOf(state: FixtureState, item: Stored, attempts: readonly WorkAttemptV1[]): string[] {
  const found: string[] = [];
  if (item.state !== 'awaiting-review') found.push('wrong-state');
  const children = childrenOf(state, item.workId);
  if (children.length > 0) {
    const live = children.filter((child) => child.state !== 'cancelled');
    if (live.some((child) => child.state !== 'accepted') || !live.some((child) => child.state === 'accepted')) found.push('children-not-accepted');
  } else if (attempts.length === 0) {
    found.push('no-evidence');
  } else {
    if (attempts.some((a) => !a.present)) found.push('attempt-missing');
    if (attempts.some((a) => a.present && !a.ended)) found.push('attempts-not-ended');
  }
  return found;
}

function viewOf(state: FixtureState, item: Stored): WorkItemV1 {
  const attempts = attemptViews(state, item);
  const counts = new Map<string, number>();
  for (const attempt of attempts) counts.set(attempt.bindingId, (counts.get(attempt.bindingId) ?? 0) + 1);
  const children = childrenOf(state, item.workId);
  const blockers = blockersOf(state, item, attempts);
  const done = item.milestones.filter((milestone) => milestone.doneAtMs !== null).length;
  return {
    contractVersion: 1,
    workId: item.workId,
    parentId: item.parentId,
    title: item.title,
    acceptanceCondition: item.condition,
    rewardable: item.rewardable,
    bountyXp: item.rewardable ? BOUNTY_XP : 0,
    policyVersion: POLICY_VERSION,
    state: item.state,
    version: item.version,
    createdAtMs: item.createdAtMs,
    updatedAtMs: item.updatedAtMs,
    attempts,
    contributors: [...counts.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([bindingId, attemptCount]) => ({ bindingId, attemptCount, xpNet: Math.max(0, netFor(state, item.workId, bindingId)) })),
    milestones: item.milestones.map((milestone, index) => ({ position: index + 1, label: milestone.label, doneAtMs: milestone.doneAtMs })),
    progress: item.milestones.length === 0 ? null : { done, total: item.milestones.length },
    evidenceRevision: revisionOf(item, attempts),
    childCount: children.length,
    childrenAccepted: children.filter((child) => child.state === 'accepted').length,
    review: { canAccept: blockers.length === 0, blockers },
    decisions: item.decisions.slice(-50),
  };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, error: string): Response => json({ contractVersion: 1, error }, status);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnly = (body: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean =>
  Object.keys(body).every((key) => allowed.includes(key)) && required.every((key) => key in body);
const isVersion = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1;

function levelOf(total: number): { level: number; floor: number; next: number | null } {
  let index = 0;
  while (index + 1 < LEVEL_FLOORS.length && total >= (LEVEL_FLOORS[index + 1] ?? Infinity)) index += 1;
  return { level: index + 1, floor: LEVEL_FLOORS[index] ?? 0, next: LEVEL_FLOORS[index + 1] ?? null };
}

function summaryOf(state: FixtureState, bindingId: string): XpSummaryV1 {
  const mine = state.entries.filter((entry) => entry.bindingId === bindingId);
  const total = mine.reduce((sum, entry) => sum + entry.amount, 0);
  const nets = new Map<string, number>();
  for (const entry of mine) nets.set(entry.workId, (nets.get(entry.workId) ?? 0) + entry.amount);
  const { level, floor, next } = levelOf(total);
  return {
    contractVersion: 1,
    bindingId,
    totalXp: total,
    level,
    levelTableVersion: LEVEL_TABLE_VERSION,
    levelFloorXp: floor,
    nextLevelXp: next,
    acceptedWorkCount: [...nets.values()].filter((net) => net > 0).length,
    policyVersion: POLICY_VERSION,
  };
}

/** SC8-2 split_bounty: ids ascending, bounty // n each, the first bounty % n ids get one more. */
function splitBounty(bounty: number, ids: readonly string[]): Map<string, number> {
  const sorted = [...ids].sort();
  const base = Math.floor(bounty / sorted.length);
  const extra = bounty % sorted.length;
  return new Map(sorted.map((id, index) => [id, base + (index < extra ? 1 : 0)]));
}

function writeXp(state: FixtureState, item: Stored, action: string, decisionId: string, atMs: number): void {
  const attempts = attemptViews(state, item);
  const contributors = [...new Set(attempts.map((a) => a.bindingId))].sort();
  const push = (bindingId: string, kind: string, amount: number) => {
    state.counter += 1;
    state.entries.push({ entryId: entryIdOf(state.counter), workId: item.workId, workTitle: item.title, bindingId, kind, amount, decisionId, createdAtMs: atMs });
  };
  if (action === 'accept' && item.rewardable && childrenOf(state, item.workId).length === 0 && contributors.length > 0) {
    const previous = state.entries.filter((entry) => entry.workId === item.workId);
    if (previous.length === 0) {
      for (const [bindingId, amount] of splitBounty(BOUNTY_XP, contributors)) push(bindingId, 'award', amount);
    } else {
      for (const bindingId of contributors) {
        const last = [...previous].reverse().find((entry) => entry.bindingId === bindingId);
        const award = previous.find((entry) => entry.bindingId === bindingId && entry.kind === 'award');
        if (last?.kind === 'correction' && award !== undefined) push(bindingId, 'reinstatement', award.amount);
      }
    }
  }
  if (action === 'reopen' && item.state === 'accepted') {
    for (const bindingId of contributors) {
      const net = netFor(state, item.workId, bindingId);
      if (net > 0) push(bindingId, 'correction', -net);
    }
  }
}

type Outcome = { ok: true; item: Stored } | { ok: false; status: number; error: string };

/** Applies one decision with the server's rules. Nothing is written on a refusal. */
function applyDecision(state: FixtureState, item: Stored, input: { action: string; expectedVersion: number; evidenceRevision: string | null; note: string | null; atMs: number }): Outcome {
  const rule = TRANSITIONS[input.action];
  if (rule === undefined) return { ok: false, status: 400, error: 'invalid_body' };
  if (input.expectedVersion !== item.version) return { ok: false, status: 409, error: 'version_conflict' };
  if (!rule.from.includes(item.state)) return { ok: false, status: 409, error: 'invalid_transition' };
  const view = viewOf(state, item);
  if (input.action === 'accept' || input.action === 'reject') {
    if (input.evidenceRevision !== view.evidenceRevision) return { ok: false, status: 409, error: 'stale_evidence' };
  }
  if (input.action === 'accept') {
    const blockers = view.review.blockers.filter((blocker) => blocker !== 'wrong-state');
    const first = blockers[0];
    if (first !== undefined) return { ok: false, status: 409, error: first === 'attempt-missing' ? 'attempts_not_ended' : first.replaceAll('-', '_') };
  }
  const decisionId = decisionIdOf(item.decisions.length + 1 + Number.parseInt(item.workId.slice(-6), 16) * 100);
  writeXp(state, item, input.action, decisionId, input.atMs);
  const decision: WorkDecisionV1 = {
    decisionId,
    seq: item.decisions.length + 1,
    action: input.action,
    fromState: item.state,
    toState: rule.to,
    actor: 'app-owner',
    atMs: input.atMs,
    note: input.note,
    evidenceRevision: input.action === 'accept' || input.action === 'reject' ? view.evidenceRevision : null,
  };
  item.decisions.push(decision);
  item.state = rule.to;
  item.version += 1;
  item.updatedAtMs = input.atMs;
  return { ok: true, item };
}

interface SeedSpec {
  title: string;
  condition?: string;
  rewardable?: boolean;
  parent?: number;
  attempts?: readonly string[];
  milestones?: readonly { label: string; done: boolean }[];
  decisions?: readonly { action: string; note?: string }[];
}

function insertItem(state: FixtureState, n: number, createdAtMs: number, spec: SeedSpec): Stored {
  const item: Stored = {
    workId: workIdOf(n),
    parentId: spec.parent === undefined ? null : workIdOf(spec.parent),
    title: spec.title,
    condition: spec.condition ?? 'The owner has looked at the linked attempts and agrees the work is done.',
    rewardable: spec.rewardable ?? true,
    state: 'open',
    version: 1,
    createdAtMs,
    updatedAtMs: createdAtMs,
    attemptIds: [...(spec.attempts ?? [])],
    milestones: (spec.milestones ?? []).map((milestone) => ({ label: milestone.label, doneAtMs: milestone.done ? createdAtMs + STEP_MS / 2 : null })),
    decisions: [],
    salt: 0,
    requestToken: `seed_${hex(n, 8)}`,
    fingerprint: `seed:${n}`,
  };
  state.items.set(item.workId, item);
  let at = createdAtMs;
  for (const step of spec.decisions ?? []) {
    at += STEP_MS;
    const view = viewOf(state, item);
    const outcome = applyDecision(state, item, {
      action: step.action,
      expectedVersion: item.version,
      evidenceRevision: view.evidenceRevision,
      note: step.note ?? null,
      atMs: at,
    });
    if (!outcome.ok) throw new Error(`fixture seed ${n}: ${step.action} refused with ${outcome.error}`);
  }
  return item;
}

const BOT = { atlas: 1, brindle: 2, cinder: 3 } as const;
const realAttempt = (bot: number, index: number): string => `att_${'c'.repeat(16)}${hex(bot, 4)}${hex(index + 1, 4)}`;

function registerSynthetic(state: FixtureState, bot: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const fact = syntheticFact(bot, index);
    state.synthetic.set(fact.attemptId, fact);
    return fact.attemptId;
  });
}

function seedWork(state: FixtureState): void {
  const at = (n: number): number => FIXTURE_NOW_MS - (14 - n) * 600_000;
  const atlas = registerSynthetic(state, BOT.atlas, 3);
  const brindle = registerSynthetic(state, BOT.brindle, 4);
  const cinder = registerSynthetic(state, BOT.cinder, 2);
  const [a1 = '', a2 = ''] = atlas;
  const [b1 = '', b2 = '', b3 = '', b4 = ''] = brindle;
  const [c1 = '', c2 = ''] = cinder;
  registerSynthetic(state, BOT.brindle, 5);
  registerSynthetic(state, BOT.cinder, 3);
  const milestoneLabels = ['Match the ledger lines', 'Flag the gaps', 'Write the summary'];
  insertItem(state, 1, at(1), {
    title: 'Reconcile the Q3 invoices',
    attempts: [a1, b1],
    milestones: milestoneLabels.map((label) => ({ label, done: true })),
    decisions: [{ action: 'submit' }, { action: 'accept', note: 'Totals match the ledger.' }],
  });
  insertItem(state, 2, at(2), { title: 'Draft the vendor onboarding email', attempts: [a2], decisions: [{ action: 'submit' }, { action: 'accept' }] });
  insertItem(state, 3, at(3), { title: 'Rotate the staging keys', attempts: [b2], decisions: [{ action: 'submit' }, { action: 'accept' }, { action: 'reopen', note: 'One key was missed.' }] });
  insertItem(state, 4, at(4), {
    title: 'Migrate the nightly report',
    attempts: [realAttempt(BOT.brindle, 0), registerSynthetic(state, BOT.atlas, 4)[3] ?? ''],
    milestones: [
      { label: 'Copy the query', done: true },
      { label: 'Check the totals', done: false },
      { label: 'Switch the schedule', done: false },
    ],
    decisions: [{ action: 'submit' }],
  });
  insertItem(state, 5, at(5), { title: 'Summarize the support backlog', attempts: [realAttempt(BOT.atlas, 0)] });
  insertItem(state, 6, at(6), { title: 'Audit the shared drive permissions', attempts: [b3], decisions: [{ action: 'block', note: 'Waiting on the file owner' }] });
  insertItem(state, 7, at(7), { title: 'Rewrite the runbook intro', attempts: [registerSynthetic(state, BOT.atlas, 5)[4] ?? ''], decisions: [{ action: 'submit' }, { action: 'reject', note: 'Missing the rollback steps' }] });
  insertItem(state, 8, at(8), { title: 'Clean up stale tickets', decisions: [{ action: 'cancel' }] });
  insertItem(state, 9, at(9), { title: 'Quarterly close', condition: 'Every part of the close is accepted.' });
  insertItem(state, 10, at(10), { title: 'Close the books: accounts payable', parent: 9, attempts: [c1], decisions: [{ action: 'submit' }, { action: 'accept' }] });
  insertItem(state, 11, at(11), { title: 'Close the books: receivables', parent: 9, attempts: [c2] });
  insertItem(state, 12, at(12), { title: 'Check the vendor invoice totals', rewardable: false, attempts: [b4] });
  insertItem(state, 13, at(13), { title: 'Reconcile petty cash', attempts: [`att_${'e'.repeat(24)}`], decisions: [{ action: 'submit' }] });
}

const PERF_STEPS: Readonly<Record<string, readonly { action: string }[]>> = {
  open: [],
  'awaiting-review': [{ action: 'submit' }],
  blocked: [{ action: 'block' }],
  reopened: [{ action: 'submit' }, { action: 'accept' }, { action: 'reopen' }],
  accepted: [{ action: 'submit' }, { action: 'accept' }],
};

/** arena-perf-1: open leaves link the monitoring fixture's real working attempts; every other row links an ended synthetic one. */
function seedArenaPerf(state: FixtureState): void {
  const used = new Map<number, number>();
  const endedAttempt = (bot: number): string => {
    const index = used.get(bot) ?? 0;
    used.set(bot, index + 1);
    const fact = syntheticFact(bot, index);
    state.synthetic.set(fact.attemptId, fact);
    return fact.attemptId;
  };
  const isContainer = (n: number): boolean => n <= 10;
  for (const plan of perfItems()) {
    const attempts = isContainer(plan.n) ? [] : plan.workingAttempt !== null ? [realAttempt(plan.workingAttempt[0], plan.workingAttempt[1])] : [endedAttempt(plan.bot)];
    insertItem(state, plan.n, FIXTURE_NOW_MS - plan.ageMinutes * 60_000, {
      title: plan.title,
      parent: plan.parent ?? undefined,
      attempts,
      milestones: plan.milestones ? [{ label: 'Draft', done: true }, { label: 'Review', done: false }, { label: 'Ship', done: false }] : undefined,
      decisions: PERF_STEPS[plan.state] ?? [],
    });
  }
}

const LONG_LINE = 'A long line of text that keeps going so the layout has to wrap it somewhere sensible. ';

function seedLong(state: FixtureState): void {
  const attempts = registerSynthetic(state, BOT.atlas, MAX_ATTEMPTS);
  const note = LONG_LINE.repeat(4).slice(0, 280);
  insertItem(state, 1, FIXTURE_NOW_MS - 3_600_000, {
    title: LONG_LINE.repeat(2).slice(0, 120).trimEnd(),
    condition: LONG_LINE.repeat(4).slice(0, 280).trimEnd(),
    attempts,
    milestones: Array.from({ length: MAX_MILESTONES }, (_, index) => ({ label: `${index + 1}. ${LONG_LINE.repeat(2)}`.slice(0, 80).trimEnd(), done: index % 3 === 0 })),
    decisions: [{ action: 'block', note: note.trimEnd() }, { action: 'unblock', note: note.trimEnd() }],
  });
}

function seedMany(state: FixtureState): void {
  const [first = ''] = registerSynthetic(state, BOT.atlas, 1);
  for (let n = 1; n <= 30; n += 1) {
    insertItem(state, n, FIXTURE_NOW_MS - (31 - n) * 60_000, { title: `Batch item ${String(n).padStart(2, '0')}`, attempts: n === 1 ? [first] : [] });
  }
  for (let n = 1; n <= 60; n += 1) {
    state.counter += 1;
    state.entries.push({
      entryId: entryIdOf(state.counter),
      workId: workIdOf(100 + n),
      workTitle: `Archived task ${String(n).padStart(2, '0')}`,
      bindingId: bindingIdOf(BOT.atlas),
      kind: 'award',
      amount: 5,
      decisionId: decisionIdOf(900 + n),
      createdAtMs: FIXTURE_NOW_MS - 86_400_000 + n * STEP_MS,
    });
  }
}

function freshState(scenario: WorkScenarioName): FixtureState {
  const state: FixtureState = { scenario, items: new Map(), entries: [], synthetic: new Map(), decisionReplays: new Map(), failedOnce: new Set(), counter: 0, tick: 0 };
  if (scenario === 'work' || scenario === 'work-stale' || scenario === 'work-conflict' || scenario === 'arena-stale-work') seedWork(state);
  if (scenario === 'arena-perf-work') seedArenaPerf(state);
  if (scenario === 'work-long') seedLong(state);
  if (scenario === 'work-many') seedMany(state);
  return state;
}

function current(): FixtureState {
  const scenario = activeWorkScenario();
  if (store === null || store.scenario !== scenario) store = freshState(scenario);
  return store;
}

const byCreated = (a: Stored, b: Stored): number => b.createdAtMs - a.createdAtMs || (a.workId < b.workId ? 1 : a.workId > b.workId ? -1 : 0);
const byUpdated = (a: Stored, b: Stored): number => b.updatedAtMs - a.updatedAtMs || (a.workId < b.workId ? 1 : a.workId > b.workId ? -1 : 0);

/** The cursor tag names the order it belongs to, as the backend's order-tagged cursor does: a cursor from the other order is refused. */
function pageOf<T>(all: readonly T[], search: string, size: number, tag: 'c' | 'u' = 'c'): { items: T[]; nextCursor: string | null } | null {
  const params = new URLSearchParams(search);
  const rawCursor = params.get('cursor');
  const offset = rawCursor === null ? 0 : new RegExp(`^${tag}_\\d{1,6}$`).test(rawCursor) ? Number(rawCursor.slice(2)) : -1;
  if (offset < 0) return null;
  const rawLimit = params.get('limit');
  const limit = rawLimit !== null && /^\d{1,6}$/.test(rawLimit) ? Math.min(Math.max(Number(rawLimit), 1), size) : size;
  const items = all.slice(offset, offset + limit);
  return { items, nextCursor: offset + limit < all.length ? `${tag}_${offset + limit}` : null };
}

/** `work-list-item.v1`: the list fields of the full view plus `everAccepted`; no decisions, review, evidence revision, condition or milestone labels. */
function listViewOf(state: FixtureState, item: Stored): WorkListItemV1 {
  const full = viewOf(state, item);
  return {
    contractVersion: 1,
    workId: full.workId,
    parentId: full.parentId,
    title: full.title,
    rewardable: full.rewardable,
    bountyXp: full.bountyXp,
    state: full.state,
    version: full.version,
    createdAtMs: full.createdAtMs,
    updatedAtMs: full.updatedAtMs,
    attempts: full.attempts,
    contributors: full.contributors,
    progress: full.progress,
    childCount: full.childCount,
    childrenAccepted: full.childrenAccepted,
    everAccepted: item.decisions.some((decision) => decision.action === 'accept'),
  };
}

function listWork(state: FixtureState, search: string): Response {
  const params = new URLSearchParams(search);
  const filter = params.get('state');
  const view = params.get('view');
  const order = params.get('order');
  if (filter !== null && !STATES.includes(filter)) return apiError(400, 'invalid_state');
  // `order` is a `view=list` parameter; any other view or order is a 400, as on the backend.
  if (view !== null && view !== 'list') return apiError(400, 'invalid_view');
  if (order !== null && (view === null || (order !== 'created' && order !== 'updated'))) return apiError(400, 'invalid_order');
  const matching = [...state.items.values()].filter((item) => filter === null || item.state === filter);
  if (view === null) {
    const page = pageOf(matching.sort(byCreated), search, LIST_PAGE);
    if (page === null) return apiError(400, 'invalid_cursor');
    return json({ contractVersion: 1, items: page.items.map((item) => viewOf(state, item)), nextCursor: page.nextCursor, asOfMs: FIXTURE_NOW_MS });
  }
  const by = order === 'updated' ? 'updated' : 'created';
  const page = pageOf(matching.sort(by === 'updated' ? byUpdated : byCreated), search, LIST_PAGE, by === 'updated' ? 'u' : 'c');
  if (page === null) return apiError(400, 'invalid_cursor');
  return json({ contractVersion: 2, order: by, items: page.items.map((item) => listViewOf(state, item)), nextCursor: page.nextCursor, asOfMs: FIXTURE_NOW_MS });
}

const CREATE_KEYS = ['requestId', 'title', 'acceptanceCondition', 'rewardable', 'parentId', 'attemptIds', 'milestones'];
const visibleText = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim() !== '' && [...value.trim()].length <= max;

function createWork(state: FixtureState, body: unknown): Response {
  if (!isObject(body) || !hasOnly(body, CREATE_KEYS, CREATE_KEYS.filter((key) => key !== 'parentId'))) return apiError(400, 'invalid_body');
  const { requestId, title, acceptanceCondition, rewardable, parentId, attemptIds, milestones } = body;
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) return apiError(400, 'invalid_body');
  if (!visibleText(title, 120) || !visibleText(acceptanceCondition, 280) || typeof rewardable !== 'boolean') return apiError(400, 'invalid_body');
  if (parentId !== undefined && parentId !== null && (typeof parentId !== 'string' || !WORK_ID.test(parentId))) return apiError(400, 'invalid_body');
  if (!Array.isArray(attemptIds) || attemptIds.length > MAX_ATTEMPTS || !attemptIds.every((id) => typeof id === 'string')) return apiError(400, 'invalid_body');
  if (!Array.isArray(milestones) || milestones.length > MAX_MILESTONES || !milestones.every((label) => visibleText(label, 80))) return apiError(400, 'invalid_body');
  const ids = attemptIds as string[];
  if (new Set(ids).size !== ids.length) return apiError(400, 'invalid_body');
  const fingerprint = JSON.stringify([title.trim(), acceptanceCondition.trim(), rewardable, parentId ?? null, ids, (milestones as string[]).map((label) => label.trim())]);
  const replay = [...state.items.values()].find((item) => item.requestToken === requestId);
  if (replay !== undefined) return replay.fingerprint === fingerprint ? json(viewOf(state, replay), 200) : apiError(409, 'request_reused');
  for (const id of ids) {
    if (!ATTEMPT_ID.test(id) || lookupFact(state, id) === null) return apiError(404, 'unknown_attempt');
    const holder = [...state.items.values()].find((item) => item.attemptIds.includes(id));
    if (holder !== undefined) return apiError(409, 'attempt_already_linked');
  }
  if (typeof parentId === 'string') {
    const parent = state.items.get(parentId);
    if (parent === undefined) return apiError(404, 'unknown_work');
    if (parent.state === 'accepted' || parent.state === 'cancelled' || state.entries.some((entry) => entry.workId === parent.workId)) return apiError(409, 'parent_locked');
  }
  const now = clock(state);
  state.counter += 1;
  const item: Stored = {
    workId: workIdOf(1000 + state.counter),
    parentId: typeof parentId === 'string' ? parentId : null,
    title: title.trim(),
    condition: acceptanceCondition.trim(),
    rewardable,
    state: 'open',
    version: 1,
    createdAtMs: now,
    updatedAtMs: now,
    attemptIds: ids,
    milestones: (milestones as string[]).map((label) => ({ label: label.trim(), doneAtMs: null })),
    decisions: [],
    salt: 0,
    requestToken: requestId,
    fingerprint,
  };
  state.items.set(item.workId, item);
  return json(viewOf(state, item), 201);
}

function findItem(state: FixtureState, workId: string): Stored | null {
  return WORK_ID.test(workId) ? (state.items.get(workId) ?? null) : null;
}

function linkAttempt(state: FixtureState, workId: string, body: unknown): Response {
  const item = findItem(state, workId);
  if (item === null) return apiError(404, 'unknown_work');
  if (!isObject(body) || !hasOnly(body, ['expectedVersion', 'attemptId'], ['expectedVersion', 'attemptId']) || !isVersion(body.expectedVersion) || typeof body.attemptId !== 'string') {
    return apiError(400, 'invalid_body');
  }
  if (body.expectedVersion !== item.version) return apiError(409, 'version_conflict');
  if (item.state === 'accepted' || item.state === 'cancelled') return apiError(409, 'invalid_transition');
  if (!ATTEMPT_ID.test(body.attemptId) || lookupFact(state, body.attemptId) === null) return apiError(404, 'unknown_attempt');
  if ([...state.items.values()].some((other) => other.attemptIds.includes(body.attemptId as string))) return apiError(409, 'attempt_already_linked');
  if (item.attemptIds.length >= MAX_ATTEMPTS) return apiError(422, 'limit_reached');
  item.attemptIds.push(body.attemptId);
  item.version += 1;
  item.updatedAtMs = clock(state);
  return json(viewOf(state, item));
}

function setMilestone(state: FixtureState, workId: string, body: unknown): Response {
  const item = findItem(state, workId);
  if (item === null) return apiError(404, 'unknown_work');
  const keys = ['expectedVersion', 'position', 'done'];
  if (!isObject(body) || !hasOnly(body, keys, keys) || !isVersion(body.expectedVersion) || typeof body.done !== 'boolean') return apiError(400, 'invalid_body');
  const position = body.position;
  if (typeof position !== 'number' || !Number.isInteger(position) || position < 1 || position > MAX_MILESTONES) return apiError(400, 'invalid_body');
  if (body.expectedVersion !== item.version) return apiError(409, 'version_conflict');
  const milestone = item.milestones[position - 1];
  if (item.state === 'cancelled') return apiError(409, 'invalid_transition');
  if (milestone === undefined) return apiError(400, 'invalid_body');
  const now = clock(state);
  milestone.doneAtMs = body.done ? now : null;
  item.version += 1;
  item.updatedAtMs = now;
  return json(viewOf(state, item));
}

const DECISION_KEYS = ['requestId', 'expectedVersion', 'action', 'evidenceRevision', 'note'];

function decide(state: FixtureState, workId: string, body: unknown): Response {
  const item = findItem(state, workId);
  if (item === null) return apiError(404, 'unknown_work');
  if (!isObject(body) || !hasOnly(body, DECISION_KEYS, ['requestId', 'expectedVersion', 'action'])) return apiError(400, 'invalid_body');
  const { requestId, expectedVersion, action, evidenceRevision, note } = body;
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId) || !isVersion(expectedVersion) || typeof action !== 'string' || !(action in TRANSITIONS)) return apiError(400, 'invalid_body');
  const needsRevision = action === 'accept' || action === 'reject';
  if (needsRevision ? typeof evidenceRevision !== 'string' || !REVISION.test(evidenceRevision) : evidenceRevision !== undefined) return apiError(400, 'invalid_body');
  if (note !== undefined && note !== null && (typeof note !== 'string' || [...note].length > 280)) return apiError(400, 'invalid_body');
  const replayKey = `${item.workId}:${requestId}`;
  const replay = state.decisionReplays.get(replayKey);
  if (replay !== undefined) return replay.key === action ? json(viewOf(state, replay.item)) : apiError(409, 'request_reused');
  if (state.scenario === 'work-conflict' && !state.failedOnce.has('conflict')) {
    state.failedOnce.add('conflict');
    item.version += 1;
    return apiError(409, 'version_conflict');
  }
  if (state.scenario === 'work-stale' && needsRevision && item.state === 'awaiting-review' && !state.failedOnce.has('stale')) {
    state.failedOnce.add('stale');
    item.salt += 1;
    return apiError(409, 'stale_evidence');
  }
  const outcome = applyDecision(state, item, {
    action,
    expectedVersion,
    evidenceRevision: typeof evidenceRevision === 'string' ? evidenceRevision : null,
    note: typeof note === 'string' && note.trim() !== '' ? note.trim() : null,
    atMs: clock(state),
  });
  if (!outcome.ok) return apiError(outcome.status, outcome.error);
  state.decisionReplays.set(replayKey, { key: action, item });
  return json(viewOf(state, item));
}

const XP_PAGE = 200;

function xpSummaries(state: FixtureState, search: string): Response {
  const params = new URLSearchParams(search);
  const view = params.get('view');
  if (view !== null && view !== 'paged') return apiError(400, 'invalid_view');
  const ids = [...new Set(state.entries.map((entry) => entry.bindingId))].sort();
  if (view === null) return json({ contractVersion: 1, items: ids.slice(0, 500).map((id) => summaryOf(state, id)), asOfMs: FIXTURE_NOW_MS });
  // Keyset on the binding id, ascending: the cursor is the last id of the previous page.
  const rawCursor = params.get('cursor');
  if (rawCursor !== null && !/^b_bnd_[0-9a-f]{24}$/.test(rawCursor)) return apiError(400, 'invalid_cursor');
  const rawLimit = params.get('limit');
  if (rawLimit !== null && !/^\d{1,6}$/.test(rawLimit)) return apiError(400, 'invalid_limit');
  const limit = rawLimit === null ? XP_PAGE : Math.min(Math.max(Number(rawLimit), 1), XP_PAGE);
  const after = rawCursor === null ? null : rawCursor.slice(2);
  const rest = ids.filter((id) => after === null || id > after);
  const page = rest.slice(0, limit);
  const last = page[page.length - 1];
  return json({ contractVersion: 2, items: page.map((id) => summaryOf(state, id)), nextCursor: rest.length > limit && last !== undefined ? `b_${last}` : null, asOfMs: FIXTURE_NOW_MS });
}

function xpHistory(state: FixtureState, bindingId: string, search: string): Response {
  const onRoster = BINDING_ID.test(bindingId) && rosterBody(activeScenario()).items.some((bot) => bot.bindingId === bindingId);
  if (!onRoster && !state.entries.some((entry) => entry.bindingId === bindingId)) return apiError(404, 'unknown_binding');
  const all = state.entries
    .filter((entry) => entry.bindingId === bindingId)
    .sort((a, b) => b.createdAtMs - a.createdAtMs || (a.entryId < b.entryId ? 1 : a.entryId > b.entryId ? -1 : 0));
  const page = pageOf(all, search, HISTORY_PAGE);
  if (page === null) return apiError(400, 'invalid_cursor');
  const items: XpEntryV1[] = page.items.map((entry) => ({
    entryId: entry.entryId,
    workId: entry.workId,
    workTitle: entry.workTitle,
    kind: entry.kind,
    amount: entry.amount,
    policyVersion: POLICY_VERSION,
    decisionId: entry.decisionId,
    createdAtMs: entry.createdAtMs,
  }));
  return json({ contractVersion: 1, bindingId, summary: summaryOf(state, bindingId), items, nextCursor: page.nextCursor, asOfMs: FIXTURE_NOW_MS });
}

const SEGMENT = '([^/]+)';
const safeDecode = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

interface Route {
  pattern: RegExp;
  method: 'GET' | 'POST';
  handle: (state: FixtureState, match: RegExpExecArray, body: unknown, search: string) => Response;
}

const routes: readonly Route[] = [
  { pattern: new RegExp(`^${appApiPath('/work')}$`), method: 'GET', handle: (state, _match, _body, search) => listWork(state, search) },
  { pattern: new RegExp(`^${appApiPath('/work')}$`), method: 'POST', handle: (state, _match, body) => createWork(state, body) },
  {
    pattern: new RegExp(`^${appApiPath('/work')}/${SEGMENT}$`),
    method: 'GET',
    handle: (state, match) => {
      const item = findItem(state, safeDecode(match[1] ?? ''));
      return item === null || state.scenario === 'arena-stale-work' ? apiError(404, 'unknown_work') : json(viewOf(state, item));
    },
  },
  { pattern: new RegExp(`^${appApiPath('/work')}/${SEGMENT}/attempts$`), method: 'POST', handle: (state, match, body) => linkAttempt(state, safeDecode(match[1] ?? ''), body) },
  { pattern: new RegExp(`^${appApiPath('/work')}/${SEGMENT}/milestones$`), method: 'POST', handle: (state, match, body) => setMilestone(state, safeDecode(match[1] ?? ''), body) },
  { pattern: new RegExp(`^${appApiPath('/work')}/${SEGMENT}/decisions$`), method: 'POST', handle: (state, match, body) => decide(state, safeDecode(match[1] ?? ''), body) },
  { pattern: new RegExp(`^${appApiPath('/xp')}$`), method: 'GET', handle: (state, _match, _body, search) => xpSummaries(state, search) },
  { pattern: new RegExp(`^${appApiPath('/roster')}/${SEGMENT}/xp$`), method: 'GET', handle: (state, match, _body, search) => xpHistory(state, safeDecode(match[1] ?? ''), search) },
];

function failureFor(scenario: WorkScenarioName, pathname: string, method: 'GET' | 'POST'): Promise<Response> | null {
  if (scenario === 'work-offline') return Promise.reject(new TypeError('Failed to fetch'));
  if (scenario === 'work-failure') return Promise.resolve(apiError(503, 'store_not_ready'));
  if (scenario === 'work-expired') return Promise.resolve(new Response(null, { status: 403 }));
  if (scenario === 'work-unsupported') {
    const isList = method === 'GET' && (pathname === appApiPath('/work') || pathname === appApiPath('/xp'));
    const isRelated = pathname.startsWith(`${appApiPath('/work')}/`) || pathname.endsWith('/xp');
    if (isList || isRelated) return Promise.resolve(apiError(404, 'not_found'));
  }
  return null;
}

/** Null for any path that is not a Work or XP route, so the caller can fall through. */
export function workResponse(pathname: string, method: 'GET' | 'POST', body?: unknown, search = ''): Promise<Response> | null {
  const matching = routes.filter((route) => route.pattern.test(pathname));
  if (matching.length === 0) return null;
  const scenario = activeWorkScenario();
  const failure = failureFor(scenario, pathname, method);
  if (failure !== null) return failure;
  const route = matching.find((candidate) => candidate.method === method);
  const match = route?.pattern.exec(pathname);
  if (route === undefined || match === null || match === undefined) return Promise.resolve(apiError(405, 'invalid_body'));
  return Promise.resolve(route.handle(current(), match, body, search));
}
