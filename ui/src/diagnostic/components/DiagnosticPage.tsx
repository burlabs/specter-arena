// SPECTER-DIAGNOSTIC-ONLY
import { useEffect, useId, useRef, useState } from 'react';
import { DIAGNOSTIC_MARKER, type DiagnosticSnapshot } from '../model';
import { CapabilityMatrix } from './CapabilityMatrix';
import { HostFacts } from './HostFacts';
import { ProbeAttemptTimeline } from './ProbeAttemptTimeline';
import { ProvenanceBanner } from './ProvenanceBanner';
import { describeSnapshotChange } from './labels';

export function DiagnosticPage({ snapshot, loadError }: { snapshot: DiagnosticSnapshot | null; loadError?: string }) {
  const headingId = useId();
  const previous = useRef<DiagnosticSnapshot | null>(null);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    setAnnouncement(describeSnapshotChange(previous.current, snapshot));
    previous.current = snapshot;
  }, [snapshot]);
  return (
    <section aria-labelledby={headingId} data-specter-diagnostic={DIAGNOSTIC_MARKER}>
      <h1 id={headingId} className="text-2xl font-bold">
        Diagnostic: Crew capability probe
      </h1>
      <ProvenanceBanner provenance={snapshot?.provenance ?? null} />
      {loadError ? <p role="alert">Could not load the snapshot: {loadError}</p> : null}
      <p role="status" aria-label="Snapshot updates" className="sr-only">
        {announcement}
      </p>
      <details className="mb-4">
        <summary className="underline">How to read this page</summary>
        <dl className="text-sm">
          <dt className="font-semibold">State</dt>
          <dd>
            ALLOWED, DENIED, UNSUPPORTED or UNTESTED, or INVALID-EVIDENCE when a cell was recorded as ALLOWED without any APP-TOKEN
            evidence.
          </dd>
          <dt className="font-semibold">Credential</dt>
          <dd>Which credential an evidence item was captured with. Only APP-TOKEN evidence can back ALLOWED.</dd>
          <dt className="font-semibold">Source</dt>
          <dd>LIVE is read now, RECORDED is a committed capture of real output, FIXTURE is synthetic test data.</dd>
        </dl>
      </details>
      {snapshot ? (
        <>
          <CapabilityMatrix provenance={snapshot.provenance} cells={snapshot.cells} />
          <HostFacts provenance={snapshot.provenance} facts={snapshot.hostFacts} />
          <ProbeAttemptTimeline provenance={snapshot.provenance} attempts={snapshot.attempts} />
        </>
      ) : (
        <p>No snapshot loaded.</p>
      )}
    </section>
  );
}
