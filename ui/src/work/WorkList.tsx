import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { RosterItemV1, WorkItemV1 } from '../contracts/types';
import { targetIndex } from '../observatory/RosterList';
import { LIST, ROW } from './copy';
import { botNameOf } from './model';
import { ProgressLine } from './ProgressLine';
import { StateBadge } from './StateBadge';

interface Props {
  items: readonly WorkItemV1[];
  selectedId: string | null;
  bots: readonly RosterItemV1[];
  onSelect: (workId: string) => void;
}

export const xpChipOf = (item: WorkItemV1): string => {
  if (item.childCount > 0) return ROW.groups;
  if (!item.rewardable) return ROW.noXp;
  const awarded = item.contributors.reduce((sum, contributor) => sum + contributor.xpNet, 0);
  return awarded > 0 ? ROW.awarded(awarded) : ROW.pending(item.bountyXp);
};

/** One tab stop for the whole list: arrows, Home and End move the roving focus, Enter selects. */
export function WorkList({ items, selectedId, bots, onSelect }: Props) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [rovingId, setRovingId] = useState<string | null>(null);
  const has = (id: string | null) => id !== null && items.some((item) => item.workId === id);
  const activeId = has(rovingId) ? rovingId : has(selectedId) ? selectedId : (items[0]?.workId ?? null);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const from = items.findIndex((item) => item.workId === activeId);
    const to = targetIndex(event.key, Math.max(0, from), items.length - 1);
    const target = to === null ? undefined : items[to];
    if (target === undefined) return;
    event.preventDefault();
    setRovingId(target.workId);
    buttons.current.get(target.workId)?.focus();
  };

  return (
    <ul className="sa-work-list" aria-label={LIST.label} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <li key={item.workId}>
          <button
            type="button"
            className="sa-work-row"
            ref={(element) => {
              if (element) buttons.current.set(item.workId, element);
              else buttons.current.delete(item.workId);
            }}
            tabIndex={item.workId === activeId ? 0 : -1}
            aria-current={item.workId === selectedId ? 'true' : undefined}
            onFocus={() => setRovingId(item.workId)}
            onClick={() => onSelect(item.workId)}
          >
            <strong className="sa-work-row__title">{item.title}</strong>
            <StateBadge state={item.state} />
            <ProgressLine progress={item.progress} />
            <span className="sa-chip sa-work-xp-chip">{xpChipOf(item)}</span>
            <span className="sa-help">
              {item.contributors.length === 0 ? ROW.noBots : item.contributors.map((contributor) => botNameOf(bots, contributor.bindingId)).join(', ')}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
