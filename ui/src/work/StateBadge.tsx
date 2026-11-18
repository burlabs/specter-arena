import { stateView } from './model';

/** The state is always spelled out; the dot and tone are decoration. */
export function StateBadge({ state }: { state: string }) {
  const view = stateView(state);
  return (
    <span className={`sa-work-badge sa-work-badge--${view.tone}`}>
      <span className="sa-status__dot" aria-hidden="true" />
      {view.label}
    </span>
  );
}
