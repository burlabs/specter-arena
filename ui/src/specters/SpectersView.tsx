import { useEffect, useId, useState } from 'react';
import type { RosterItemV1 } from '../contracts/types';
import { AnimatedSpecter } from '../arena/AnimatedSpecter';
import { combatTimingOf } from '../arena/heroCombat';
import { nameOf } from '../observatory/model';
import { Button, EmptyState, ErrorState, Panel } from '../observatory/ui';
import { avatarPackUrl } from './avatarPack';
import { HeroChoice } from './HeroChoice';
import { LOADING_SPECTERS, SHOWCASE, UNSUPPORTED_BACKEND, errorWords } from './copy';
import { tokenInitials } from './model';
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

const SETTLE_MS = 60;

/** The hero showcase: the 11 heroes, the chosen one large with its idle loop, and the bots that hold it. Everything here is a preview; it never reads a bot's work. */
export function SpectersView({ bots, specters, heroes, pendingCount, onAssign, onShowInRoster }: Props) {
  const motion = useMotionAllowed();
  const noteId = useId();
  const holdersId = useId();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<'attack' | 'cast' | null>(null);
  const [holdersOpen, setHoldersOpen] = useState(false);

  const items = heroes.items;
  // The hero the first bot in roster order holds, else the first hero (Q8).
  const firstHeld = bots.map((bot) => specters.byBinding.get(bot.bindingId)?.heroId).find((id) => id !== undefined);
  const hero = items?.find((entry) => entry.heroId === (pickedId ?? firstHeld)) ?? items?.[0];
  const heroId = hero?.heroId;

  useEffect(() => {
    setPlaying(null);
    setHoldersOpen(false);
  }, [heroId]);

  useEffect(() => {
    if (playing === null || heroId === undefined) return;
    const timer = setTimeout(() => setPlaying(null), (combatTimingOf(heroId)?.[playing] ?? 0) + SETTLE_MS);
    return () => clearTimeout(timer);
  }, [playing, heroId]);

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
  const play = (kind: 'attack' | 'cast') => {
    if (playing === null) setPlaying(kind);
  };

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
            <div className="sa-showcase__stage" role="img" aria-label={SHOWCASE.stageLabel(hero.name)}>
              <span className="sa-showcase__zoom">
                <AnimatedSpecter heroId={hero.heroId} animate={motion} initials={tokenInitials(hero.name)} animation={playing ?? 'idle'} />
              </span>
            </div>
            <div className="sa-showcase__copy">
              <h3>{hero.name}</h3>
              <p className="sa-showcase__epithet">{hero.epithet}</p>
              <p>{hero.personality}</p>
              <div className="sa-actions">
                <Button aria-disabled={playing !== null} disabled={!motion} aria-describedby={motion ? undefined : noteId} onClick={() => play('attack')}>
                  {SHOWCASE.attack}
                </Button>
                <Button aria-disabled={playing !== null} disabled={!motion} aria-describedby={motion ? undefined : noteId} onClick={() => play('cast')}>
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
