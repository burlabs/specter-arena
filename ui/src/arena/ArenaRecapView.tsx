import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { RecapV1 } from '../contracts/types';
import { useSourceMode } from '../host';
import { Time, TimeFormatContext } from '../observatory/Time';
import { formatTime } from '../observatory/model';
import { Button, EmptyState, ErrorState } from '../observatory/ui';
import { useMotionAllowed } from '../specters/useMotionAllowed';
import { ArenaInspector } from './ArenaInspector';
import { ArenaListView } from './ArenaListView';
import { FAILURE_COPY, startsOpen } from './ArenaLive';
import type { ArenaProps } from './ArenaLive';
import { ArenaRail } from './ArenaRail';
import { BattlefieldScene } from './BattlefieldScene';
import { ModeBadge } from './ModeBadge';
import { RecapControls } from './RecapControls';
import { RecapScrubBar } from './RecapScrubBar';
import { ARENA } from './copy';
import { enemyEffect } from './effectMap';
import { NOT_COLLECTED_WORDS, RECAP, spanWords } from './recapCopy';
import { crossings } from './recapCues';
import { createFrameSource } from './recapFrames';
import { isMondayToday } from './recapPeriods';
import type { RecapKind } from './recapPeriods';
import { buildTimeline, markerAt, playToSource } from './recapTimeline';
import { buildSceneModel } from './sceneModel';
import type { ArenaSelection } from './selection';
import type { PresentationCue } from './PresentationCueLayer';
import { useArenaExchanges } from './useArenaExchanges';
import { useRecap } from './useRecap';
import { useRecapPlayer } from './useRecapPlayer';

interface Props extends ArenaProps {
  kind: RecapKind;
  onExit: () => void;
  /** The backend has no recap route (404): the mode bar turns the recap choices off. */
  onUnsupported: () => void;
}

const NO_RISES: readonly never[] = [];

const emptyWords = (recap: RecapV1, kind: RecapKind, mondayWeek: boolean, state: 'no-tasks' | 'not-collected'): string => {
  if (state === 'not-collected') {
    const reason = recap.coverage.spans[0]?.reason;
    return reason === undefined || reason === 'collecting' ? RECAP.notCollected : NOT_COLLECTED_WORDS[reason];
  }
  return kind === 'today' ? RECAP.noTasksToday : mondayWeek ? RECAP.noTasksWeek : RECAP.noTasksCollected;
};

/** The Arena tab in recap mode: one recorded period replayed through the arena the owner already knows. Reads and shows; writes nothing. */
export function ArenaRecapView(props: Props) {
  const { kind, onExit, onUnsupported } = props;
  const { state, refresh } = useRecap(kind);
  const failure = state.failure;
  useEffect(() => {
    if (failure === 'unsupported') onUnsupported();
  }, [failure, onUnsupported]);

  if (state.status === 'ready') return <RecapBody {...props} recap={state.recap} />;
  const exit = <Button onClick={onExit}>{RECAP.exit}</Button>;
  return (
    <div className="sa-arena" role="region" aria-label={ARENA.region}>
      <header className="sa-arena-header">
        <div className="sa-arena-header__top">
          <h2>{`Arena: ${RECAP.period(kind)}`}</h2>
          <ModeBadge mode="RECORDED" />
          {exit}
        </div>
      </header>
      {state.status === 'loading' ? (
        <p role="status">{RECAP.loading}</p>
      ) : state.failure === 'unsupported' ? (
        <EmptyState title={FAILURE_COPY.unsupported.title} body={FAILURE_COPY.unsupported.body} />
      ) : (
        <ErrorState title={FAILURE_COPY[state.failure].title} body={FAILURE_COPY[state.failure].body} onRetry={refresh} />
      )}
    </div>
  );
}

