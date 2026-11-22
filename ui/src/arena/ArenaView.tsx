import { useEffect, useMemo, useRef, useState } from 'react';
import type { RosterCollectorV1, RosterItemV1, XpSummaryV1 } from '../contracts/types';
import { useSourceMode } from '../host';
import { Time } from '../observatory/Time';
import { collectorWords } from '../observatory/copy';
import { Button, EmptyState, ErrorState } from '../observatory/ui';
import { PARTIAL_ROSTER } from '../work/copy';
import { taskTitle } from '../tasks/copy';
import { ArenaInspector } from './ArenaInspector';
import { ArenaListView } from './ArenaListView';
import { ArenaRail } from './ArenaRail';
import type { SpecterReading } from './ArenaRail';
import { ArenaStats } from './ArenaStats';
import { BattlefieldScene } from './BattlefieldScene';
import { BotsOnField } from './BotsOnField';
import { ModeBadge } from './ModeBadge';
import { ARENA } from './copy';
import { enemyEffect } from './effectMap';
import { MARKS, mark } from './marks';
import { buildSceneModel } from './sceneModel';
import type { XpReading } from './sceneModel';
import type { ArenaSelection } from './selection';
import type { ArenaSpecter } from './specterShape';
import { useArenaExchanges } from './useArenaExchanges';
import { useArenaMotion } from './useArenaMotion';
import { useArenaScene } from './useArenaScene';
import { useArenaWork } from './useArenaWork';
import type { ArenaWorkFailure, ArenaWorkSnapshot } from './useArenaWork';

interface Props {
  bots: readonly RosterItemV1[];
  complete: boolean;
  collector: RosterCollectorV1;
  rosterRevision: number;
  specters: ReadonlyMap<string, ArenaSpecter>;
  /** Whether the Specters read has finished. While it has not, "no Specter yet" would be a guess. Default `ready`. */
  specterStatus?: SpecterReading;
  xp: ReadonlyMap<string, XpSummaryV1>;
  /** Whether the XP ledger has been read. Without it a bot with no entry would read as Level 1 and 0 XP. Default `ready`. */
  xpStatus?: XpReading;
  /** One number per page visit; heroes are placed from it. The page makes it once, so switching tabs keeps it. */
  visitSeed?: number;
  /** The bindings the backend says have no Specter. When given, the rail's "No Specter yet" group is exactly these roster bots. */
  unassigned?: ReadonlySet<string>;
  /** Opens the assignment flow for a bot. Without it the rail shows no Assign button. */
  onAssign?: (bindingId: string) => void;
}

const NARROW = '(max-width: 600px)';
/** Both panes start open, except on a phone-width window where they start collapsed. A missing `matchMedia` means open. */
const startsOpen = (): boolean => typeof window.matchMedia !== 'function' || !window.matchMedia(NARROW).matches;

const FAILURE_COPY: Readonly<Record<ArenaWorkFailure, { title: string; body: string }>> = {
  unsupported: { title: ARENA.unsupportedTitle, body: ARENA.unsupportedBody },
  forbidden: { title: ARENA.forbiddenTitle, body: ARENA.forbiddenBody },
  offline: { title: ARENA.offlineTitle, body: ARENA.offlineBody },
  unavailable: { title: ARENA.unavailableTitle, body: ARENA.unavailableBody },
  unexpected: { title: ARENA.unexpectedTitle, body: ARENA.unexpectedBody },
};

/**
 * The Arena tab: a read-only projection of the roster, the Specters, the XP ledger and the task list. It starts
 * its own work poll while mounted, so leaving the tab stops the poll and returning is a fresh baseline.
 */
