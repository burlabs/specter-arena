import type { RosterItemV1 } from '../contracts/types';
import { initialsOf } from './model';

export function Initials({ item }: { item: RosterItemV1 }) {
  return (
    <span className="sa-initials" aria-hidden="true">
      {initialsOf(item)}
    </span>
  );
}