function RecapBody({ recap, kind, onExit, bots, collector, rosterRevision, specters, specterStatus = 'ready', xp, unassigned, onAssign }: Props & { recap: RecapV1 }) {
  const source = useSourceMode();
  const allowed = useMotionAllowed();
  const timeFormat = useContext(TimeFormatContext);
  const timeline = useMemo(() => buildTimeline(recap, kind), [recap, kind]);
  const frameAt = useMemo(() => createFrameSource(recap, timeline, { roster: bots, specters: [...specters.values()], mode: 'RECORDED' }), [recap, timeline, bots, specters]);
  const [cues, setCues] = useState<readonly PresentationCue[]>([]);
  const celebrate = useCallback(
    (fromMs: number, toMs: number) => {
      const fresh = crossings(fromMs, toMs, timeline);
      if (fresh.length > 0) setCues((current) => [...current, ...fresh]);
    },
    [timeline],
  );
  const player = useRecapPlayer({ totalMs: timeline.totalMs, events: timeline.events, allowed, onAdvance: celebrate });
  const frame = frameAt(player.playMs);
  const models = useMemo(() => ({ scene: buildSceneModel(frame.inputs), list: buildSceneModel(frame.inputs, Infinity) }), [frame.inputs]);
  const animate = allowed && player.playing;
  const exchanges = useArenaExchanges(models.scene, animate, NO_RISES);

  useEffect(() => {
    if (!animate) setCues((current) => (current.length === 0 ? current : []));
  }, [animate]);
  const completeCue = useCallback((id: string) => setCues((current) => current.filter((cue) => cue.id !== id)), []);
  const celebrating = useMemo(() => new Set(cues.map((cue) => cue.workId)), [cues]);

  const [selection, setSelection] = useState<ArenaSelection | null>(null);
  const [railOpen, setRailOpen] = useState(startsOpen);
  const [inspectorOpen, setInspectorOpen] = useState(startsOpen);
  const select = (next: ArenaSelection) => {
    setSelection(next);
    setInspectorOpen(true);
  };
  const items = useMemo(() => new Map(recap.tasks.map((task) => [task.taskId, task])), [recap]);
  const drawn = useMemo(() => new Set(models.scene.enemies.map((enemy) => enemy.workId)), [models]);
  const selectedSpecter = selection?.kind === 'specter' ? (models.list.specters.find((s) => s.bindingId === selection.bindingId) ?? null) : null;
  const selectedEnemy = selection?.kind === 'work' ? (models.list.enemies.find((e) => e.workId === selection.workId) ?? null) : null;
  const announcement = selectedSpecter !== null ? ARENA.selected(selectedSpecter.displayName, ARENA.linked(selectedSpecter.openAttemptIds.length)) : selectedEnemy !== null ? ARENA.selected(selectedEnemy.title, enemyEffect(selectedEnemy).stateText) : '';

  const credited = recap.tasks.filter((task) => task.state === 'credited').length;
  const open = recap.tasks.filter((task) => task.state === 'open').length;
  const xpTotal = recap.tasks.reduce((sum, task) => sum + (task.xpCredited ?? 0), 0);
  const mondayWeek = kind === 'week' && isMondayToday(recap.toMs);
  const skip = markerAt(timeline, player.playMs);
  const clockText = formatTime(frame.sourceMs, { ...timeFormat, long: true });
  const caption = frame.notCollected !== null && frame.notCollected.reason !== 'collecting' ? NOT_COLLECTED_WORDS[frame.notCollected.reason] : null;
  const announcedAt = formatTime(playToSource(timeline, frame.inputs.nowMs), { ...timeFormat, long: true });
  const emptyState = timeline.empty;

  return (
    <div className="sa-arena sa-recap" role="region" aria-label={ARENA.region} data-recap={kind}>
      <header className="sa-arena-header">
        <div className="sa-arena-header__top">
          <h2>{`Arena: ${RECAP.period(kind)}`}</h2>
          <ModeBadge mode="RECORDED" />
          {source === 'FIXTURE' && <ModeBadge mode="FIXTURE" />}
          <span>
            <Time ms={recap.fromMs} /> {'to '}
            <Time ms={recap.toMs} />
          </span>
        </div>
        {mondayWeek && <p className="sa-help">{RECAP.weekToday}</p>}
        <p className="sa-help">{`${RECAP.heroesNote} ${RECAP.tasksNote}`}</p>
        <p className="sa-help">{ARENA.attackLegend}</p>
        {recap.truncated && <p className="sa-help">{RECAP.truncated(recap.tasks.length, recap.tasks.length + recap.omittedCount)}</p>}
        {frame.unrostered > 0 && <p className="sa-help">{`${frame.unrostered} ${frame.unrostered === 1 ? 'task' : 'tasks'} of bots that are not on the roster counted, not drawn.`}</p>}
      </header>
      <div role="group" aria-label={RECAP.statsLabel}>
        <dl className="sa-arena-stats">
          <div className="sa-arena-stat">
            <dt>{RECAP.tasksSeen}</dt>
            <dd>{recap.tasks.length}</dd>
            <dd className="sa-help">{RECAP.tasksBreakdown(credited, recap.tasks.length - credited - open, open)}</dd>
          </div>
          <div className="sa-arena-stat">
            <dt>{RECAP.xpCredited}</dt>
            <dd>{xpTotal}</dd>
          </div>
          <div className="sa-arena-stat">
            <dt>{RECAP.collected}</dt>
            <dd>{spanWords(timeline.collectedMs)}</dd>
          </div>
          <div className="sa-arena-stat">
            <dt>{RECAP.notCollectedTotal}</dt>
            <dd>{spanWords(timeline.notCollectedMs)}</dd>
          </div>
          <div className="sa-arena-stat">
            <dt>{RECAP.length}</dt>
            <dd>{spanWords(timeline.totalMs)}</dd>
          </div>
        </dl>
      </div>
      <RecapControls player={player} allowed={allowed} empty={emptyState !== null} onExit={onExit} />
      {emptyState !== null && <p role="status">{emptyWords(recap, kind, mondayWeek, emptyState)}</p>}
      <RecapScrubBar recap={recap} timeline={timeline} playMs={player.playMs} onSeek={player.seek} valueText={clockText} />
      <p className="sa-help">{RECAP.legend}</p>
      <p className="sa-recap-clock" aria-label={RECAP.clock}>
        <Time ms={frame.sourceMs} long />
        {skip !== null && <strong className="sa-recap-caption">{` ${RECAP.skipped(skip.skippedMs)}`}</strong>}
        {caption !== null && <strong className="sa-recap-caption sa-recap-caption--hatched">{` ${caption}`}</strong>}
      </p>
      <p className="sa-visually-hidden" role="status" aria-live="polite">
        {`${announcedAt}${caption === null ? '' : `. ${caption}`}${skip === null ? '' : `. ${RECAP.skipped(skip.skippedMs)}`}`}
      </p>
      <div className={`sa-arena-layout${railOpen ? '' : ' sa-is-rail-collapsed'}${inspectorOpen ? '' : ' sa-is-inspector-collapsed'}`}>
        <ArenaRail model={models.scene} bots={bots} specters={specters} xp={xp} selection={selection} onSelect={select} open={railOpen} onToggle={() => setRailOpen((value) => !value)} specterStatus={specterStatus} unassigned={unassigned} onAssign={onAssign} />
        <BattlefieldScene
          model={models.scene}
          selection={selection}
          onSelect={select}
          motion={{ animate, paused: !player.playing, togglePause: player.playing ? player.pause : player.play }}
          cues={cues}
          celebrating={celebrating}
          onCueComplete={completeCue}
          exchanges={exchanges}
          collectorPaused={false}
        />
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
      {models.scene.overflow.enemies > 0 && <p className="sa-help">{RECAP.notDrawn(models.scene.overflow.enemies)}</p>}
      <ArenaListView model={models.list} bots={bots} items={items} drawn={drawn} selection={selection} onSelect={select} />
      <p className="sa-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
