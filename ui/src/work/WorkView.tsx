import { useMemo, useRef, useState } from 'react';
import type { RosterItemV1, WorkItemV1 } from '../contracts/types';
import { Button, EmptyState, ErrorState, Panel } from '../observatory/ui';
import { CreateWorkForm } from './CreateWorkForm';
import { WorkDetail } from './WorkDetail';
import { WorkList } from './WorkList';
import { CREATE, LIST, PARTIAL_ROSTER, STATE_FILTER_OPTIONS, errorWords } from './copy';
import { newest } from './model';
import { useWork } from './useWork';
import { useWorkActions } from './useWorkActions';
import { useWorkItem } from './useWorkItem';

interface Props {
  bots: readonly RosterItemV1[];
  complete: boolean;
  /** Called after a decision that changes the XP ledger, so the roster cards refresh at once. */
  onLedgerChanged: () => void;
}

export function WorkView({ bots, complete, onLedgerChanged }: Props) {
  const [filter, setFilter] = useState('');
  const work = useWork(filter === '' ? null : filter);
  const actions = useWorkActions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [local, setLocal] = useState<WorkItemV1 | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const detail = useWorkItem(selectedId);
  const everReady = useRef(false);
  if (work.status === 'ready') everReady.current = true;

  const linked = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of work.items) for (const attempt of item.attempts) map.set(attempt.attemptId, item.title);
    return map;
  }, [work.items]);

  // The list holds only the list projection, so the detail pane reads the full item from its own poll or from
  // the last write response, never from a list row.
  const polled = detail.state.status === 'ready' ? detail.state.item : null;
  const own = local !== null && local.workId === selectedId ? local : null;
  const selected = newest(polled, own);
  const gone = detail.state.status === 'gone';

  const applied = (item: WorkItemV1) => {
    work.apply(item);
    setLocal(item);
  };
  const refresh = () => {
    work.refresh();
    detail.refresh();
  };
  const select = (workId: string) => {
    setCreating(false);
    setSelectedId(workId);
  };
  const created = (item: WorkItemV1) => {
    applied(item);
    setSelectedId(item.workId);
    setFocusId(item.workId);
    setCreating(false);
    setAnnouncement(filter === '' || item.state === filter ? CREATE.created : CREATE.createdHidden);
  };

  if (work.status === 'loading' && !everReady.current) {
    return (
      <Panel label={LIST.label}>
        <p role="status">{LIST.loading}</p>
      </Panel>
    );
  }
  if (work.status === 'failed' && !everReady.current) {
    return (
      <Panel label={LIST.label}>
        {work.failure === 'unsupported' ? (
          <EmptyState title={LIST.unsupportedTitle} body={LIST.unsupportedBody} />
        ) : (
          <ErrorState title={LIST.failureTitle} body={errorWords(work.failure === 'offline' ? 'offline' : 'store_unavailable')} onRetry={work.refresh} />
        )}
      </Panel>
    );
  }

  const parentTitle = (item: { parentId: string | null }): string | null => (item.parentId === null ? null : (work.byId.get(item.parentId)?.title ?? null));

  let listArea;
  if (work.status === 'loading') listArea = <p role="status">{LIST.loading}</p>;
  else if (work.status === 'failed') {
    listArea = <ErrorState title={LIST.failureTitle} body={errorWords(work.failure === 'offline' ? 'offline' : 'store_unavailable')} onRetry={work.refresh} />;
  } else if (work.items.length === 0) {
    listArea = filter === '' ? <EmptyState title={LIST.emptyTitle} body={LIST.emptyBody} /> : <p>{LIST.filterEmpty}</p>;
  } else {
    listArea = <WorkList items={work.items} selectedId={selectedId} bots={bots} onSelect={select} />;
  }

  let detailPane;
  if (creating) {
    detailPane = (
      <CreateWorkForm bots={bots} existing={work.items} linked={linked} actions={actions} onCreated={created} onCancel={() => setCreating(false)} />
    );
  } else if (gone) {
    detailPane = <p role="status">{LIST.gone}</p>;
  } else if (selected !== null) {
    detailPane = (
      <WorkDetail
        key={selected.workId}
        item={selected}
        bots={bots}
        parentTitle={parentTitle(selected)}
        linked={linked}
        actions={actions}
        focusOnMount={focusId === selected.workId}
        onFocused={() => setFocusId(null)}
        onApplied={applied}
        onRefresh={refresh}
        onLedgerChanged={onLedgerChanged}
        announce={setAnnouncement}
      />
    );
  } else if (selectedId !== null) {
    detailPane = <p role="status">{LIST.loading}</p>;
  } else {
    detailPane = <p>{LIST.selectPrompt}</p>;
  }

  return (
    <div className="sa-work">
      <Panel label={LIST.label}>
        <div className="sa-work-toolbar">
          <label>
            {LIST.filterLabel}
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              {STATE_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <Button aria-expanded={creating} onClick={() => setCreating(true)}>
            {LIST.newItem}
          </Button>
        </div>
        {!complete && <p className="sa-help">{PARTIAL_ROSTER}</p>}
        {listArea}
        {work.olderFailed && (
          <p className="sa-error" role="alert">
            {LIST.olderFailed}
          </p>
        )}
        {work.hasOlder && (
          <Button disabled={work.loadingOlder} onClick={work.loadOlder}>
            {work.loadingOlder ? LIST.loadingOlder : LIST.loadOlder}
          </Button>
        )}
      </Panel>
      <Panel label={LIST.detailLabel}>{detailPane}</Panel>
      <p className="sa-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
