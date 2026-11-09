// SPECTER-DIAGNOSTIC-ONLY: synthetic builders for tests; this is not Crew output.
import type { CapabilityCell, DiagnosticSnapshot, Evidence, HostFact, ProbeAttempt, Provenance } from '../model';

export function makeProvenance(overrides: Partial<Provenance> = {}): Provenance {
  return {
    source: 'fixture',
    runId: 'fixture-run',
    capturedAt: '2026-01-01T00:00:00Z',
    hostVersion: '0.0.0-fixture',
    sanitisation: 'synthetic test data',
    ...overrides,
  };
}

export function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    credential: 'APP-TOKEN',
    at: '2026-01-01T00:00:01Z',
    ref: 'fixture/ref.json',
    excerpt: 'synthetic excerpt',
    ...overrides,
  };
}

export function makeCell(overrides: Partial<CapabilityCell> = {}): CapabilityCell {
  return {
    key: 'fixture.cell',
    question: 'Synthetic question?',
    scope: 'app-owned',
    state: 'UNTESTED',
    evidence: [],
    ...overrides,
  };
}

export function makeHostFact(overrides: Partial<HostFact> = {}): HostFact {
  return {
    id: 'fixture.fact',
    question: 'Synthetic host fact?',
    status: 'UNTESTED',
    evidence: [],
    ...overrides,
  };
}

export function makeAttempt(overrides: Partial<ProbeAttempt> = {}): ProbeAttempt {
  return {
    id: 'fixture-attempt',
    kind: 'bot-turn',
    signals: [],
    outcomeEvidence: null,
    ...overrides,
  };
}

export function makeSnapshot(overrides: Partial<DiagnosticSnapshot> = {}): DiagnosticSnapshot {
  return {
    provenance: makeProvenance(),
    cells: [],
    hostFacts: [],
    attempts: [],
    ...overrides,
  };
}
