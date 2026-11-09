// SPECTER-DIAGNOSTIC-ONLY
import { useId } from 'react';
import { DIAGNOSTIC_MARKER, type ProbeAttempt, type Provenance } from '../model';
import { ATTEMPT_KIND_LABEL, SOURCE_LABEL } from './labels';

export function ProbeAttemptTimeline({ provenance, attempts }: { provenance: Provenance; attempts: readonly ProbeAttempt[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-specter-diagnostic={DIAGNOSTIC_MARKER} className="mb-4">
      <h2 id={headingId} className="text-xl font-bold">
        Probe attempts: SOURCE: {SOURCE_LABEL[provenance.source].word}
      </h2>
      <p className="text-sm">A turn or session ending is a signal, not an outcome.</p>
      {attempts.length === 0 ? (
        <p>No attempts recorded in this snapshot.</p>
      ) : (
        <ol className="list-none">
          {attempts.map((attempt) => (
            <li key={attempt.id} className="border border-border p-3 mb-4">
              <h3 className="font-semibold">
                {ATTEMPT_KIND_LABEL[attempt.kind]} <code>{attempt.id}</code>
              </h3>
              <p>Bot reference: {attempt.botRef ? <code>{attempt.botRef}</code> : 'none'}</p>
              {attempt.signals.length === 0 ? (
                <p>No signals recorded</p>
              ) : (
                <ol className="list-decimal pl-5">
                  {attempt.signals.map((signal, index) => (
                    <li key={`${signal.at}:${signal.kind}:${index}`}>
                      <time dateTime={signal.at}>{signal.at}</time> {signal.kind}
                    </li>
                  ))}
                </ol>
              )}
              <p>Outcome evidence: {attempt.outcomeEvidence?.trim() ? attempt.outcomeEvidence : 'unknown'}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
