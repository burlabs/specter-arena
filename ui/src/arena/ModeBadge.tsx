import type { SourceMode } from '../host';
import { MODE } from './copy';

/** Says where the data comes from. A fixture arena is never unlabelled and never reads as live Crew activity. */
export function ModeBadge({ mode }: { mode: SourceMode }) {
  return (
    <span role="status" className={`sa-mode sa-mode--${mode.toLowerCase()}`} data-mode={mode}>
      {MODE[mode]}
    </span>
  );
}