export function ArenaView({ bots, complete, collector, rosterRevision, specters, specterStatus = 'ready', xp, xpStatus = 'ready', visitSeed, unassigned, onAssign }: Props) {
  const mode = useSourceMode();
  const { state, refresh } = useArenaWork();
  const motion = useArenaMotion();
  const [selection, setSelection] = useState<ArenaSelection | null>(null);
  const [railOpen, setRailOpen] = useState(startsOpen);
  const [inspectorOpen, setInspectorOpen] = useState(startsOpen);
  /** Selecting opens the inspector: a hidden one cannot take focus, so the selection would show nothing. */
  const select = (next: ArenaSelection) => {
    setSelection(next);
    setInspectorOpen(true);
  };
  const snapshot: ArenaWorkSnapshot | null = state.snapshot;

  const phase = useRef<'none' | 'first' | 'update'>('none');
  const seen = useRef<ArenaWorkSnapshot | null>(null);
  if (snapshot !== null && snapshot !== seen.current) {
    phase.current = seen.current === null ? 'first' : 'update';
    mark(phase.current === 'first' ? MARKS.dataReady : MARKS.updateStart);
    seen.current = snapshot;
  }
  useEffect(() => {
    if (phase.current === 'first') mark(MARKS.firstRender);
    if (phase.current === 'update') mark(MARKS.updateEnd);
    phase.current = 'none';
  }, [snapshot]);

  const models = useMemo(() => {
    if (snapshot === null) return null;
    const inputs = {
      mode,
      nowMs: snapshot.asOfMs,
      roster: bots,
      specters: [...specters.values()],
      xp: [...xp.values()],
      tasks: snapshot.items,
      tasksTruncated: snapshot.truncated,
      xpStatus,
    };
    return { scene: buildSceneModel(inputs), list: buildSceneModel(inputs, Infinity) };
  }, [snapshot, mode, bots, specters, xp, xpStatus]);
  const celebrations = useArenaScene(models?.scene ?? null, snapshot?.receivedAtMs ?? null, motion.animate);
  const collectorPaused = collector.state === 'paused';
  const exchanges = useArenaExchanges(models?.scene ?? null, motion.animate && !collectorPaused, celebrations.rises);
  const items = useMemo(() => new Map((snapshot?.items ?? []).map((item) => [item.taskId, item])), [snapshot]);
  const drawn = useMemo(() => new Set(models?.scene.enemies.map((enemy) => enemy.workId) ?? []), [models]);

  const selectedSpecter = selection?.kind === 'specter' ? (models?.list.specters.find((s) => s.bindingId === selection.bindingId) ?? null) : null;
  const selectedEnemy = selection?.kind === 'work' ? (models?.list.enemies.find((e) => e.workId === selection.workId) ?? null) : null;
  const selectedTask = selection?.kind === 'work' ? items.get(selection.workId) : undefined;
  const selectedTitle = selection?.kind === 'work' ? (selectedEnemy?.title ?? (selectedTask === undefined ? null : taskTitle(selectedTask))) : null;
  const announcement =
    selectedSpecter !== null
      ? ARENA.selected(selectedSpecter.specterName ?? selectedSpecter.displayName, ARENA.linked(selectedSpecter.openAttemptIds.length))
      : selectedEnemy !== null
        ? ARENA.selected(selectedEnemy.title, enemyEffect(selectedEnemy).stateText)
        : selectedTitle !== null
          ? ARENA.selected(selectedTitle, 'not on the field')
          : '';

  const header = (
    <header className="sa-arena-header">
      <div className="sa-arena-header__top">
        <h2>Arena</h2>
        <ModeBadge mode={mode} />
        {snapshot !== null && (
          <span>
            {`${ARENA.asOf} `}
            <Time ms={snapshot.asOfMs} />
          </span>
        )}
      </div>
      <p className="sa-help">{collectorWords(collector.state, collector.reasonCode)}</p>
      <p className="sa-help">{ARENA.attackLegend}</p>
      {models !== null && <p className="sa-help">{ARENA.coverage(models.scene.coverage.gaps, models.scene.coverage.unknownBots)}</p>}
      {!complete && <p className="sa-help">{PARTIAL_ROSTER}</p>}
    </header>
  );

  let body;
  if (state.status === 'loading') {
    body = <p role="status">{ARENA.loading}</p>;
  } else if (state.status === 'failed') {
    const copy = FAILURE_COPY[state.failure];
    body =
      state.failure === 'unsupported' ? (
        <EmptyState title={copy.title} body={copy.body} />
      ) : (
        <ErrorState title={copy.title} body={copy.body} onRetry={refresh} />
      );
  } else if (bots.length === 0 && complete) {
    body = <EmptyState title={ARENA.emptyRosterTitle} body={ARENA.emptyRosterBody} />;
  } else if (models !== null) {
    const stale = state.failure === null ? null : FAILURE_COPY[state.failure];
    body = (
      <>
        {stale !== null && snapshot !== null && (
          <div className="sa-banner" role="alert">
            <span>
              {`${ARENA.staleBanner} `}
              <Time ms={snapshot.receivedAtMs} />
              {`. ${stale.title}.`}
            </span>
            <Button onClick={refresh}>{ARENA.retry}</Button>
          </div>
        )}
        <ArenaStats botsObserved={bots.length} coverageUnknown={models.scene.coverage.unknownBots} committedXp={[...xp.values()].reduce((sum, summary) => sum + summary.totalXp, 0)} xpReading={xpStatus} />
        <BotsOnField bots={bots} specters={specters} />
        <div className={`sa-arena-layout${railOpen ? '' : ' sa-is-rail-collapsed'}${inspectorOpen ? '' : ' sa-is-inspector-collapsed'}`}>
          <ArenaRail model={models.scene} bots={bots} specters={specters} xp={xp} selection={selection} onSelect={select} open={railOpen} onToggle={() => setRailOpen((value) => !value)} specterStatus={specterStatus} unassigned={unassigned} onAssign={onAssign} />
          <BattlefieldScene model={models.scene} selection={selection} onSelect={select} motion={motion} cues={celebrations.cues} celebrating={celebrations.celebrating} onCueComplete={celebrations.complete} exchanges={exchanges} collectorPaused={collectorPaused} visitSeed={visitSeed} />
          <ArenaInspector
            selection={selection}
            list={models.list}
            bots={bots}
            collector={collector}
            rosterRevision={rosterRevision}
            specters={specters}
            xp={xp}
            items={items}
            open={inspectorOpen}
            onToggle={() => setInspectorOpen((value) => !value)}
            onSelect={select}
            onClose={() => setSelection(null)}
          />
        </div>
        <ArenaListView model={models.list} bots={bots} items={items} drawn={drawn} selection={selection} onSelect={select} />
      </>
    );
  }

  return (
    <div className="sa-arena" role="region" aria-label={ARENA.region}>
      {header}
      {body}
      <p className="sa-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
