import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RosterItemV1 } from '../contracts/types';
import { BotDetail } from './BotDetail';
import { OperationalLegend } from './OperationalLegend';
import { RosterKpis } from './RosterKpis';
import { RosterList } from './RosterList';
import { Tabs } from './Tabs';
import { Time } from './Time';
import { FAILURE_COPY, collectorWords, noteWords, truncationWords } from './copy';
import { botCondition, isOpen, matchesQuery, nameOf } from './model';
import { useAttempts } from './useAttempts';
import { useInjectedStyle } from './useInjectedStyle';
import { useRoster } from './useRoster';
import type { RosterData } from './useRoster';
import { useWatched } from './watched';
import { SpectersView } from '../specters/SpectersView';
import { useSpecterStyle } from '../specters/useSpecterStyle';
import { useSpecters } from '../specters/useSpecters';
import { DataView } from '../lifecycle/DataView';
import { useDataStyle } from '../lifecycle/useDataStyle';
import { ArenaView } from '../arena/ArenaView';
import { useArenaStyle } from '../arena/useArenaStyle';
import { useWorkStyle } from '../work/useWorkStyle';
import { useXp, xpViewOf } from '../work/useXp';
import { Button, EmptyState, ErrorState, Icon, Panel } from './ui';

type ViewName = 'watched' | 'all';

const VIEWS: ReadonlyArray<{ name: ViewName; label: string }> = [
  { name: 'watched', label: 'Watched' },
  { name: 'all', label: 'All bots' },
];

type SectionName = 'arena' | 'roster' | 'specters' | 'data';

const SECTIONS: ReadonlyArray<{ name: SectionName; label: string }> = [
  { name: 'arena', label: 'Arena' },
  { name: 'roster', label: 'Roster' },
  { name: 'specters', label: 'Specters' },
  { name: 'data', label: 'Data' },
];

function initialView(data: RosterData | null, watched: ReadonlySet<string>): ViewName | null {
  if (data === null) return null;
  const onRoster = data.complete ? [...watched].some((id) => data.items.some((item) => item.bindingId === id)) : watched.size > 0;
  return onRoster ? 'watched' : 'all';
}

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));

