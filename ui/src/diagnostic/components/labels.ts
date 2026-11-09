// SPECTER-DIAGNOSTIC-ONLY: probe vocabulary. These words are not bot-condition words; FP-04 owns those (PA1-D1).
import { cellValidity } from '../model';
import type {
  CapabilityCell,
  CapabilityState,
  Credential,
  DiagnosticSnapshot,
  HostFactStatus,
  ProbeAttempt,
  ProvenanceSource,
} from '../model';

export const MAX_EXCERPT_CHARS = 2000;

export type DisplayState = CapabilityState | 'INVALID-EVIDENCE';

export const STATE_ORDER: readonly DisplayState[] = ['ALLOWED', 'DENIED', 'UNSUPPORTED', 'UNTESTED', 'INVALID-EVIDENCE'];

export const SOURCE_LABEL: Record<ProvenanceSource, { word: string; meaning: string }> = {
  live: { word: 'LIVE', meaning: 'read from the running backend now' },
  recorded: { word: 'RECORDED', meaning: 'committed sanitized capture of real Crew output' },
  fixture: { word: 'FIXTURE', meaning: 'synthetic test data, not Crew output' },
};

export const SCOPE_LABEL: Record<CapabilityCell['scope'], string> = {
  'app-owned': 'app-owned',
  'user-owned': 'user-owned',
  'other-app': 'other-app',
  bot: 'bot',
  'external-cli': 'external CLI',
};

export const HOST_FACT_STATUS_LABEL: Record<HostFactStatus, string> = {
  OBSERVED: 'OBSERVED',
  'NOT-OBSERVED': 'NOT-OBSERVED',
  UNTESTED: 'UNTESTED',
};

export const HOST_FACT_STATUS_ORDER: readonly HostFactStatus[] = ['OBSERVED', 'NOT-OBSERVED', 'UNTESTED'];

export const ATTEMPT_KIND_LABEL: Record<ProbeAttempt['kind'], string> = {
  'bot-turn': 'BOT TURN',
  'worker-session': 'WORKER SESSION',
  'external-cli': 'EXTERNAL CLI',
  'app-session': 'APP SESSION',
};

export const CREDENTIAL_ORDER: readonly Credential[] = ['APP-TOKEN', 'OWNER-SESSION'];

// The ALLOWED-needs-APP-TOKEN rule lives once in model.ts cellValidity(); the view only calls it.
export function displayState(cell: CapabilityCell): DisplayState {
  return cellValidity(cell) === 'invalid-evidence' ? 'INVALID-EVIDENCE' : cell.state;
}

export function countByDisplayState(cells: readonly CapabilityCell[]): Record<DisplayState, number> {
  const counts: Record<DisplayState, number> = { ALLOWED: 0, DENIED: 0, UNSUPPORTED: 0, UNTESTED: 0, 'INVALID-EVIDENCE': 0 };
  for (const cell of cells) counts[displayState(cell)] += 1;
  return counts;
}

export function distinctCredentials(item: { evidence: readonly { credential: Credential }[] }): Credential[] {
  return CREDENTIAL_ORDER.filter((credential) => item.evidence.some((entry) => entry.credential === credential));
}

export function countHostFacts(facts: readonly { status: HostFactStatus }[]): Record<HostFactStatus, number> {
  const counts: Record<HostFactStatus, number> = { OBSERVED: 0, 'NOT-OBSERVED': 0, UNTESTED: 0 };
  for (const fact of facts) counts[fact.status] += 1;
  return counts;
}

export function truncate(text: string, max: number = MAX_EXCERPT_CHARS): { text: string; truncated: boolean; total: number } {
  return text.length > max ? { text: text.slice(0, max), truncated: true, total: text.length } : { text, truncated: false, total: text.length };
}

export function describeSnapshotChange(previous: DiagnosticSnapshot | null, next: DiagnosticSnapshot | null): string {
  if (!previous || !next) return '';
  if (previous.provenance.runId !== next.provenance.runId) return `Snapshot replaced by run ${next.provenance.runId}`;
  const stateBefore = new Map(previous.cells.map((cell) => [cell.key, displayState(cell)]));
  const cellsChanged = next.cells.filter((cell) => stateBefore.get(cell.key) !== displayState(cell)).length;
  const statusBefore = new Map(previous.hostFacts.map((fact) => [fact.id, fact.status]));
  const factsChanged = next.hostFacts.filter((fact) => statusBefore.get(fact.id) !== fact.status).length;
  const parts: string[] = [];
  if (cellsChanged > 0) parts.push(`${cellsChanged} capability ${cellsChanged === 1 ? 'cell' : 'cells'} changed state`);
  if (factsChanged > 0) parts.push(`${factsChanged} host ${factsChanged === 1 ? 'fact' : 'facts'} changed status`);
  return parts.join('; ');
}
