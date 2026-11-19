import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { RosterItemV1, SpecterV2 } from '../contracts/types';
import { nameOf } from '../observatory/model';
import { targetIndex } from '../observatory/RosterList';
import { EmptyState, ErrorState, Panel } from '../observatory/ui';
import type { XpState } from '../work/useXp';
import { HeroThumb } from './HeroThumb';
import { SpecterDetail } from './SpecterDetail';
import { SpecterPortrait } from './SpecterPortrait';
import { SpecterProgression } from './SpecterProgression';
import { BOT_GONE, LIST, LOADING_SPECTERS, NO_SPECTER, SELECT_A_BOT, UNSUPPORTED_BACKEND, errorWords } from './copy';
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

export function SpectersView({ bots, complete, specters, xp }: Props) {
  const progressionOf = (bindingId: string, compact: boolean) => (
    <SpecterProgression compact={compact} summary={xp.byBinding.get(bindingId)} unavailable={xp.status === 'ready' ? undefined : xp.status === 'loading' ? 'loading' : 'failed'} />
  );
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rovingId, setRovingId] = useState<string | null>(null);
  const has = (id: string | null) => id !== null && bots.some((bot) => bot.bindingId === id);
  const activeId = has(rovingId) ? rovingId : has(selectedId) ? selectedId : (bots[0]?.bindingId ?? null);
  const selected = bots.find((bot) => bot.bindingId === selectedId);
  const departed = selectedId !== null && selected === undefined && complete;

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const from = bots.findIndex((bot) => bot.bindingId === activeId);
    const to = targetIndex(event.key, Math.max(0, from), bots.length - 1);
    const target = to === null ? undefined : bots[to];
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

  return (
    <div className="sa-specters">
      <Panel label={LIST.botsLabel}>
        <ul className="sa-specter-list" aria-label={LIST.botsLabel} onKeyDown={onKeyDown}>
          {bots.map((bot) => {
            const specter = specters.byBinding.get(bot.bindingId);
            return (
              <li key={bot.bindingId}>
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
