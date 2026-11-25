import type { TaskStateV1 } from '../contracts/types';
import { STATE_TONE, STATE_WORDS } from './copy';

/** The close-out state is always spelled out; the dot and tone are decoration. */
export function TaskStateBadge({ state }: { state: TaskStateV1 }) {
  return (
    <span className={`sa-work-badge sa-work-badge--${STATE_TONE[state]}`}>
      <span className="sa-status__dot" aria-hidden="true" />
      {STATE_WORDS[state]}
    </span>
  );
}
