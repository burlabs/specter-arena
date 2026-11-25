import type { XpSummariesV3, XpSummaryV2 } from '../contracts/types';

export const ATLAS = `bnd_${'a'.repeat(20)}0001`;
export const BRINDLE = `bnd_${'a'.repeat(20)}0002`;

export const summaryOf = (extra: Partial<XpSummaryV2> = {}): XpSummaryV2 => ({
  contractVersion: 2,
  bindingId: ATLAS,
  totalXp: 150,
  level: 2,
  levelTableVersion: 'levels-1',
  levelFloorXp: 100,
  nextLevelXp: 250,
  acceptedWorkCount: 2,
  creditedTaskCount: 3,
  policyVersion: 'xp-policy-2',
  ...extra,
});

/** An `xp-summaries.v3` page. */
export const xpPageOf = (items: XpSummaryV2[], nextCursor: string | null = null, asOfMs = 1): XpSummariesV3 => ({ contractVersion: 3, items, nextCursor, asOfMs });