export function ObservatoryPage() {
  useInjectedStyle();
  useSpecterStyle();
  useWorkStyle();
  useArenaStyle();
  useDataStyle();
  const { state, refresh } = useRoster();
  const specters = useSpecters();
  const xp = useXp();
  const data = state.data;
  const rosterIds = useMemo(
    () => (data === null ? null : { ids: new Set(data.items.map((item) => item.bindingId)), complete: data.complete }),
    [data],
  );
  const { watched, toggle, clear, persistFailed, full } = useWatched(rosterIds);
  const [latchedView, setLatchedView] = useState<ViewName | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const decidedView = latchedView ?? initialView(data, watched);
  const view = decidedView ?? 'all';
  useEffect(() => {
    if (latchedView === null && decidedView !== null) setLatchedView(decidedView);
  }, [latchedView, decidedView]);

  const tabsId = useId();
  const panelId = `${tabsId}-panel`;
  const tabId = (name: ViewName) => `${tabsId}-tab-${name}`;
  const [section, setSection] = useState<SectionName>('arena');
  const sectionsId = useId();
  const sectionPanelId = `${sectionsId}-panel`;
  const sectionTabId = (name: SectionName) => `${sectionsId}-tab-${name}`;

  const [departed, setDeparted] = useState(false);
  useEffect(() => {
    if (selectedId === null || data === null || !data.complete) return;
    if (data.items.some((item) => item.bindingId === selectedId)) return;
    setSelectedId(null);
    setDeparted(true);
  }, [data, selectedId]);
  const select = (bindingId: string) => {
    setDeparted(false);
    setSelectedId(bindingId);
  };

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
      if (section !== 'roster' || searchRef.current === null) return;
      event.preventDefault();
      searchRef.current.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [section]);

  const items = data?.items ?? [];
  const inView = useMemo(() => (view === 'watched' ? items.filter((item) => watched.has(item.bindingId)) : items), [view, items, watched]);
  const visible = useMemo(() => inView.filter((item) => matchesQuery(item, query)), [inView, query]);
  const selected: RosterItemV1 | undefined = items.find((item) => item.bindingId === selectedId);
  const selectedCondition = selected === undefined ? null : botCondition(selected.condition);
  const attempts = useAttempts(selected?.bindingId ?? null);
  const openAttempts = attempts.state.status === 'ready' ? attempts.state.items.filter(isOpen).length : null;

  if (state.status === 'loading') {
    return (
      <div className="specter-arena-root" role="region" aria-label="Specter Arena">
        <h1>Specter Arena</h1>
        <p role="status">Loading bots…</p>
      </div>
    );
  }

  if (state.status === 'failed') {
    const copy = FAILURE_COPY[state.failure];
    return (
      <div className="specter-arena-root" role="region" aria-label="Specter Arena">
        <h1>Specter Arena</h1>
        <ErrorState title={copy.title} body={copy.body} onRetry={refresh} />
      </div>
    );
  }

  const roster = state.data;
  const failure = state.failure === null ? null : FAILURE_COPY[state.failure];

  const list = (() => {
    if (items.length === 0) {
      return <EmptyState title="No bots are on the roster yet" body="The collector has not seen any Kiro Crew bots. Create or open a bot in Crew, then refresh." />;
    }
    if (visible.length === 0 && query.trim() !== '' && inView.length > 0) {
      return <EmptyState title="No bots match" body="No bot name contains that search." action={<Button onClick={() => setQuery('')}>Clear search</Button>} />;
    }
    if (inView.length === 0) {
      return (
        <EmptyState
          title="No bots watched yet"
          body="Use Watch on a bot to keep it in this list."
          action={<Button onClick={() => setLatchedView('all')}>Show all bots</Button>}
        />
      );
    }
    return (
      <RosterList
        items={visible}
        selectedId={selectedId}
        watched={watched}
        watchListFull={full}
        specters={specters.byBinding}
        onSelect={select}
        onToggleWatch={toggle}
      />
    );
  })();

  return (
    <div className="specter-arena-root" role="region" aria-label="Specter Arena">
      <div className="sa-page">
        <header className="sa-header">
          <div className="sa-header__top">
            <h1>Specter Arena</h1>
            <div className="sa-header__actions">
              <span>
                Updated <Time ms={roster.fetchedAtMs} />
              </span>
              <Button onClick={refresh}>Refresh</Button>
            </div>
          </div>
          <p className="sa-collector" role="status">
            {collectorWords(roster.collector.state, roster.collector.reasonCode)}
            {roster.collector.sinceMs !== null && (
              <>
                {' '}
                Since <Time ms={roster.collector.sinceMs} />.
              </>
            )}
          </p>
          <ul className="sa-notes" aria-label="Notes">
            {roster.notes.map((note) => (
              <li key={note.code}>{noteWords(note.code, note.count)}</li>
            ))}
            {roster.truncated && <li>{truncationWords(items.length)}</li>}
            {persistFailed && <li>Selection won&apos;t be remembered in this browser</li>}
          </ul>
          {failure !== null && (
            <div className="sa-banner" role="alert">
              <span>
                Showing data from <Time ms={roster.fetchedAtMs} />. {failure.title}.
              </span>
              <Button onClick={refresh}>Retry</Button>
            </div>
          )}
          <OperationalLegend open={legendOpen} onToggle={() => setLegendOpen((open) => !open)} />
        </header>

        <Tabs label="Sections" tabs={SECTIONS} value={section} panelId={sectionPanelId} tabId={sectionTabId} onChange={setSection} />
        <div role="tabpanel" id={sectionPanelId} aria-labelledby={sectionTabId(section)}>
          <div hidden={section !== 'roster'}>
            <RosterKpis items={items} />
            <div className="sa-layout">
              <Panel label="Roster">
                <div className="sa-toolbar">
                  <Tabs label="Which bots to show" tabs={VIEWS} value={view} panelId={panelId} tabId={tabId} onChange={setLatchedView} />
                  <label className="sa-search">
                    <Icon name="search" />
                    <span className="sa-visually-hidden">Search bots by name</span>
                    <input
                      ref={searchRef}
                      type="search"
                      value={query}
                      placeholder="Search bots by name"
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape' && query !== '') setQuery('');
                      }}
                    />
                  </label>
                  {view === 'watched' && watched.size > 0 && (
                    <Button variant="ghost" onClick={() => { clear(); setLatchedView('all'); }}>
                      Unwatch all
                    </Button>
                  )}
                </div>
                <div role="tabpanel" id={panelId} aria-labelledby={tabId(view)}>
                  <p className="sa-result-count">{`${visible.length} of ${items.length} bots`}</p>
                  {list}
                </div>
              </Panel>

              <Panel label="Bot detail">
                {selected !== undefined ? (
                  <BotDetail
                    key={selected.bindingId}
                    item={selected}
                    collector={roster.collector}
                    rosterRevision={roster.rosterRevision}
                    attempts={attempts.state}
                    xp={xpViewOf(xp, selected.bindingId)}
                    onLoadOlder={attempts.loadOlder}
                    onRetry={attempts.refresh}
                  />
                ) : departed || selectedId !== null ? (
                  <p role="status">This bot is no longer on the roster.</p>
                ) : (
                  <p>Select a bot to see its condition and why.</p>
                )}
              </Panel>
            </div>
          </div>
          {section === 'specters' && <SpectersView bots={items} complete={roster.complete} specters={specters} xp={xp} />}
          {section === 'data' && <DataView />}
          {section === 'arena' && (
            <ArenaView
              bots={items}
              complete={roster.complete}
              collector={roster.collector}
              rosterRevision={roster.rosterRevision}
              specters={specters.byBinding}
              xp={xp.byBinding}
              xpStatus={xp.status}
            />
          )}
        </div>
        <p className="sa-visually-hidden" role="status" aria-live="polite">
          {selected !== undefined && selectedCondition !== null
            ? `Showing ${nameOf(selected)}: ${selectedCondition.label}${openAttempts === null ? '' : `, ${openAttempts} open ${openAttempts === 1 ? 'attempt' : 'attempts'}`}`
            : ''}
        </p>
      </div>
    </div>
  );
}
