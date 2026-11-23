import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { HeroId } from '../contracts/types';
import { tokenInitials } from '../specters/model';
import { AnimatedMinion } from './AnimatedMinion';
import { AnimatedSpecter } from './AnimatedSpecter';
import type { HeroAnimation } from './AnimatedSpecter';
import { ArenaMinimap } from './ArenaMinimap';
import { PresentationCueLayer } from './PresentationCueLayer';
import { StrikeLayer, strikeShotsOf } from './StrikeLayer';
import type { PresentationCue } from './PresentationCueLayer';
import { MarkerAssistanceSvg, MarkerAwaitingApprovalSvg, MarkerBlockedSvg, MarkerCoverageUnknownSvg, MarkerEvidenceSvg, MarkerOutcomeAcceptedSvg } from './SceneSvgs';
import { ARENA, HUD } from './copy';
import { CONDITION_LABEL, collectorWords } from '../observatory/copy';
import { enemyEffect, specterStance } from './effectMap';
import { EMPTY_SNAPSHOT } from './exchangePlanner';
import type { ExchangeSnapshot } from './exchangePlanner';
import { effectAngle } from './heroCombat';
import type { MarkerKind } from './effectMap';
import { MAX_ZOOM, MIN_ZOOM, clamp, createSceneTransform, visibleNormalizedRect } from './geometry';
import { ARENA_INTRINSIC } from './mapLayout';
import { MINION_SCALE, heroSizePx, minionBasePx } from './minionSize';
import { placeHeroes } from './heroPlacement';
import { assignFans, assignSlots, placeScene, slotIdsOf } from './sceneLayout';
import type { Placement, Point } from './sceneLayout';
import type { SceneEnemy, SceneModel, SceneSpecter } from './sceneModel';
import { isSelected } from './selection';
import type { ArenaSelection } from './selection';
import type { ArenaMotion } from './useArenaMotion';
import { useElementSize } from './useElementSize';
import { useSceneAsset } from './useSceneAsset';
import { Button } from '../observatory/ui';

const ZOOM_STEP = 0.25;
/** The seed a scene uses when the page gives none (tests, the harness): one fixed, repeatable layout. */
export const DEFAULT_VISIT_SEED = 0x5eed;

interface Props {
  model: SceneModel;
  selection: ArenaSelection | null;
  onSelect: (selection: ArenaSelection) => void;
  motion: ArenaMotion;
  /** Celebrations to play, from `useArenaScene`. */
  cues: readonly PresentationCue[];
  /** Work ids whose defeat animation is playing right now. */
  celebrating: ReadonlySet<string>;
  onCueComplete: (id: string) => void;
  /** Hero attacks and minion recoils to draw right now, from `useArenaExchanges`. Empty when nothing is playing. */
  exchanges?: ExchangeSnapshot;
  /** The collector is paused: nothing plays and the plate says so, so the field never looks live. */
  collectorPaused?: boolean;
  /** One number per page visit; heroes are placed from it. */
  visitSeed?: number;
}

function MarkerIcon({ kind }: { kind: MarkerKind }) {
  const common = { title: '', decorative: true, className: 'sa-token__marker' } as const;
  if (kind === 'blocked') return <MarkerBlockedSvg {...common} />;
  if (kind === 'awaiting-approval') return <MarkerAwaitingApprovalSvg {...common} />;
  if (kind === 'evidence') return <MarkerEvidenceSvg {...common} />;
  if (kind === 'outcome-accepted') return <MarkerOutcomeAcceptedSvg {...common} />;
  if (kind === 'assistance') return <MarkerAssistanceSvg {...common} />;
  return <MarkerCoverageUnknownSvg {...common} />;
}

/** A bot with a hero. A bot with no Specter yet is not drawn: the rail lists it instead. */
type DrawnSpecter = SceneSpecter & { heroId: HeroId; specterName: string };
const isDrawn = (specter: SceneSpecter): specter is DrawnSpecter => specter.heroId !== null && specter.specterName !== null;

function specterName(specter: DrawnSpecter): string {
  // The printed name and the "×N attempts" badge come first and in the printed order, so the accessible name contains the visible text.
  const printed = specter.openAttemptIds.length > 1 ? `${specter.specterName} ${ARENA.attemptsBadge(specter.openAttemptIds.length)}` : specter.specterName;
  return `${printed} for ${specter.displayName}`;
}

function specterLabel(specter: DrawnSpecter, conditionLabel: string): string {
  const parts = [specterName(specter), conditionLabel, specter.xpReading === 'ready' ? `Level ${specter.level}` : null];
  if (specter.openAttemptIds.length > 0) parts.push(ARENA.linked(specter.openAttemptIds.length));
  return parts.filter((part): part is string => part !== null).join(', ');
}

