// SPECTER-DIAGNOSTIC-ONLY
import { DIAGNOSTIC_MARKER } from '../model';
import type { Provenance } from '../model';
import { SOURCE_LABEL } from './labels';

export function ProvenanceBanner({ provenance }: { provenance: Provenance | null }) {
  const border = provenance?.source === 'live' ? 'border-2' : 'border-2 border-dashed';
  return (
    <div
      role="status"
      aria-label="Data provenance"
      data-specter-diagnostic={DIAGNOSTIC_MARKER}
      className={`${border} border-border bg-card p-3 mb-4`}
    >
      <p className="font-bold">
        DIAGNOSTIC <span className="font-mono text-xs">({DIAGNOSTIC_MARKER})</span>: developer probe view, not product UI.
      </p>
      {provenance ? (
        <>
          <p className="font-bold">
            SOURCE: {SOURCE_LABEL[provenance.source].word} <span className="font-normal">({SOURCE_LABEL[provenance.source].meaning})</span>
          </p>
          <p className="text-sm">
            Crew {provenance.hostVersion}; run <code>{provenance.runId}</code>; captured{' '}
            <time dateTime={provenance.capturedAt}>{provenance.capturedAt}</time>
          </p>
          <p className="text-sm">Sanitisation: {provenance.sanitisation}</p>
        </>
      ) : (
        <p className="font-bold">SOURCE: NONE (no snapshot loaded)</p>
      )}
    </div>
  );
}
