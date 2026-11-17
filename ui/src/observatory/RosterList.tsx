import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { RosterItemV1 } from '../contracts/types';
import { ConditionBadge } from './ConditionBadge';
import { Initials } from './Initials';
import { botCondition, nameOf, workerChips } from './model';

interface Props {
  items: readonly RosterItemV1[];
  selectedId: string | null;
  watched: ReadonlySet<string>;
  watchListFull: boolean;
  onSelect: (bindingId: string) => void;
  onToggleWatch: (bindingId: string) => void;
}

function targetIndex(key: string, index: number, last: number): number | null {
  if (key === 'ArrowDown') return Math.min(last, index + 1);
  if (key === 'ArrowUp') return Math.max(0, index - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  return null;
}

export function RosterList({ items, selectedId, watched, watchListFull, onSelect, onToggleWatch }: Props) {
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
        return (
          <li key={item.bindingId} className="sa-row">
            <button
              type="button"
              className="sa-row__select"
              ref={(element) => {
                if (element) buttons.current.set(item.bindingId, element);
                else buttons.current.delete(item.bindingId);
              }}
              tabIndex={isActive ? 0 : -1}
              aria-current={item.bindingId === selectedId ? 'true' : undefined}
              onFocus={() => setRovingId(item.bindingId)}
              onClick={() => onSelect(item.bindingId)}
            >
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
          </li>
        );
      })}
    </ul>
  );
}
