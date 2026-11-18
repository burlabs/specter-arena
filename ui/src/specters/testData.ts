import type { SpecterProfileV1, SpecterV1, SummoningV1 } from '../contracts/types';

export const BINDING = `bnd_${'a'.repeat(20)}0001`;
export const REQUEST = `req_${'1'.repeat(24)}`;

export const profile = (name = 'Lanternwick', extra: Partial<SpecterProfileV1> = {}): SpecterProfileV1 => ({
  contractVersion: 1,
  name,
  epithet: null,
  personality: 'Quiet and exact.',
  appearance: 'A pale coat.',
  mannerism: 'Tilts its head.',
  signatureAction: null,
  assignmentRationale: 'Careful pace.',
  artBrief: 'A small lantern.',
  ...extra,
});

export const specterOf = (extra: Partial<SpecterV1> = {}): SpecterV1 => ({
  contractVersion: 1,
  specterId: `spc_${'2'.repeat(24)}`,
  bindingId: BINDING,
  version: 1,
  profile: profile(),
  portrait: null,
  source: 'generated',
  promptVersion: 'summon-1',
  createdAtMs: 1,
  updatedAtMs: 1,
  ...extra,
});

export const summoningOf = (extra: Partial<SummoningV1> = {}): SummoningV1 => ({
  contractVersion: 1,
  requestId: REQUEST,
  bindingId: BINDING,
  status: 'queued',
  candidate: null,
  error: null,
  promptVersion: 'summon-1',
  keep: [],
  createdAtMs: 1,
  finishedAtMs: null,
  budget: { bindingRemaining: 4, bindingLimit: 5, installRemaining: 19, installLimit: 20, windowMs: 86_400_000 },
  ...extra,
});
