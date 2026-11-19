import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { SpecterV2 } from '../contracts/types';
import { SpecterPortrait } from '../specters/SpecterPortrait';
import { tokenInitials } from '../specters/model';
import { AnimatedMinion } from './AnimatedMinion';
import { ArenaMinimap } from './ArenaMinimap';
import { PresentationCueLayer } from './PresentationCueLayer';
import type { PresentationCue } from './PresentationCueLayer';
import { MarkerAssistanceSvg, MarkerBlockedSvg, MarkerCoverageUnknownSvg, MarkerEvidenceSvg, MarkerOutcomeAcceptedSvg } from './SceneSvgs';
import { ARENA, HUD, PLACEHOLDER_TOKEN } from './copy';
import { enemyEffect, specterStance } from './effectMap';
import type { MarkerKind } from './effectMap';
import { MAX_ZOOM, MIN_ZOOM, clamp, createSceneTransform, visibleNormalizedRect } from './geometry';
import { ARENA_INTRINSIC } from './mapLayout';
import { assignSlots, placeScene, slotIdsOf } from './sceneLayout';
import type { Placement } from './sceneLayout';
import type { SceneEnemy, SceneModel, SceneSpecter } from './sceneModel';
import { isSelected } from './selection';
import type { ArenaSelection } from './selection';
import type { ArenaMotion } from './useArenaMotion';
import { useElementSize } from './useElementSize';
import { useSceneAsset } from './useSceneAsset';
import { Button } from '../observatory/ui';

const ZOOM_STEP = 0.25;

interface Props {
  model: SceneModel;
  specters: ReadonlyMap<string, SpecterV2>;
  selection: ArenaSelection | null;
  onSelect: (selection: ArenaSelection) => void;
  motion: ArenaMotion;
  /** Celebrations to play, from `useArenaScene`. */
  cues: readonly PresentationCue[];
  /** Work ids whose defeat animation is playing right now. */
  celebrating: ReadonlySet<string>;
  onCueComplete: (id: string) => void;
}

function MarkerIcon({ kind }: { kind: MarkerKind }) {
  const common = { title: '', decorative: true, className: 'sa-token__marker' } as const;
  if (kind === 'blocked') return <MarkerBlockedSvg {...common} />;
  if (kind === 'evidence') return <MarkerEvidenceSvg {...common} />;
  if (kind === 'outcome-accepted') return <MarkerOutcomeAcceptedSvg {...common} />;
  if (kind === 'assistance') return <MarkerAssistanceSvg {...common} />;
  return <MarkerCoverageUnknownSvg {...common} />;
}

function specterName(specter: SceneSpecter): string {
  // The printed name and the "×N attempts" badge come first and in the printed order, so the accessible name contains the visible text.
  const printed = specter.openAttemptIds.length > 1 ? `${specter.specterName ?? specter.displayName} ${ARENA.attemptsBadge(specter.openAttemptIds.length)}` : (specter.specterName ?? specter.displayName);
  return specter.specterName === null ? `${printed}, no Specter yet` : `${printed} for ${specter.displayName}`;
}

function specterLabel(specter: SceneSpecter, conditionLabel: string): string {
  const parts = [specterName(specter), specter.specterName === null ? PLACEHOLDER_TOKEN : null, conditionLabel, `Level ${specter.level}`];
  if (specter.openAttemptIds.length > 0) parts.push(ARENA.linked(specter.openAttemptIds.length));
  return parts.filter((part): part is string => part !== null).join(', ');
}

function enemyLabel(enemy: SceneEnemy): string {
  const effect = enemyEffect(enemy);
  const parts = [enemy.title, effect.stateText, effect.progressText];
  if (enemy.defeated && enemy.committedXp !== null) parts.push(ARENA.xpAward(enemy.committedXp));
  parts.push(enemy.size === 'encounter' ? 'encounter' : 'work item');
  return parts.join(', ');
}

