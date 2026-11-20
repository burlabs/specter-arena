import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { RosterItemV1, SpecterV2 } from '../contracts/types';
import { nameOf } from '../observatory/model';
import { targetIndex } from '../observatory/RosterList';
import { Button, EmptyState, ErrorState, Panel } from '../observatory/ui';
import type { XpState } from '../work/useXp';
import { CollectionToolbar } from './CollectionToolbar';
import { HeroCard } from './HeroCard';
import { HeroThumb } from './HeroThumb';
import { SpecterDetail } from './SpecterDetail';
import { SpecterPortrait } from './SpecterPortrait';
import { SpecterProgression } from './SpecterProgression';
import { DEFAULT_VIEW, buildCollection } from './collection';
import type { ViewState } from './collection';
import { BOT_GONE, COLLECTION, LIST, LOADING_SPECTERS, NO_SPECTER, SELECT_A_BOT, UNSUPPORTED_BACKEND, errorWords } from './copy';
import { useHeroes } from './useHeroes';
import type { HeroesState } from './useHeroes';
import type { SpectersState } from './useSpecters';

interface Props {
  bots: readonly RosterItemV1[];
  complete: boolean;
  specters: SpectersState;
  xp: XpState;
}

const CARD_ART_SIZE = 96;

/** The 96 px hero thumbnail, or the chosen avatar once the user has picked one. */
function CardArt({ specter }: { specter: SpecterV2 }) {
  return specter.avatarChosen ? (
    <SpecterPortrait specter={specter} size="md" decorative />
  ) : (
    <span className="sa-portrait sa-portrait--md" aria-hidden="true">
      <HeroThumb heroId={specter.heroId} name={specter.displayName} size={CARD_ART_SIZE} />
    </span>
  );
}

/** One line in place of the hero cards when the hero list is not there; the bot cards never wait for it. */
function HeroesNote({ heroes }: { heroes: HeroesState }) {
  if (heroes.status === 'ready') return null;
  if (heroes.status === 'loading') return <p className="sa-help">{COLLECTION.heroesLoading}</p>;
  return (
    <p className="sa-collection-note" role="alert">
      <span>{heroes.failure === 'unsupported' ? COLLECTION.heroesUnsupported : COLLECTION.heroesFailed}</span>
      {heroes.failure !== 'unsupported' && (
        <Button variant="ghost" onClick={heroes.refresh}>
          {COLLECTION.retry}
        </Button>
      )}
    </p>
  );
}

