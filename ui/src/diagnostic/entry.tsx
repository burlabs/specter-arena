// SPECTER-DIAGNOSTIC-ONLY: dev-only diagnostic entry, built by ui/vite.diagnostic.config.ts
// and reachable only through the staged probe app. The release entry never imports it.
import { DIAGNOSTIC_MARKER, type DiagnosticSnapshot } from './model';

interface PlaceholderProps {
  snapshot: DiagnosticSnapshot | null;
  loadError?: string;
}

// Stands in for the DiagnosticPage component, which lands in a later slice with the same props.
function DiagnosticPlaceholder({ snapshot, loadError }: PlaceholderProps) {
  return (
    <section aria-labelledby="specter-diagnostic-title" data-marker={DIAGNOSTIC_MARKER} data-has-snapshot={String(snapshot !== null)}>
      <h1 id="specter-diagnostic-title">Specter diagnostic</h1>
      <p role="status">{loadError}</p>
    </section>
  );
}

export default function DiagnosticEntry() {
  return <DiagnosticPlaceholder snapshot={null} loadError="probe not wired yet" />;
}
