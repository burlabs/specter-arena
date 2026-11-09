// SPECTER-DIAGNOSTIC-ONLY
import { DIAGNOSTIC_MARKER, type Evidence } from '../model';
import { CredentialLabel } from './CredentialLabel';
import { truncate } from './labels';

export function EvidenceDetail({ evidence }: { evidence: readonly Evidence[] }) {
  if (evidence.length === 0) {
    return <span data-specter-diagnostic={DIAGNOSTIC_MARKER}>No evidence recorded</span>;
  }
  return (
    <details data-specter-diagnostic={DIAGNOSTIC_MARKER} className="focus-ring">
      <summary className="underline">Evidence ({evidence.length})</summary>
      <ul className="list-none mt-2">
        {evidence.map((item, index) => {
          const cut = truncate(item.excerpt);
          return (
            <li key={`${item.ref}:${index}`} className="border-b border-border p-2">
              <p className="flex flex-wrap gap-2">
                <CredentialLabel credential={item.credential} /> <time dateTime={item.at}>{item.at}</time>
              </p>
              <p>
                Reference: <code>{item.ref}</code>
              </p>
              {item.status === undefined ? null : (
                <p>
                  Status: <code>{String(item.status)}</code>
                </p>
              )}
              <pre className="whitespace-pre-wrap break-words font-mono text-xs">{cut.text}</pre>
              {cut.truncated ? (
                <p className="text-xs">
                  Truncated: showing first {cut.text.length} of {cut.total} characters
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
