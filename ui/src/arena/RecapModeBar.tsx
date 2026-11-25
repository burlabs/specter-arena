import { Button } from '../observatory/ui';
import { MODE_LABELS, RECAP } from './recapCopy';
import type { ArenaMode } from './recapCopy';

interface Props {
  value: ArenaMode;
  onChange: (mode: ArenaMode) => void;
  /** The backend answered 404 for a recap: the recap choices stay visible but off, with the reason. */
  unsupported?: boolean;
}

/** `Live | Today | Yesterday | This week`: one choice is pressed at a time, and Live is where the Arena opens. */
export function RecapModeBar({ value, onChange, unsupported = false }: Props) {
  return (
    <div className="sa-arena-modes">
      <div role="group" aria-label={RECAP.modeGroup} className="sa-arena-modes__group">
        {MODE_LABELS.map(({ mode, label }) => (
          <Button key={mode} aria-pressed={value === mode} disabled={unsupported && mode !== 'live'} onClick={() => onChange(mode)}>
            {label}
          </Button>
        ))}
      </div>
      {unsupported && (
        <p className="sa-help" role="status">
          {RECAP.unsupported}
        </p>
      )}
    </div>
  );
}
