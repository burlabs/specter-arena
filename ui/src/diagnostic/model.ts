// SPECTER-DIAGNOSTIC-ONLY: dev-only diagnostic view contract (SC-3). Never imported by the
// release entry, so it never reaches ui/dist. No health, HP, score, condition, level or XP
// fields exist here on purpose (PA1-D1); FP-04 owns the condition vocabulary.

export const DIAGNOSTIC_MARKER = 'SPECTER-DIAGNOSTIC-ONLY';

/** `recorded` = committed sanitized real captures; `fixture` = invented/stand-in data. */
export type ProvenanceSource = 'live' | 'recorded' | 'fixture';

export interface Provenance {
  source: ProvenanceSource;
  runId: string;
  /** ISO 8601 */
  capturedAt: string;
  /** e.g. "0.12.0" */
  hostVersion: string;
  sanitisation: string;
}

export type CapabilityState = 'ALLOWED' | 'DENIED' | 'UNSUPPORTED' | 'UNTESTED';

export type Credential = 'APP-TOKEN' | 'OWNER-SESSION';

/** No 'host' scope (FD-1): host mechanism facts are HostFact records, not permission cells. */
export type CapabilityScope = 'app-owned' | 'user-owned' | 'other-app' | 'bot' | 'external-cli';

export interface Evidence {
  /** Required; there is deliberately no default. */
  credential: Credential;
  /** ISO 8601 */
  at: string;
  /** Run-log or capture file reference. */
  ref: string;
  /** Sanitized text; rendered as text only (SC-12). */
  excerpt: string;
  /** HTTP status or error code for denials. */
  status?: number | string;
}

export interface CapabilityCell {
  /** Stable; matches the capability-questions.json / SC-4 `id`. */
  key: string;
  question: string;
  scope: CapabilityScope;
  state: CapabilityState;
  /** May be empty only when state is UNTESTED. */
  evidence: Evidence[];
}

export type HostFactStatus = 'OBSERVED' | 'NOT-OBSERVED' | 'UNTESTED';

/** A host mechanism fact (install, render, spawn, proxy...). Not a permission; may rest on OWNER-SESSION evidence. */
export interface HostFact {
  /** Stable; matches the capability-questions.json `id` with kind "host-fact". */
  id: string;
  question: string;
  status: HostFactStatus;
  evidence: Evidence[];
  notes?: string;
}

export interface ProbeAttempt {
  id: string;
  kind: 'bot-turn' | 'worker-session' | 'external-cli' | 'app-session';
  /** Hashed per A2/FD-22 unless it is the probe bot. */
  botRef?: string;
  signals: { kind: string; at: string }[];
  /** Never the word "accepted"; null renders as "unknown". */
  outcomeEvidence: string | null;
}

export interface DiagnosticSnapshot {
  /** One snapshot has exactly one provenance; LIVE and RECORDED/FIXTURE are never merged. */
  provenance: Provenance;
  cells: CapabilityCell[];
  /** Rendered by experience as a separate section titled "Host facts (not permissions)". */
  hostFacts: HostFact[];
  attempts: ProbeAttempt[];
}

export type CellValidity = 'valid' | 'invalid-evidence';

/**
 * The single ALLOWED rule (A3, FD-1), in every scope with no exception: a cell may be
 * ALLOWED only with at least one APP-TOKEN evidence item. The view renders
 * INVALID-EVIDENCE instead of ALLOWED when this returns 'invalid-evidence'.
 * scripts/check-matrix.mjs mirrors this rule for the committed JSON.
 */
export function cellValidity(cell: CapabilityCell): CellValidity {
  if (cell.state !== 'ALLOWED') return 'valid';
  return cell.evidence.some((item) => item.credential === 'APP-TOKEN') ? 'valid' : 'invalid-evidence';
}
