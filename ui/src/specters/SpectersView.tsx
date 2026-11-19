import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { RosterItemV1 } from '../contracts/types';
import { nameOf } from '../observatory/model';
import { targetIndex } from '../observatory/RosterList';
import { EmptyState, ErrorState, Panel } from '../observatory/ui';
import { SpecterDetail } from './SpecterDetail';
import { SpecterPortrait } from './SpecterPortrait';
import { BOT_GONE, LIST, LOADING_SPECTERS, NO_SPECTER, SELECT_A_BOT, UNSUPPORTED_BACKEND, errorWords } from './copy';
import type { SpectersState } from './useSpecters';

interface Props {
  bots: readonly RosterItemV1[];
  complete: boolean;
  specters: SpectersState;
}

export function SpectersView({ bots, complete, specters }: Props) {
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
                  {specter !== undefined && <SpecterPortrait specter={specter} size="sm" decorative />}
                  <span className="sa-specter-row__names">
                    <strong>{nameOf(bot)}</strong>
                    <span>{specter === undefined ? NO_SPECTER : specter.displayName}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel label={LIST.detailLabel}>
        {selected !== undefined ? (
          <SpecterDetail key={selected.bindingId} bot={selected} specter={specters.byBinding.get(selected.bindingId) ?? null} specters={specters} />
        ) : departed ? (
          <p role="status">{BOT_GONE}</p>
        ) : (
          <p>{SELECT_A_BOT}</p>
        )}
      </Panel>
    </div>
  );
}
