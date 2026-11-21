import { useEffect, useState } from 'react';
import type { DataLifecycleV1 } from '../contracts/types';
import { useSourceMode } from '../host';
import { Button, ErrorState, Panel } from '../observatory/ui';
import { CollectionSection } from './CollectionSection';
import { ExportSection } from './ExportSection';
import { HistorySection } from './HistorySection';
import { UploadsSection } from './UploadsSection';
import { COLLECTION, DATA_MODE, PAGE, errorWords } from './copy';
import type { Submit } from './sectionTypes';
import type { LifecycleResult } from './useDataActions';
import { useData } from './useData';
import type { DataFailure } from './useData';
import { useDataActions } from './useDataActions';

const FAILURE_BODY: Readonly<Record<DataFailure, string>> = {
  unsupported: PAGE.unsupportedBody,
  offline: errorWords('offline'),
  unavailable: errorWords('store_unavailable'),
  unexpected: errorWords('unexpected'),
};

/** The Data tab: collection pause and resume, retention and purge, export, and uploaded-image usage. */
export function DataView() {
  const mode = useSourceMode();
  const { state, refresh } = useData();
  const actions = useDataActions();
  // A write answers with the whole new state. It shows at once and gives way to the next poll, which `refresh` starts
  // after it and which `usePolled` therefore never overtakes with an older response.
  const [applied, setApplied] = useState<DataLifecycleV1 | null>(null);
  const [control, setControl] = useState<boolean | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const polled = state.data;
  useEffect(() => {
    setApplied(null);
    setControl(null);
  }, [polled]);

  const submit: Submit = async (pending: Promise<LifecycleResult>, done: string) => {
    const result = await pending;
    refresh();
    if (!result.ok) return errorWords(result.code);
    setApplied(result.data);
    setAnnouncement(done);
    return null;
  };

  const setPaused = async (paused: boolean): Promise<string | null> => {
    const result = await actions.setPaused(paused);
    refresh();
    if (!result.ok) return errorWords(result.code);
    setControl(result.control.paused);
    setAnnouncement(result.control.paused ? COLLECTION.pausedDone : COLLECTION.resumedDone);
    return null;
  };

  const header = (
    <div className="sa-data-header">
      <h2>{PAGE.heading}</h2>
      <span role="status" className={`sa-data-mode sa-data-mode--${mode.toLowerCase()}`} data-mode={mode}>
        {DATA_MODE[mode]}
      </span>
    </div>
  );

  if (state.status === 'loading') {
    return (
      <Panel label={PAGE.label}>
        {header}
        <p role="status">{PAGE.loading}</p>
      </Panel>
    );
  }
  if (state.status === 'failed') {
    return (
      <Panel label={PAGE.label}>
        {header}
        {state.failure === 'unsupported' ? (
          <ErrorState title={PAGE.unsupportedTitle} body={FAILURE_BODY.unsupported} />
        ) : (
          <ErrorState title={PAGE.failureTitle} body={FAILURE_BODY[state.failure]} onRetry={refresh} />
        )}
      </Panel>
    );
  }

  const data = applied ?? state.data;
  const paused = control ?? data.paused;
  const section = { data, actions, submit };

  return (
    <Panel label={PAGE.label}>
      {header}
      {state.failure !== null && (
        <div className="sa-banner" role="alert">
          <span>
            {PAGE.stale} {FAILURE_BODY[state.failure]}
          </span>
          <Button onClick={refresh}>Retry</Button>
        </div>
      )}
      <div className="sa-data">
        <CollectionSection paused={paused} busy={actions.busy} onSet={setPaused} />
        <HistorySection {...section} />
        <ExportSection {...section} />
        <UploadsSection {...section} />
      </div>
      <p className="sa-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </Panel>
  );
}
