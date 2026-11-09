// SPECTER-DIAGNOSTIC-ONLY: dev-only diagnostic entry, built by ui/vite.diagnostic.config.ts
// and reachable only through the staged probe app. The release entry never imports it.
import { useCallback, useEffect, useId, useState } from 'react';
import { useHostApi } from '../host/useHostApi';
import { DiagnosticPage } from './components/DiagnosticPage';
import type { DiagnosticSnapshot } from './model';

const SNAPSHOT_PATH = '/api/probe/snapshot';
const CONFIG_PATH = '/api/probe/config';
const RUN_PATH = '/api/probe/run';

// The release backend has no probe routes, so a 404 means the dev switch is off.
function describeLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.endsWith('status 404') ? 'probe routes not enabled' : message;
}

export default function DiagnosticEntry() {
  const api = useHostApi();
  const slugId = useId();
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [probeSlug, setProbeSlug] = useState('');

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.getJson<DiagnosticSnapshot>(SNAPSHOT_PATH));
      setLoadError(undefined);
    } catch (error) {
      setSnapshot(null);
      setLoadError(describeLoadError(error));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const send = async (path: string, body: unknown) => {
    try {
      await api.postJson(path, body);
    } catch (error) {
      setLoadError(describeLoadError(error));
      return;
    }
    await refresh();
  };

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(CONFIG_PATH, { probeSlug });
        }}
      >
        <label htmlFor={slugId}>Probe bot slug</label>
        <input id={slugId} value={probeSlug} onChange={(event) => setProbeSlug(event.target.value)} />
        <button type="submit">Save probe config</button>
        <button type="button" onClick={() => void send(RUN_PATH, {})}>
          Run probe steps
        </button>
        <button type="button" onClick={() => void refresh()}>
          Refresh snapshot
        </button>
      </form>
      <DiagnosticPage snapshot={snapshot} loadError={loadError} />
    </>
  );
}