interface SpecterTokenProps {
  specter: SceneSpecter;
  record: SpecterV2 | undefined;
  position: { x: number; y: number };
  selected: boolean;
  roving: boolean;
  onSelect: () => void;
  register: (element: HTMLButtonElement | null) => void;
}

function SpecterToken({ specter, record, position, selected, roving, onSelect, register }: SpecterTokenProps) {
  const stance = specterStance(specter);
  const conditionLabel = stance === 'coverage-unknown' ? ARENA.unknownCondition : stance === 'engaging' ? ARENA.engaging : ARENA.atRest;
  const style: CSSProperties = { left: `${position.x * 100}%`, top: `${position.y * 100}%` };
  return (
    <button
      type="button"
      ref={register}
      className={`sa-token sa-token--specter sa-is-${stance}${selected ? ' sa-is-selected' : ''}`}
      style={style}
      data-sprite="specter"
      data-scene-node="specter"
      data-token={specter.bindingId}
      aria-pressed={selected}
      aria-label={specterLabel(specter, conditionLabel)}
      tabIndex={roving ? 0 : -1}
      onClick={onSelect}
    >
      {record !== undefined ? (
        <SpecterPortrait specter={record} size="sm" decorative active={stance === 'engaging'} />
      ) : (
        <span className="sa-token__placeholder" aria-hidden="true" data-initials={tokenInitials(specter.displayName)} />
      )}
      <span className="sa-token__label" aria-hidden="true">
        {specter.specterName ?? specter.displayName}
      </span>
      {specter.openAttemptIds.length > 1 && (
        <>
          {' '}
          <span className="sa-token__badge" aria-hidden="true">
            {ARENA.attemptsBadge(specter.openAttemptIds.length)}
          </span>
        </>
      )}
      {stance === 'coverage-unknown' && <MarkerIcon kind="coverage-unknown" />}
    </button>
  );
}

interface EnemyTokenProps {
  enemy: SceneEnemy;
  position: { x: number; y: number };
  selected: boolean;
  roving: boolean;
  animate: boolean;
  celebrating: boolean;
  spriteReady: boolean;
  facing: 'left' | 'right';
  onSelect: () => void;
  register: (element: HTMLButtonElement | null) => void;
}

function EnemyToken({ enemy, position, selected, roving, animate, celebrating, spriteReady, facing, onSelect, register }: EnemyTokenProps) {
  const effect = enemyEffect(enemy);
  const style: CSSProperties = { left: `${position.x * 100}%`, top: `${position.y * 100}%` };
  return (
    <button
      type="button"
      ref={register}
      className={`sa-token sa-token--enemy sa-token--${enemy.size} sa-is-${effect.pose}${selected ? ' sa-is-selected' : ''}${enemy.blocked ? ' sa-is-blocked' : ''}`}
      style={style}
      data-sprite="enemy"
      data-scene-node="enemy"
      data-token={enemy.workId}
      aria-pressed={selected}
      aria-label={enemyLabel(enemy)}
      tabIndex={roving ? 0 : -1}
      onClick={onSelect}
    >
      <AnimatedMinion
        minionType={enemy.size === 'encounter' ? 'patchbrute' : 'patchling'}
        animation={celebrating ? 'defeat' : effect.pose === 'engaged' ? 'engaged' : 'idle'}
        animate={animate}
        spriteReady={spriteReady}
        defeated={enemy.defeated}
        facing={facing}
      />
      <span className="sa-token__label" aria-hidden="true">
        {enemy.title}
      </span>{' '}
      <span className="sa-token__meta" aria-hidden="true">
        {effect.stateText}
        {' · '}
        {effect.progressText}
      </span>
      {enemy.defeated && enemy.committedXp !== null && (
        <>
          {' '}
          <span className="sa-token__xp" aria-hidden="true">
            {ARENA.xpAward(enemy.committedXp)}
          </span>
        </>
      )}
      {effect.marker !== null && <MarkerIcon kind={effect.marker} />}
    </button>
  );
}

