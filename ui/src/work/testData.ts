import type { WorkItemV1, WorkListItemV1, XpSummaryV1 } from '../contracts/types';
import { listItemOf } from './model';

export const ATLAS = `bnd_${'a'.repeat(20)}0001`;
export const BRINDLE = `bnd_${'a'.repeat(20)}0002`;

export const summaryOf = (extra: Partial<XpSummaryV1> = {}): XpSummaryV1 => ({
  contractVersion: 1,
  bindingId: ATLAS,
  totalXp: 150,
  level: 2,
  levelTableVersion: 'levels-1',
  levelFloorXp: 100,
  nextLevelXp: 250,
  acceptedWorkCount: 2,
  policyVersion: 'xp-policy-1',
  ...extra,
});

export const itemOf = (extra: Partial<WorkItemV1> = {}): WorkItemV1 => ({
  contractVersion: 1,
  workId: `wrk_${'1'.repeat(24)}`,
  parentId: null,
  title: 'Migrate the nightly report',
  acceptanceCondition: 'The report runs on the new host.',
  rewardable: true,
  bountyXp: 100,
  policyVersion: 'xp-policy-1',
  state: 'open',
  version: 1,
  createdAtMs: 1_000,
  updatedAtMs: 1_000,
  attempts: [],
  contributors: [],
  milestones: [],
  progress: null,
  evidenceRevision: 'a'.repeat(24),
  childCount: 0,
  childrenAccepted: 0,
  review: { canAccept: false, blockers: ['wrong-state'] },
  decisions: [],
  ...extra,
});

export const listOf = (...items: WorkItemV1[]) => ({ contractVersion: 1, items, nextCursor: null, asOfMs: 1 });

/** A `work-list-item.v1`: the list projection of a full item, so a test states the full item once. */
export const rowOf = (extra: Partial<WorkItemV1> = {}): WorkListItemV1 => listItemOf(itemOf(extra));

/** A `work-items.v2` page. */
export const listPageOf = (items: WorkListItemV1[], order: 'created' | 'updated' = 'created', nextCursor: string | null = null, asOfMs = 1) => ({ contractVersion: 2, order, items, nextCursor, asOfMs });

/** An `xp-summaries.v2` page. */
export const xpPageOf = (items: XpSummaryV1[], nextCursor: string | null = null, asOfMs = 1) => ({ contractVersion: 2, items, nextCursor, asOfMs });
