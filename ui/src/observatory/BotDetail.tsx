import { useId, useState } from 'react';
import type { RosterCollectorV1, RosterItemV1 } from '../contracts/types';
import { ActivityPanel } from './ActivityPanel';
import { AttemptsList, AttemptsStatus } from './AttemptsList';
import { BotSummary } from './BotSummary';
import { SourcePanel } from './SourcePanel';
import { Tabs } from './Tabs';
import type { AttemptsState } from './useAttempts';

type DetailTab = 'attempts' | 'activity' | 'source';

const DETAIL_TABS: ReadonlyArray<{ name: DetailTab; label: string }> = [
  { name: 'attempts', label: 'Attempts' },
  { name: 'activity', label: 'Activity' },
  { name: 'source', label: 'Source details' },
];

interface Props {
  item: RosterItemV1;
  collector: RosterCollectorV1;
  rosterRevision: number;
  attempts: AttemptsState;
  onLoadOlder: () => void;
  onRetry: () => void;
}

/** Keyed by bindingId in the page, so the selected tab resets when the selection changes. */
export function BotDetail({ item, collector, rosterRevision, attempts, onLoadOlder, onRetry }: Props) {
  const [tab, setTab] = useState<DetailTab>('attempts');
  const id = useId();
  const panelId = `${id}-panel`;
  const attemptsData = attempts.status === 'ready' ? attempts.data : null;

  let panel = null;
  if (tab === 'source') {
    panel = <SourcePanel item={item} collector={collector} rosterRevision={rosterRevision} attempts={attemptsData} />;
  } else if (attempts.status !== 'ready') {
    panel = attempts.status === 'idle' ? null : <AttemptsStatus state={attempts} onRetry={onRetry} />;
  } else if (tab === 'activity') {
    panel = <ActivityPanel activity={attempts.data.activity} />;
  } else {
    panel = (
      <AttemptsList
        items={attempts.items}
        hasOlder={attempts.hasOlder}
        loadingOlder={attempts.loadingOlder}
        olderFailed={attempts.olderFailed}
        onLoadOlder={onLoadOlder}
      />
    );
  }

  return (
    <div className="sa-detail">
      <BotSummary item={item} />
      <Tabs label="Bot detail sections" tabs={DETAIL_TABS} value={tab} panelId={panelId} tabId={(name) => `${id}-tab-${name}`} onChange={setTab} />
      <div role="tabpanel" id={panelId} aria-labelledby={`${id}-tab-${tab}`} tabIndex={0}>
        {panel}
      </div>
    </div>
  );
}