function enemyLabel(enemy: SceneEnemy): string {
  const effect = enemyEffect(enemy);
  const parts = [enemy.title, effect.stateText, effect.progressText];
  if (enemy.defeated && enemy.committedXp !== null) parts.push(ARENA.xpAward(enemy.committedXp));
  parts.push(enemy.size === 'encounter' ? 'encounter' : 'task');
  return parts.join(', ');
}

interface SpecterTokenProps {
  specter: DrawnSpecter;
  position: { x: number; y: number };
  selected: boolean;
  roving: boolean;
  animate: boolean;
  animation: HeroAnimation;
  angle: number;
  flip: 1 | -1;
  onSelect: () => void;
  register: (element: HTMLButtonElement | null) => void;
}

function SpecterToken({ specter, position, selected, roving, animate, animation, angle, flip, onSelect, register }: SpecterTokenProps) {
  const stance = specterStance(specter);
  const conditionLabel =
    specter.condition === 'waiting' ? CONDITION_LABEL.waiting : stance === 'coverage-unknown' ? ARENA.unknownCondition : stance === 'engaging' ? ARENA.engaging : ARENA.atRest;
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
      <AnimatedSpecter heroId={specter.heroId} animate={animate} animation={animation} angle={angle} flip={flip} initials={tokenInitials(specter.specterName)} />
      <span className="sa-token__label" aria-hidden="true">
        {specter.specterName}
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
      {specter.waitingReason === 'approval-pending' && <MarkerIcon kind="awaiting-approval" />}
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
  /** Set while the enemy recoils from a hero's hit or a milestone. */
  hit: { exchangeId: number; strong: boolean; recoil: -1 | 1 } | null;
  onSelect: () => void;
  register: (element: HTMLButtonElement | null) => void;
}