function engagementFacing(enemy: SceneEnemy, placement: Placement): 'left' | 'right' {
  const here = placement.enemies.get(enemy.workId);
  const first = enemy.engagedBy[0];
  const there = first === undefined ? undefined : placement.specters.get(first);
  return here !== undefined && there !== undefined && there.x > here.x ? 'right' : 'left';
}

const cssUrl = (url: string): string => `url("${url}")`;

/**
 * The map, the tokens and the camera. Everything here is presentation: camera, pause and animation live in
 * React state and CSS only, and nothing in this file calls the backend except the three read-only art fetches.
 */
export function BattlefieldScene({ model, specters, selection, onSelect, motion, cues, celebrating, onCueComplete }: Props) {
  const mapArt = useSceneAsset('arena-map');
  const patchling = useSceneAsset('minion-patchling-sprite');
  const patchbrute = useSceneAsset('minion-patchbrute-sprite');

  const viewportRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(viewportRef);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [minimapOpen, setMinimapOpen] = useState(true);
  const drag = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);

  const intrinsicWidth = mapArt.status === 'ready' ? mapArt.art.width : ARENA_INTRINSIC.width;
  const intrinsicHeight = mapArt.status === 'ready' ? mapArt.art.height : ARENA_INTRINSIC.height;
  const transform = useMemo(
    () => createSceneTransform(size, { width: intrinsicWidth, height: intrinsicHeight }, zoom, pan),
    [size, intrinsicWidth, intrinsicHeight, zoom, pan],
  );

  const slotMemory = useRef<ReadonlyMap<string, number>>(new Map());
  const slotIds = useMemo(() => slotIdsOf(model), [model]);
  const slots = useMemo(() => {
    const next = assignSlots(slotMemory.current, slotIds);
    slotMemory.current = next;
    return next;
  }, [slotIds]);
  const placement = useMemo(() => placeScene(model, slots), [model, slots]);
  const view = useMemo(() => visibleNormalizedRect(transform), [transform]);

  const order = useMemo(() => [...model.specters.map((s) => s.bindingId), ...model.enemies.map((e) => e.workId)], [model]);
  const [rovingId, setRovingId] = useState<string | null>(null);
  const activeId = rovingId !== null && order.includes(rovingId) ? rovingId : (order[0] ?? null);
  const tokens = useRef(new Map<string, HTMLButtonElement>());
  const register = (id: string) => (element: HTMLButtonElement | null) => {
    if (element === null) tokens.current.delete(id);
    else tokens.current.set(id, element);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = order.indexOf((event.target as HTMLElement).getAttribute('data-token') ?? '');
    if (from === -1) return;
    const last = order.length - 1;
    const to =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? Math.min(last, from + 1)
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? Math.max(0, from - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    const target = to === null ? undefined : order[to];
    if (target === undefined) return;
    event.preventDefault();
    setRovingId(target);
    tokens.current.get(target)?.focus();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-scene-node]') !== null) return;
    drag.current = { x: event.clientX, y: event.clientY, pan: transform.pan };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start === null) return;
    setPan({ x: start.pan.x + event.clientX - start.x, y: start.pan.y + event.clientY - start.y });
  };
  const endDrag = () => {
    drag.current = null;
  };

  const zoomBy = (delta: number) => setZoom((value) => clamp(Math.round((value + delta) * 100) / 100, MIN_ZOOM, MAX_ZOOM));
  const fit = () => {
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
  };

  const enemyById = new Map(model.enemies.map((enemy) => [enemy.workId, enemy]));
  const lines = model.specters.flatMap((specter) =>
    specter.engagedWorkIds.flatMap((workId) => {
      const from = placement.specters.get(specter.bindingId);
      const to = placement.enemies.get(workId);
      return from !== undefined && to !== undefined && enemyById.has(workId) ? [{ key: `${specter.bindingId}:${workId}`, from, to }] : [];
    }),
  );

  const sceneStyle: CSSProperties & Record<string, string> = {};
  if (mapArt.status === 'ready') sceneStyle['--sa-map'] = cssUrl(mapArt.art.url);
  if (patchling.status === 'ready') sceneStyle['--sa-sprite-patchling'] = cssUrl(patchling.art.url);
  if (patchbrute.status === 'ready') sceneStyle['--sa-sprite-patchbrute'] = cssUrl(patchbrute.art.url);
  const stageStyle: CSSProperties = {
    left: transform.offset.x + transform.pan.x,
    top: transform.offset.y + transform.pan.y,
    width: transform.displayed.width,
    height: transform.displayed.height,
  };

  return (
    <section className={`sa-arena-scene ${motion.animate ? 'sa-is-animated' : 'sa-is-static'}`} aria-label="Arena scene" style={sceneStyle}>
      <div className="sa-arena-hud" role="toolbar" aria-label={HUD.label}>
        <Button onClick={fit}>{HUD.fit}</Button>
        <Button onClick={() => setPan({ x: 0, y: 0 })}>{HUD.reset}</Button>
        <Button onClick={() => zoomBy(-ZOOM_STEP)} disabled={transform.zoom <= MIN_ZOOM} aria-label={HUD.zoomOut}>
          −
        </Button>
        <output className="sa-arena-zoom" aria-live="polite" aria-label={HUD.zoom}>
          {`${transform.zoom.toFixed(2)}×`}
        </output>
        <Button onClick={() => zoomBy(ZOOM_STEP)} disabled={transform.zoom >= MAX_ZOOM} aria-label={HUD.zoomIn}>
          +
        </Button>
        <Button aria-pressed={motion.paused} onClick={motion.togglePause}>
          {motion.paused ? HUD.resume : HUD.pause}
        </Button>
      </div>
      <div
        ref={viewportRef}
        className="sa-arena-viewport"
        role="group"
        aria-label={ARENA.mapLabel}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        <div className="sa-arena-stage" style={stageStyle}>
          <span className={`sa-arena-map${mapArt.status === 'ready' ? ' sa-has-art' : ''}`} data-map={mapArt.status} aria-hidden="true" />
          <svg className="sa-arena-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {lines.map((line) => (
              <line
                key={line.key}
                className="sa-arena-engage"
                data-engage={line.key}
                x1={line.from.x * 100}
                y1={line.from.y * 100}
                x2={line.to.x * 100}
                y2={line.to.y * 100}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {model.specters.map((specter) => (
            <SpecterToken
              key={specter.bindingId}
              specter={specter}
              record={specters.get(specter.bindingId)}
              position={placement.specters.get(specter.bindingId) ?? { x: 0.5, y: 0.5 }}
              selected={isSelected(selection, 'specter', specter.bindingId)}
              roving={activeId === specter.bindingId}
              onSelect={() => onSelect({ kind: 'specter', bindingId: specter.bindingId })}
              register={register(specter.bindingId)}
            />
          ))}
          {model.enemies.map((enemy) => (
            <EnemyToken
              key={enemy.workId}
              enemy={enemy}
              position={placement.enemies.get(enemy.workId) ?? { x: 0.5, y: 0.5 }}
              selected={isSelected(selection, 'work', enemy.workId)}
              roving={activeId === enemy.workId}
              animate={motion.animate && (!enemy.defeated || celebrating.has(enemy.workId))}
              celebrating={celebrating.has(enemy.workId)}
              spriteReady={(enemy.size === 'encounter' ? patchbrute : patchling).status === 'ready'}
              facing={engagementFacing(enemy, placement)}
              onSelect={() => onSelect({ kind: 'work', workId: enemy.workId })}
              register={register(enemy.workId)}
            />
          ))}
        </div>
        {mapArt.status === 'failed' && <p className="sa-arena-plate">{ARENA.mapPlate}</p>}
        <PresentationCueLayer cues={cues} onComplete={onCueComplete} />
      </div>
      <ArenaMinimap placement={placement} view={view} open={minimapOpen} onToggle={() => setMinimapOpen((open) => !open)} />
    </section>
  );
}
