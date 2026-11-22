import { useId, useState } from 'react';
import type { RosterCollectorV1, RosterItemV1, SpecterV3 } from '../contracts/types';
import { ActivityPanel } from './ActivityPanel';
import { AttemptsList, AttemptsStatus } from './AttemptsList';
import { BotSummary } from './BotSummary';
import { SourcePanel } from './SourcePanel';
import { SpecterDetail } from '../specters/SpecterDetail';
import { SpecterProgression } from '../specters/SpecterProgression';
import type { SpectersState } from '../specters/useSpecters';
import { Tabs } from './Tabs';
import { ProgressionPanel } from '../work/ProgressionPanel';
import type { XpView } from '../work/useXp';
import { nameOf, readingOf } from './model';
import { TokenStat } from './TokenStat';
import type { AttemptsState } from './useAttempts';

type DetailTab = 'attempts' | 'activity' | 'progression' | 'specter' | 'source';

const DETAIL_TABS: ReadonlyArray<{ name: DetailTab; label: string }> = [
  { name: 'attempts', label: 'Attempts' },
  { name: 'activity', label: 'Activity' },
  { name: 'progression', label: 'Progression' },
  { name: 'specter', label: 'Specter' },
  { name: 'source', label: 'Source details' },
];

interface Props {
  item: RosterItemV1;
  collector: RosterCollectorV1;
  rosterRevision: number;
  attempts: AttemptsState;
  xp: XpView;
  /** The bot's hero, or null while it has none. */
  specter: SpecterV3 | null;
  specters: SpectersState;
  /** Given only for a bot with no hero: opens the assignment walkthrough on it. */
  onAssign?: () => void;
  onLoadOlder: () => void;
  onRetry: () => void;
}

/** Keyed by bindingId in the page, so the selected tab resets when the selection changes. */
export function BotDetail({ item, collector, rosterRevision, attempts, xp, specter, specters, onAssign, onLoadOlder, onRetry }: Props) {
  const [tab, setTab] = useState<DetailTab>('attempts');
  const id = useId();
  const panelId = `${id}-panel`;
  const attemptsData = attempts.status === 'ready' ? attempts.data : null;

  let panel = null;
  if (tab === 'source') {
    panel = <SourcePanel item={item} collector={collector} rosterRevision={rosterRevision} attempts={attemptsData} />;
  } else if (tab === 'progression') {
    panel = <ProgressionPanel bindingId={item.bindingId} botName={nameOf(item)} total={xp.status === 'ready' ? xp.summary : null} />;
  } else if (tab === 'specter') {
    panel = (
      <SpecterDetail
        bot={item}
        specter={specter}
        specters={specters}
        onAssign={onAssign}
        progression={<SpecterProgression summary={xp.status === 'ready' ? (xp.summary ?? undefined) : undefined} unavailable={xp.status === 'ready' ? undefined : xp.status === 'loading' ? 'loading' : 'failed'} />}
      />
    );
  } else if (attempts.status !== 'ready') {
    panel = attempts.status === 'idle' ? null : <AttemptsStatus state={attempts} onRetry={onRetry} />;
  } else if (tab === 'activity') {
    panel = (
      <>
        <ActivityPanel activity={attempts.data.activity} />
        <TokenStat reading={readingOf(item)} />
      </>
    );
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
      <BotSummary item={item} xp={xp} />
      <Tabs label="Bot detail sections" tabs={DETAIL_TABS} value={tab} panelId={panelId} tabId={(name) => `${id}-tab-${name}`} onChange={setTab} />
      <div role="tabpanel" id={panelId} aria-labelledby={`${id}-tab-${tab}`} tabIndex={0}>
        {panel}
      </div>
    </div>
  );
}