function EnemyToken({ enemy, position, selected, roving, animate, celebrating, spriteReady, facing, hit, onSelect, register }: EnemyTokenProps) {
  const effect = enemyEffect(enemy);
  const style = { left: `${position.x * 100}%`, top: `${position.y * 100}%`, '--sa-minion-scale': MINION_SCALE[enemy.sizeClass] } as CSSProperties;
  return (
    <button
      type="button"
      ref={register}
      className={`sa-token sa-token--enemy sa-token--${enemy.size} sa-is-${effect.pose}${selected ? ' sa-is-selected' : ''}${enemy.blocked ? ' sa-is-blocked' : ''}`}
      style={style}
      data-sprite="enemy"
      data-size-class={enemy.sizeClass}
      data-scene-node="enemy"
      data-token={enemy.workId}
      aria-pressed={selected}
      aria-label={enemyLabel(enemy)}
      tabIndex={roving ? 0 : -1}
      onClick={onSelect}
    >
      <AnimatedMinion
        minionType={enemy.size === 'encounter' ? 'patchbrute' : 'patchling'}
        animation={celebrating ? 'defeat' : hit !== null && !enemy.defeated ? 'hit' : effect.pose === 'engaged' ? 'engaged' : 'idle'}
        animate={animate}
        spriteReady={spriteReady}
        defeated={enemy.defeated}
        facing={facing}
        requestId={hit?.exchangeId ?? 0}
        recoil={hit?.recoil ?? 1}
        strong={hit?.strong ?? false}
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

/** Chromium drops a custom property above 2 MiB, so a longer URL is never put in one and the map plate shows instead. */
export const MAX_CSS_VAR_URL_CHARS = 2_000_000;
const cssUrl = (url: string): string | null => (url.length > MAX_CSS_VAR_URL_CHARS ? null : `url("${url}")`);

/**
 * The map, the tokens and the camera. Everything here is presentation: camera, pause and animation live in
 * React state and CSS only, and nothing in this file calls the backend except the three read-only art fetches.
 */
export function BattlefieldScene({ model: fullModel, selection, onSelect, motion, cues, celebrating, onCueComplete, exchanges = EMPTY_SNAPSHOT, collectorPaused = false, visitSeed = DEFAULT_VISIT_SEED }: Props) {
  const model = useMemo(() => ({ ...fullModel, specters: fullModel.specters.filter(isDrawn) }), [fullModel]);
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

  const heroMemory = useRef<ReadonlyMap<string, Point>>(new Map());
  const heroBindingIds = useMemo(() => model.specters.map((specter) => specter.bindingId), [model]);
  const heroPoints = useMemo(() => {
    const next = placeHeroes(heroMemory.current, heroBindingIds, visitSeed);
    heroMemory.current = next;
    return next;
  }, [heroBindingIds, visitSeed]);
  const fanMemory = useRef<ReadonlyMap<string, number>>(new Map());
  const fans = useMemo(() => {
    const next = assignFans(fanMemory.current, model, heroPoints);
    fanMemory.current = next;
    return next;
  }, [model, heroPoints]);
  const slotMemory = useRef<ReadonlyMap<string, number>>(new Map());
  const slotIds = useMemo(() => slotIdsOf(model, fans), [model, fans]);
  const slots = useMemo(() => {
    const next = assignSlots(slotMemory.current, slotIds);
    slotMemory.current = next;
    return next;
  }, [slotIds]);
  const placement = useMemo(() => placeScene(model, slots, heroPoints, fans), [model, slots, heroPoints, fans]);
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

  /** Which way the effect layer points, from the placements: toward the enemy, mirrored when it stands to the left. */
  const heroFx = (bindingId: string): { animation: HeroAnimation; angle: number; flip: 1 | -1 } => {
    const view = exchanges.heroes.get(bindingId);
    const from = placement.specters.get(bindingId);
    const to = view === undefined ? undefined : placement.enemies.get(view.workId);
    if (view === undefined || from === undefined || to === undefined) return { animation: 'idle', angle: 0, flip: 1 };
    const dx = (to.x - from.x) * ARENA_INTRINSIC.width;
    const dy = (to.y - from.y) * ARENA_INTRINSIC.height;
    return { animation: view.kind, angle: effectAngle(dx, dy), flip: dx < 0 ? -1 : 1 };
  };
  const enemyHit = (enemy: SceneEnemy): EnemyTokenProps['hit'] => {
    const view = exchanges.enemies.get(enemy.workId);
    if (view === undefined) return null;
    const here = placement.enemies.get(enemy.workId);
    const there = view.bindingId === null ? undefined : placement.specters.get(view.bindingId);
    return { exchangeId: view.exchangeId, strong: view.strong, recoil: here !== undefined && there !== undefined && here.x < there.x ? -1 : 1 };
  };

  const heroIds = new Map(model.specters.map((specter) => [specter.bindingId, specter.heroId]));
  const strikes = strikeShotsOf(exchanges, (id) => heroIds.get(id) ?? null, (id) => placement.specters.get(id), (id) => placement.enemies.get(id), transform.displayed);

  const sceneStyle: CSSProperties & Record<string, string> = {};
  const mapUrl = mapArt.status === 'ready' ? cssUrl(mapArt.art.url) : null;
  const patchlingUrl = patchling.status === 'ready' ? cssUrl(patchling.art.url) : null;
  const patchbruteUrl = patchbrute.status === 'ready' ? cssUrl(patchbrute.art.url) : null;
  if (mapUrl !== null) sceneStyle['--sa-map'] = mapUrl;
  if (patchlingUrl !== null) sceneStyle['--sa-sprite-patchling'] = patchlingUrl;
  if (patchbruteUrl !== null) sceneStyle['--sa-sprite-patchbrute'] = patchbruteUrl;
  const stageStyle = {
    left: transform.offset.x + transform.pan.x,
    top: transform.offset.y + transform.pan.y,
    width: transform.displayed.width,
    height: transform.displayed.height,
    '--sa-minion-base': `${minionBasePx(transform.displayed.width).toFixed(2)}px`,
    '--sa-hero-size': `${heroSizePx(transform.displayed.width, transform.displayed.height).toFixed(2)}px`,
  } as CSSProperties;

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
      <div className="sa-arena-frame">
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
            <span className={`sa-arena-map${mapUrl !== null ? ' sa-has-art' : ''}`} data-map={mapArt.status} aria-hidden="true" />
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
                position={placement.specters.get(specter.bindingId) ?? { x: 0.5, y: 0.5 }}
                selected={isSelected(selection, 'specter', specter.bindingId)}
                roving={activeId === specter.bindingId}
                animate={motion.animate}
                {...heroFx(specter.bindingId)}
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
                hit={enemyHit(enemy)}
                onSelect={() => onSelect({ kind: 'work', workId: enemy.workId })}
                register={register(enemy.workId)}
              />
            ))}
            <StrikeLayer shots={strikes} />
          </div>
          {(mapArt.status === 'failed' || (mapArt.status === 'ready' && mapUrl === null)) && <p className="sa-arena-plate">{ARENA.mapPlate}</p>}
          {collectorPaused && (
            <p className="sa-arena-plate sa-arena-plate--paused" role="status">
              {collectorWords('paused', null)}
            </p>
          )}
          <PresentationCueLayer cues={cues} onComplete={onCueComplete} />
        </div>
      </div>
      <ArenaMinimap placement={placement} view={view} hasMap={mapUrl !== null} open={minimapOpen} onToggle={() => setMinimapOpen((open) => !open)} />
    </section>
  );
}
