// SPECTER-DIAGNOSTIC-ONLY: dev-only diagnostic entry, built by ui/vite.diagnostic.config.ts
// and reachable only through the staged probe app. The release entry never imports it.
import { DIAGNOSTIC_MARKER, type DiagnosticSnapshot } from './model';

interface PlaceholderProps {
  snapshot: DiagnosticSnapshot | null;
  loadError?: string;
}

// Minimal page body with the props the diagnostic page takes: a snapshot or a load error.
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