export function SpectersView({ bots, complete, specters, xp }: Props) {
  const progressionOf = (bindingId: string, compact: boolean) => (
    <SpecterProgression compact={compact} summary={xp.byBinding.get(bindingId)} unavailable={xp.status === 'ready' ? undefined : xp.status === 'loading' ? 'loading' : 'failed'} />
  );
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rovingId, setRovingId] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
  const heroes = useHeroes();
  const xpReady = xp.status === 'ready';
  const collection = useMemo(
    () => buildCollection({ bots, specters: specters.byBinding, heroes: heroes.items, xp: xp.byBinding, xpReady }, view),
    [bots, specters.byBinding, heroes.items, xp.byBinding, xpReady, view],
  );
  const shownBots = collection.cards.flatMap((card) => (card.kind === 'bot' ? [card.bot] : []));
  // The roving stop and the arrow keys cover the cards on screen; the detail panel keeps following the selected bot.
  const has = (id: string | null) => id !== null && shownBots.some((bot) => bot.bindingId === id);
  const activeId = has(rovingId) ? rovingId : has(selectedId) ? selectedId : (shownBots[0]?.bindingId ?? null);
  const selected = bots.find((bot) => bot.bindingId === selectedId);
  const departed = selectedId !== null && selected === undefined && complete;
  const clearView = () => {
    setView(DEFAULT_VIEW);
    searchRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const from = shownBots.findIndex((bot) => bot.bindingId === activeId);
    const to = targetIndex(event.key, Math.max(0, from), shownBots.length - 1);
    const target = to === null ? undefined : shownBots[to];
    if (target === undefined) return;
    event.preventDefault();
    setRovingId(target.bindingId);
    buttons.current.get(target.bindingId)?.focus();
  };

  if (specters.status === 'loading') {
    return (
      <Panel label="Specters">
        <p role="status">{LOADING_SPECTERS}</p>
      </Panel>
    );
  }
  if (specters.status === 'failed') {
    return (
      <Panel label="Specters">
        {specters.failure === 'unsupported' ? (
          <EmptyState title="Specters are not supported here" body={UNSUPPORTED_BACKEND} />
        ) : (
          <ErrorState title="Could not load Specters" body={errorWords(specters.failure === 'offline' ? 'offline' : 'store_unavailable')} onRetry={specters.refresh} />
        )}
      </Panel>
    );
  }
  if (bots.length === 0) {
    return (
      <Panel label="Specters">
        <EmptyState title={LIST.noBots} body={LIST.noBotsBody} />
      </Panel>
    );
  }

  const showHeroNote = view.filter === 'all' || view.filter === 'unassigned';
  const everyHeroHeld = view.filter === 'unassigned' && view.query.trim() === '' && heroes.status === 'ready' && collection.unassignedTotal === 0;

  return (
    <div className="sa-specters">
      <Panel label={LIST.collectionLabel}>
        <CollectionToolbar view={view} onChange={setView} searchRef={searchRef} />
        <p className="sa-collection-count" aria-live="polite">
          {COLLECTION.count(collection.cards.length, collection.total)}
          {collection.sortHeld && <span className="sa-collection-held">{` ${COLLECTION.sortHeld}`}</span>}
        </p>
        {showHeroNote && <HeroesNote heroes={heroes} />}
        {collection.cards.length === 0 ? (
          everyHeroHeld ? (
            <EmptyState title={COLLECTION.everyHeroTitle} body={COLLECTION.everyHeroBody} />
          ) : view.filter === 'unassigned' && heroes.status !== 'ready' ? null : (
            <EmptyState
              title={COLLECTION.emptyTitle}
              body={COLLECTION.emptyBody}
              action={
                <Button variant="secondary" onClick={clearView}>
                  {COLLECTION.clear}
                </Button>
              }
            />
          )
        ) : (
          <ul className="sa-specter-list" aria-label={LIST.collectionLabel} onKeyDown={onKeyDown}>
            {collection.cards.map((card) => {
              if (card.kind === 'hero') return <HeroCard key={card.key} hero={card.hero} />;
              const { bot, specter } = card;
              return (
                <li key={card.key}>
                  <button
                    type="button"
                    className="sa-specter-row"
                    ref={(element) => {
                      if (element) buttons.current.set(bot.bindingId, element);
                      else buttons.current.delete(bot.bindingId);
                    }}
                    tabIndex={bot.bindingId === activeId ? 0 : -1}
                    aria-current={bot.bindingId === selectedId ? 'true' : undefined}
                    onFocus={() => setRovingId(bot.bindingId)}
                    onClick={() => setSelectedId(bot.bindingId)}
                  >
                    {specter !== undefined && <CardArt specter={specter} />}
                    <span className="sa-specter-row__names">
                      <strong>{nameOf(bot)}</strong>
                      <span>{specter === undefined ? NO_SPECTER : specter.displayName}</span>
                      {specter !== undefined && <span className="sa-specter-row__epithet">{specter.epithet}</span>}
                    </span>
                    {progressionOf(bot.bindingId, true)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel label={LIST.detailLabel}>
        {selected !== undefined ? (
          <SpecterDetail key={selected.bindingId} bot={selected} specter={specters.byBinding.get(selected.bindingId) ?? null} specters={specters} progression={progressionOf(selected.bindingId, false)} />
        ) : departed ? (
          <p role="status">{BOT_GONE}</p>
        ) : (
          <p>{SELECT_A_BOT}</p>
        )}
      </Panel>
    </div>
  );
}
