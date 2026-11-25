import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { RosterItemV1 } from '../contracts/types';
import { ConditionBadge } from './ConditionBadge';
import { Initials } from './Initials';
import { NO_SPECTER, ROSTER, SPECTER_ROW_PREFIX } from '../specters/copy';
import { SpecterPortrait } from '../specters/SpecterPortrait';
import { botCondition, nameOf, workerChips } from './model';
import type { ArenaSpecter } from '../arena/specterShape';

interface Props {
  items: readonly RosterItemV1[];
  selectedId: string | null;
  watched: ReadonlySet<string>;
  watchListFull: boolean;
  specters?: ReadonlyMap<string, ArenaSpecter>;
  /** Bindings known to hold no hero (`unassignedBindingIds`). Their row says so and offers Assign. */
  unassigned?: ReadonlySet<string>;
  onAssign?: (bindingId: string) => void;
  onSelect: (bindingId: string) => void;
  onToggleWatch: (bindingId: string) => void;
}

export function targetIndex(key: string, index: number, last: number): number | null {
  if (key === 'ArrowDown') return Math.min(last, index + 1);
  if (key === 'ArrowUp') return Math.max(0, index - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  return null;
}

export function RosterList({ items, selectedId, watched, watchListFull, specters, unassigned, onAssign, onSelect, onToggleWatch }: Props) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [rovingId, setRovingId] = useState<string | null>(null);
  const has = (id: string | null) => id !== null && items.some((item) => item.bindingId === id);
  const activeId = has(rovingId) ? rovingId : has(selectedId) ? selectedId : (items[0]?.bindingId ?? null);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const from = items.findIndex((item) => item.bindingId === activeId);
    const to = targetIndex(event.key, Math.max(0, from), items.length - 1);
    const target = to === null ? undefined : items[to];
    if (target === undefined) return;
    event.preventDefault();
    setRovingId(target.bindingId);
    buttons.current.get(target.bindingId)?.focus();
  };

  return (
    <ul className="sa-roster" aria-label="Bots" onKeyDown={onKeyDown}>
      {items.map((item) => {
        const isActive = item.bindingId === activeId;
        const isWatched = watched.has(item.bindingId);
        const specter = specters?.get(item.bindingId);
        const isUnassigned = unassigned?.has(item.bindingId) === true;
        return (
          <li key={item.bindingId} className="sa-row">
            <button
              type="button"
              className="sa-row__select"
              data-binding-id={item.bindingId}
              ref={(element) => {
                if (element) buttons.current.set(item.bindingId, element);
                else buttons.current.delete(item.bindingId);
              }}
              tabIndex={isActive ? 0 : -1}
              aria-current={item.bindingId === selectedId ? 'true' : undefined}
              onFocus={() => setRovingId(item.bindingId)}
              onClick={() => onSelect(item.bindingId)}
            >
              {specter !== undefined && <SpecterPortrait specter={specter} size="sm" decorative active={item.condition.state === 'working'} />}
              <Initials item={item} />
              <span className="sa-row__copy">
                <strong>{nameOf(item)}</strong>
                <ConditionBadge view={botCondition(item.condition)} />
                <span className="sa-chips">
                  {workerChips(item.workers).map((chip) => (
                    <span key={chip.key} className={`sa-chip sa-chip--${chip.key}`}>
                      {chip.text}
                    </span>
                  ))}
                </span>
                {specter !== undefined && (
                  <span className="sa-row__specter">
                    {SPECTER_ROW_PREFIX}
                    {specter.displayName}
                  </span>
                )}
                {specter === undefined && isUnassigned && <span className="sa-row__specter sa-row__specter--none">{NO_SPECTER}</span>}
              </span>
            </button>
            <button
              type="button"
              className="sa-row__watch"
              tabIndex={isActive ? 0 : -1}
              aria-pressed={isWatched}
              aria-label={`Watch ${nameOf(item)}`}
              disabled={!isWatched && watchListFull}
              onClick={() => onToggleWatch(item.bindingId)}
            >
              {isWatched ? 'Watching' : 'Watch'}
            </button>
            {specter === undefined && isUnassigned && onAssign !== undefined && (
              <button type="button" className="sa-row__assign" tabIndex={isActive ? 0 : -1} aria-label={`Assign a Specter to ${nameOf(item)}`} onClick={() => onAssign(item.bindingId)}>
                {ROSTER.assign}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
