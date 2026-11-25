// SPECTER-DIAGNOSTIC-ONLY
import { useId } from 'react';
import { DIAGNOSTIC_MARKER, type HostFact, type Provenance } from '../model';
import { CredentialLabel } from './CredentialLabel';
import { EvidenceDetail } from './EvidenceDetail';
import { HOST_FACT_STATUS_LABEL, HOST_FACT_STATUS_ORDER, SOURCE_LABEL, countHostFacts, distinctCredentials } from './labels';

const HEADERS = ['Fact', 'Status', 'Credential', 'Evidence'];

export function HostFacts({ provenance, facts }: { provenance: Provenance; facts: readonly HostFact[] }) {
  const headingId = useId();
  const counts = countHostFacts(facts);
  const word = SOURCE_LABEL[provenance.source].word;
  return (
    <section
      aria-labelledby={headingId}
      data-specter-diagnostic={DIAGNOSTIC_MARKER}
      className="mb-4 border-2 border-dashed border-border p-3"
    >
      <h2 id={headingId} className="text-xl font-bold">
        Host facts (not permissions): SOURCE: {word}
      </h2>
      <p className="text-sm">Mechanism facts about the host. These are not permission grants and are not capability states.</p>
      <ul className="flex flex-wrap gap-3 list-none tabular-nums" aria-label="Host facts by status">
        {HOST_FACT_STATUS_ORDER.map((status) => (
          <li key={status}>
            {HOST_FACT_STATUS_LABEL[status]}: {counts[status]}
          </li>
        ))}
      </ul>
      {facts.length === 0 ? (
        <p>No host facts in this snapshot.</p>
      ) : (
        <div role="region" aria-label="Host facts table, scrollable" tabIndex={0} className="overflow-x-auto focus-ring">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Host facts, source {word}. Not permissions.</caption>
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
              {facts.map((fact) => {
                const credentials = distinctCredentials(fact);
                return (
                  <tr key={fact.id} className="align-top border-b border-border">
                    <th scope="row" className="p-2 text-left font-normal">
                      {fact.question} <code className="text-xs text-muted">{fact.id}</code>
                      {fact.notes ? <p className="text-xs">{fact.notes}</p> : null}
                    </th>
                    <td className="p-2 whitespace-nowrap">
                      <span className="inline-block rounded-sm border border-border px-2 py-1 font-mono text-xs">
                        FACT: {HOST_FACT_STATUS_LABEL[fact.status]}
                      </span>
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
                      <EvidenceDetail evidence={fact.evidence} />
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
