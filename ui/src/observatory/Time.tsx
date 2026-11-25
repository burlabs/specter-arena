import { createContext, useContext } from 'react';
import { formatTime } from './model';
import type { TimeOptions } from './model';

/** Tests and the preview pin locale and zone here; production leaves both to the browser. */
export const TimeFormatContext = createContext<Pick<TimeOptions, 'locale' | 'timeZone'>>({});

export function Time({ ms, long = false }: { ms: number | null; long?: boolean }) {
  const format = useContext(TimeFormatContext);
  if (ms === null) return <span>Not recorded</span>;
  return (
    <time dateTime={new Date(ms).toISOString()} title={formatTime(ms, { ...format, long: true })}>
      {formatTime(ms, { ...format, long })}
    </time>
  );
}
