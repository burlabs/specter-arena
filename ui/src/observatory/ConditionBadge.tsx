import type { ConditionView } from './model';

export function ConditionBadge({ view }: { view: ConditionView }) {
  return (
    <span className={`sa-status sa-status--${view.tone}`}>
      <span className="sa-status__dot" aria-hidden="true" />
      {view.label}
    </span>
  );
}
