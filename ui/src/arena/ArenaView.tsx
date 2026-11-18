import { useEffect, useMemo, useRef, useState } from 'react';
import type { RosterCollectorV1, RosterItemV1, SpecterV1, XpSummaryV1 } from '../contracts/types';
import { useSourceMode } from '../host';
import { Time } from '../observatory/Time';
import { collectorWords } from '../observatory/copy';
import { Button, EmptyState, ErrorState } from '../observatory/ui';
import { PARTIAL_ROSTER } from '../work/copy';
import { ArenaInspector } from './ArenaInspector';
import { ArenaListView } from './ArenaListView';
import { ArenaRail } from './ArenaRail';
import { BattlefieldScene } from './BattlefieldScene';
import { ModeBadge } from './ModeBadge';
import { ARENA } from './copy';
import { MARKS, mark } from './marks';
import { buildSceneModel } from './sceneModel';
import type { ArenaSelection } from './selection';
import { useArenaMotion } from './useArenaMotion';
import { useArenaScene } from './useArenaScene';
import { useArenaWork } from './useArenaWork';
import type { ArenaWorkFailure, ArenaWorkSnapshot } from './useArenaWork';

interface Props {
  bots: readonly RosterItemV1[];
  complete: boolean;
  collector: RosterCollectorV1;
  rosterRevision: number;
  specters: ReadonlyMap<string, SpecterV1>;
  xp: ReadonlyMap<string, XpSummaryV1>;
  /** Called after the in-app decision flow changes the ledger, so the XP numbers elsewhere refresh. */
  onLedgerChanged: () => void;
}

const FAILURE_COPY: Readonly<Record<ArenaWorkFailure, { title: string; body: string }>> = {
  unsupported: { title: ARENA.unsupportedTitle, body: ARENA.unsupportedBody },
  forbidden: { title: ARENA.forbiddenTitle, body: ARENA.forbiddenBody },
  offline: { title: ARENA.offlineTitle, body: ARENA.offlineBody },
  unavailable: { title: ARENA.unavailableTitle, body: ARENA.unavailableBody },
  unexpected: { title: ARENA.unexpectedTitle, body: ARENA.unexpectedBody },
};

/**
 * The Arena tab: a read-only projection of the roster, the Specters, the XP ledger and the work list. It starts
 * its own work poll while mounted, so leaving the tab stops the poll and returning is a fresh baseline.
 */
export function ArenaView({ bots, complete, collector, rosterRevision, specters, xp, onLedgerChanged }: Props) {
  const mode = useSourceMode();
  const { state, refresh } = useArenaWork();
  const motion = useArenaMotion();
  const [selection, setSelection] = useState<ArenaSelection | null>(null);
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
      work: snapshot.items,
      workTruncated: snapshot.truncated,
    };
    return { scene: buildSceneModel(inputs), list: buildSceneModel(inputs, Infinity) };
  }, [snapshot, mode, bots, specters, xp]);
  const celebrations = useArenaScene(models?.scene ?? null, snapshot?.receivedAtMs ?? null, motion.animate);
  const items = useMemo(() => new Map((snapshot?.items ?? []).map((item) => [item.workId, item])), [snapshot]);
  const drawn = useMemo(() => new Set(models?.scene.enemies.map((enemy) => enemy.workId) ?? []), [models]);

  const selectedSpecter = selection?.kind === 'specter' ? (models?.list.specters.find((s) => s.bindingId === selection.bindingId) ?? null) : null;
  const selectedEnemy = selection?.kind === 'work' ? (models?.list.enemies.find((e) => e.workId === selection.workId) ?? null) : null;
  const selectedTitle = selection?.kind === 'work' ? (selectedEnemy?.title ?? items.get(selection.workId)?.title ?? null) : null;
  const announcement =
    selectedSpecter !== null
      ? ARENA.selected(selectedSpecter.specterName ?? selectedSpecter.displayName, ARENA.linked(selectedSpecter.openAttemptIds.length))
      : selectedEnemy !== null
        ? ARENA.selected(selectedEnemy.title, selectedEnemy.defeated ? 'Defeated' : selectedEnemy.state)
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
        <div className="sa-arena-layout">
          <ArenaRail model={models.scene} bots={bots} specters={specters} selection={selection} onSelect={setSelection} />
          <BattlefieldScene model={models.scene} specters={specters} selection={selection} onSelect={setSelection} motion={motion} cues={celebrations.cues} celebrating={celebrations.celebrating} onCueComplete={celebrations.complete} />
          <ArenaInspector
            selection={selection}
            list={models.list}
            bots={bots}
            collector={collector}
            rosterRevision={rosterRevision}
            specters={specters}
            xp={xp}
            items={items}
            onSelect={setSelection}
            onClose={() => setSelection(null)}
            onLedgerChanged={onLedgerChanged}
            onWorkChanged={refresh}
          />
        </div>
        <ArenaListView model={models.list} bots={bots} items={items} drawn={drawn} selection={selection} onSelect={setSelection} />
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
