// SPECTER-DIAGNOSTIC-ONLY
import { DIAGNOSTIC_MARKER, type Credential } from '../model';

export function CredentialLabel({ credential }: { credential: Credential }) {
  return (
    <span
      data-specter-diagnostic={DIAGNOSTIC_MARKER}
      className="inline-block rounded-sm border border-border px-2 py-1 font-mono text-xs"
    >
      CREDENTIAL: {credential}
    </span>
  );
}
