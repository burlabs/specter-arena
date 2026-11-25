import type { RecapSpanReasonV1 } from '../contracts/types';
import type { RecapKind } from './recapPeriods';

export type ArenaMode = 'live' | RecapKind;

export const MODE_LABELS: ReadonlyArray<{ mode: ArenaMode; label: string }> = [
  { mode: 'live', label: 'Live' },
  { mode: 'today', label: 'Today' },
  { mode: 'yesterday', label: 'Yesterday' },
  { mode: 'week', label: 'This week' },
];

/** What a not-collected stretch says. It names the reason and claims nothing about what the bots did. */
export const NOT_COLLECTED_WORDS: Readonly<Record<Exclude<RecapSpanReasonV1, 'collecting'>, string>> = {
  paused: 'Not collected: collection was paused',
  'collector-gap': 'Not collected: the collector was not running or lost its feed',
  'no-collector': 'Not collected: the app was not collecting',
  'before-first-run': 'Not collected: this is before the app first ran',
  purged: 'Not collected: older history was deleted by a purge',
};

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** Hours and minutes, never a percentage: "47 min", "3 h 5 min", "20 s". */
export function spanWords(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

export const RECAP = {
  modeGroup: 'Arena view',
  unsupported: 'Recaps need a newer app backend. Update the app to use Today, Yesterday and This week.',
  loading: 'Loading the recap…',
  heroesNote: 'Heroes shown as they are today.',
  tasksNote: 'Tasks of a minute or more.',
  weekToday: 'This week started today (Monday)',
  noTasksToday: 'No tasks yet today',
  noTasksWeek: 'No tasks yet this week',
  noTasksCollected: 'No tasks started while collection was on',
  notCollected: 'Not collected',
  truncated: (shown: number, total: number): string => `First ${shown} tasks of ${total}`,
  notDrawn: (count: number): string => `+${count} more not drawn`,
  skipped: (ms: number): string => `Skipped ${spanWords(ms)}`,
  period: (kind: RecapKind): string => (kind === 'today' ? 'Today' : kind === 'yesterday' ? 'Yesterday' : 'This week'),
  tasksSeen: 'Tasks seen',
  tasksBreakdown: (credited: number, notCredited: number, open: number): string => `${credited} credited, ${notCredited} not credited, ${open} still running`,
  xpCredited: 'XP credited in this period',
  collected: 'Collected',
  notCollectedTotal: 'Not collected',
  length: 'Recap length',
  statsLabel: 'Recap summary',
  scrubLabel: 'Playback position',
  clock: 'Recorded time',
  speed: 'Speed',
  play: 'Play',
  pause: 'Pause',
  restart: 'Restart',
  previous: 'Previous event',
  next: 'Next event',
  exit: 'Exit to live',
  controls: 'Recap controls',
  legend: 'Notches are time with no task running, cut from the playback. Hatched blocks were not collected.',
  tasksLabel: (count: number): string => plural(count, 'task', 'tasks'),
} as const;
