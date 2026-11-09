// SPECTER-DIAGNOSTIC-ONLY
import { useId } from 'react';
import { DIAGNOSTIC_MARKER, type CapabilityCell, type Provenance } from '../model';
import { CapabilityStateBadge } from './CapabilityStateBadge';
import { CredentialLabel } from './CredentialLabel';
import { EvidenceDetail } from './EvidenceDetail';
import { SCOPE_LABEL, SOURCE_LABEL, STATE_ORDER, countByDisplayState, displayState, distinctCredentials } from './labels';

const HEADERS = ['Question', 'Scope', 'State', 'Credential', 'Evidence'];

export function CapabilityMatrix({ provenance, cells }: { provenance: Provenance; cells: readonly CapabilityCell[] }) {
  const headingId = useId();
  const counts = countByDisplayState(cells);
  const word = SOURCE_LABEL[provenance.source].word;
  return (
    <section aria-labelledby={headingId} data-specter-diagnostic={DIAGNOSTIC_MARKER} className="mb-4">
      <h2 id={headingId} className="text-xl font-bold">
        Capability matrix: SOURCE: {word}
      </h2>
      <ul className="flex flex-wrap gap-3 list-none tabular-nums" aria-label="Cells by state">
        {STATE_ORDER.map((state) => (
          <li key={state}>
            {state}: {counts[state]}
          </li>
        ))}
      </ul>
      {cells.length === 0 ? (
        <p>No capability cells in this snapshot.</p>
      ) : (
        <div role="region" aria-label="Capability matrix table, scrollable" tabIndex={0} className="overflow-x-auto focus-ring">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Capability matrix, source {word}</caption>
            <thead>
              <tr>
                {HEADERS.map((header) => (
                  <th key={header} scope="col" className="border-b border-border p-2">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cells.map((cell) => {
                const state = displayState(cell);
                const credentials = distinctCredentials(cell);
                return (
                  <tr key={cell.key} className="align-top border-b border-border">
                    <th scope="row" className="p-2 text-left font-normal">
                      {cell.question} <code className="text-xs text-muted">{cell.key}</code>
                    </th>
                    <td className="p-2 whitespace-nowrap">{SCOPE_LABEL[cell.scope]}</td>
                    <td className="p-2">
                      <CapabilityStateBadge state={state} />
                      {state === 'INVALID-EVIDENCE' ? (
                        <p className="text-xs">
                          Recorded as {cell.state} but no APP-TOKEN evidence.
                        </p>
                      ) : null}
                    </td>
                    <td className="p-2">
                      {credentials.length === 0 ? (
                        'none'
                      ) : (
                        <span className="flex flex-wrap gap-2">
                          {credentials.map((credential) => (
                            <CredentialLabel key={credential} credential={credential} />
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      <EvidenceDetail evidence={cell.evidence} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
