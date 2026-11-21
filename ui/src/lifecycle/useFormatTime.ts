import { useContext } from 'react';
import { formatTime } from '../observatory/model';
import { TimeFormatContext } from '../observatory/Time';

/** Text for a time inside a sentence, with the same locale and zone the page's `<Time>` uses. */
export function useFormatTime(): (ms: number) => string {
  const format = useContext(TimeFormatContext);
  return (ms) => formatTime(ms, format);
}
