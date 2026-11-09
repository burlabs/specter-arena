import { useState } from 'react';
import { useHostApi } from './host';

type Check = { state: 'idle' } | { state: 'ok'; at: string } | { state: 'error'; message: string };

export function StubShell() {
  const api = useHostApi();
  const [check, setCheck] = useState<Check>({ state: 'idle' });

  const runCheck = () => {
    api
      .getJson<{ at: string }>('/api/ping')
      .then((body) => setCheck({ state: 'ok', at: body.at }))
      .catch((error: unknown) =>
        setCheck({ state: 'error', message: error instanceof Error ? error.message : String(error) }),
      );
  };

  return (
    <section aria-label="Specter Arena" data-specter-stub="true">
      <h1>Specter Arena</h1>
      <p>Repository foundation stub. No product features yet.</p>
      <button type="button" onClick={runCheck}>
        Check backend connection
      </button>
      <p role="status" aria-live="polite">
        {check.state === 'idle' && 'Backend connection not checked.'}
        {check.state === 'ok' && `Backend reachable at ${check.at}.`}
        {check.state === 'error' && `Backend check failed: ${check.message}`}
      </p>
    </section>
  );
}
