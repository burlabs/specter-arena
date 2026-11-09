// SPECTER-DIAGNOSTIC-ONLY
import type { DisplayState } from './labels';

const TONE: Record<DisplayState, string> = {
  ALLOWED: 'bg-ok-subtle text-ok-text',
  DENIED: 'bg-danger-subtle text-danger-text',
  UNSUPPORTED: 'bg-warn-subtle text-warn-text',
  UNTESTED: 'bg-card text-muted border-dashed',
  'INVALID-EVIDENCE': 'bg-danger-subtle text-danger-text border-2 border-danger',
};

export function CapabilityStateBadge({ state }: { state: DisplayState }) {
  return (
    <span
      data-specter-diagnostic="SPECTER-DIAGNOSTIC-ONLY"
      data-state={state}
      className={`inline-block rounded-full border border-border px-2 py-1 text-xs font-semibold uppercase ${TONE[state]}`}
    >
      {state === 'INVALID-EVIDENCE' ? <span aria-hidden="true">! </span> : null}
      {state}
    </span>
  );
}
