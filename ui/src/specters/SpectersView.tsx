import { useEffect, useId, useLayoutEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { RosterItemV1 } from '../contracts/types';
import { AnimatedMinion } from '../arena/AnimatedMinion';
import { AnimatedSpecter } from '../arena/AnimatedSpecter';
import type { HeroAnimation } from '../arena/AnimatedSpecter';
import { PRACTICE_HERO, PRACTICE_TARGET, usePracticeExchange } from '../arena/usePracticeExchange';
import { useSceneAsset } from '../arena/useSceneAsset';
import { nameOf } from '../observatory/model';
import { Button, EmptyState, ErrorState, Panel } from '../observatory/ui';
import { avatarPackUrl } from './avatarPack';
import { HeroChoice } from './HeroChoice';
import { LOADING_SPECTERS, SHOWCASE, UNSUPPORTED_BACKEND, errorWords } from './copy';
import { tokenInitials } from './model';
import { STAGE_DEFAULT_WIDTH, stageLayout } from './showcaseStage';
import type { HeroesState } from './useHeroes';
import { useMotionAllowed } from './useMotionAllowed';
import type { SpectersState } from './useSpecters';

interface Props {
  bots: readonly RosterItemV1[];
  specters: SpectersState;
  heroes: HeroesState;
  /** Roster bots with no hero yet; the button that reopens the walkthrough shows only when this is above zero. */
  pendingCount: number;
  onAssign: () => void;
  /** Opens the Roster tab with this bot selected. */
  onShowInRoster: (bindingId: string) => void;
}

/** The hero showcase: the 11 heroes, the chosen one large with its idle loop, and the bots that hold it. Everything here is a preview; it never reads a bot's work. */
export function SpectersView({ bots, specters, heroes, pendingCount, onAssign, onShowInRoster }: Props) {
  const motion = useMotionAllowed();
  const noteId = useId();
  const holdersId = useId();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [holdersOpen, setHoldersOpen] = useState(false);

  const items = heroes.items;
  // The hero the first bot in roster order holds, else the first hero (Q8).
  const firstHeld = bots.map((bot) => specters.byBinding.get(bot.bindingId)?.heroId).find((id) => id !== undefined);
  const hero = items?.find((entry) => entry.heroId === (pickedId ?? firstHeld)) ?? items?.[0];
  const heroId = hero?.heroId;

  const practice = usePracticeExchange(heroId, 'patchling', motion);
  const patchling = useSceneAsset('minion-patchling-sprite');
  // The stage mounts only once a hero is known, so it is observed through a callback ref, not a ref read on first mount.
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null);
  const [stageWidth, setStageWidth] = useState(STAGE_DEFAULT_WIDTH);
  useLayoutEffect(() => {
    if (stageElement === null) return;
    // Measured before the first paint, so the hero and the target never show at the default width.
    const width = stageElement.getBoundingClientRect().width;
    if (width > 0) setStageWidth(width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined && width > 0) setStageWidth(width);
    });
    observer.observe(stageElement);
    return () => observer.disconnect();
  }, [stageElement]);
  const layout = stageLayout(stageWidth);

  useEffect(() => {
    setHoldersOpen(false);
  }, [heroId]);

  if (specters.status === 'loading') {
    return (
      <Panel label={SHOWCASE.label}>
        <p role="status">{LOADING_SPECTERS}</p>
      </Panel>
    );
  }
  if (specters.status === 'failed') {
    return (
      <Panel label={SHOWCASE.label}>
        {specters.failure === 'unsupported' ? (
          <EmptyState title="Specters are not supported here" body={UNSUPPORTED_BACKEND} />
        ) : (
          <ErrorState title="Could not load Specters" body={errorWords(specters.failure === 'offline' ? 'offline' : 'store_unavailable')} onRetry={specters.refresh} />
        )}
      </Panel>
    );
  }

  const holders = bots.flatMap((bot) => {
    const specter = specters.byBinding.get(bot.bindingId);
    return specter !== undefined && specter.heroId === heroId ? [{ bot, specter }] : [];
  });
  const playing = practice.playing;
  const strike = practice.snapshot.heroes.get(PRACTICE_HERO);
  const heroAnimation: HeroAnimation = strike !== undefined ? strike.kind : practice.snapshot.flinches.has(PRACTICE_HERO) ? 'flinch' : 'idle';
  const hit = practice.snapshot.enemies.get(PRACTICE_TARGET);
  const counter = practice.snapshot.counters.get(PRACTICE_TARGET);
  const stageStyle = { height: `${layout.heightPx.toFixed(1)}px`, '--sa-sprite-patchling': patchling.status === 'ready' ? `url("${patchling.art.url}")` : undefined } as CSSProperties;

  return (
    <Panel label={SHOWCASE.label}>
      <div className="sa-showcase">
        <header className="sa-showcase__head">
          <div>
            <h2>{SHOWCASE.heading}</h2>
            <p className="sa-help">{SHOWCASE.intro}</p>
          </div>
          {pendingCount > 0 && <Button onClick={onAssign}>{SHOWCASE.assignButton(pendingCount)}</Button>}
        </header>

        {items === null ? (
          heroes.status === 'loading' ? (
            <p className="sa-help" role="status">
              {SHOWCASE.heroesLoading}
            </p>
          ) : (
            <p className="sa-collection-note" role="alert">
              <span>{heroes.failure === 'unsupported' ? SHOWCASE.heroesUnsupported : SHOWCASE.heroesFailed}</span>
              {heroes.failure !== 'unsupported' && (
                <Button variant="ghost" onClick={heroes.refresh}>
                  {SHOWCASE.retry}
                </Button>
              )}
            </p>
          )
        ) : (
          <HeroChoice name={`${holdersId}-heroes`} label="Heroes" heroes={items} value={heroId ?? null} onChange={setPickedId} size={96} />
        )}

        {hero !== undefined && (
          <div className="sa-showcase__main">
            <div ref={setStageElement} className="sa-showcase__stage" role="img" aria-label={SHOWCASE.stageLabel(hero.name)} style={stageStyle}>
              <span className="sa-showcase__spot" style={{ left: layout.hero.left, top: layout.hero.top }}>
                <span className="sa-showcase__zoom" style={{ zoom: layout.zoom }}>
                  <AnimatedSpecter heroId={hero.heroId} animate={motion} initials={tokenInitials(hero.name)} animation={heroAnimation} />
                </span>
              </span>
              <span className="sa-showcase__spot sa-showcase__target" style={{ left: layout.target.left, top: layout.target.top }}>
                <span className="sa-showcase__zoom sa-showcase__zoom--target" style={{ zoom: layout.zoom }}>
                  <AnimatedMinion
                    minionType="patchling"
                    animation={hit !== undefined ? 'hit' : counter !== undefined ? 'attack' : 'idle'}
                    animate={motion}
                    spriteReady={patchling.status === 'ready'}
                    facing="left"
                    requestId={hit?.exchangeId ?? counter?.exchangeId ?? 0}
                    recoil={1}
                    strong={hit?.strong ?? false}
                    lunge={-1}
                  />
                </span>
                <span className="sa-showcase__caption">{SHOWCASE.practiceTarget}</span>
              </span>
            </div>
            <div className="sa-showcase__copy">
              <h3>{hero.name}</h3>
              <p className="sa-showcase__epithet">{hero.epithet}</p>
              <p>{hero.personality}</p>
              <div className="sa-actions">
                <Button aria-disabled={playing} disabled={!motion} aria-describedby={motion ? undefined : noteId} onClick={() => practice.play('attack')}>
                  {SHOWCASE.attack}
                </Button>
                <Button aria-disabled={playing} disabled={!motion} aria-describedby={motion ? undefined : noteId} onClick={() => practice.play('cast')}>
                  {SHOWCASE.cast}
                </Button>
              </div>
              {!motion && (
                <p id={noteId} className="sa-help">
                  {SHOWCASE.motionOff}
                </p>
              )}
              <p className="sa-help">{SHOWCASE.previewNote}</p>

              <div className="sa-showcase__pack">
                <p>{SHOWCASE.avatarPackLine}</p>
                <a href={avatarPackUrl(hero.heroId)} target="_blank" rel="noopener noreferrer">
                  {SHOWCASE.avatarPackLink(hero.name)}
                </a>
                <p className="sa-help">
                  {SHOWCASE.avatarPackCopy} <code>{avatarPackUrl(hero.heroId)}</code>
                </p>
              </div>

              <Button aria-expanded={holdersOpen} aria-controls={holdersId} onClick={() => setHoldersOpen((open) => !open)}>
                {SHOWCASE.holders(holders.length)}
              </Button>
              <div id={holdersId} className="sa-showcase__holders" hidden={!holdersOpen}>
                {holders.length === 0 ? (
                  <p className="sa-help">{SHOWCASE.noHolders(hero.name)}</p>
                ) : (
                  <ul>
                    {holders.map(({ bot, specter }) => (
                      <li key={bot.bindingId}>
                        <button type="button" className="sa-showcase__holder" onClick={() => onShowInRoster(bot.bindingId)}>
                          <strong>{nameOf(bot)}</strong> <span>{specter.displayName}</span>{' '}
                          <span className="sa-visually-hidden">{SHOWCASE.showInRoster}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
