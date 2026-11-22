import type { TaskCloseReasonV1, TaskItemV1, TaskKindV1, TaskSizeClassV1, TaskStateV1 } from '../contracts/types';

/** The sentence the product promises: XP follows an observed clean end, not a human check. */
export const AUTO_CREDITED = 'Auto-credited when the task ended cleanly.';

export const KIND_WORDS: Readonly<Record<TaskKindV1, string>> = { 'bot-turn': 'Bot turn', worker: 'Worker task' };

export const STATE_WORDS: Readonly<Record<TaskStateV1, string>> = { open: 'Open', credited: 'Credited', 'not-credited': 'Not credited' };

export const STATE_TONE: Readonly<Record<TaskStateV1, 'open' | 'accepted' | 'cancelled'>> = { open: 'open', credited: 'accepted', 'not-credited': 'cancelled' };

/** Why a closed task earned nothing. A reason this app does not know is shown as its token, never as a guess. */
export const NOT_CREDITED_WORDS: Readonly<Record<Exclude<TaskCloseReasonV1, 'clean-end'>, string>> = {
  'unknown-terminal': 'Not credited: this task ended in a way the app could not read as a clean end.',
  'coverage-gap': 'Not credited: a collection gap overlapped this task.',
  'waiting-at-end': 'Not credited: an approval or a question was still pending when it ended.',
};

export const SIZE_WORDS: Readonly<Record<TaskSizeClassV1, string>> = {
  small: 'Small, ran under 2 minutes',
  medium: 'Medium, ran 2 to under 15 minutes',
  large: 'Large, ran 15 minutes or more',
};

export const SIZE_LABEL: Readonly<Record<TaskSizeClassV1, string>> = { small: 'Small', medium: 'Medium', large: 'Large' };

/** One line about close-out for a task, in words. */
export function closeOutWords(task: Pick<TaskItemV1, 'state' | 'closeReason' | 'attemptState'>): string {
  if (task.state === 'credited') return AUTO_CREDITED;
  if (task.state === 'not-credited') {
    const reason = task.closeReason;
    if (reason === null || reason === 'clean-end') return 'Not credited.';
    return NOT_CREDITED_WORDS[reason] ?? `Not credited (${String(reason)}).`;
  }
  if (task.attemptState === 'working') return 'Open: still running. It closes by itself when it ends.';
  if (task.attemptState === 'unknown') return 'Open: the app can no longer observe this task, so it cannot be closed yet.';
  return 'Open: it has ended and is waiting to be closed out.';
}

/** "42 s", "5 min", "1 h 5 min". Whole units, rounded down; never a percentage. */
export function runTimeWords(runMs: number): string {
  const seconds = Math.floor(runMs / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** The short label for a task: its kind and its observed run time. */
export const taskTitle = (task: Pick<TaskItemV1, 'kind' | 'runMs'>): string => `${KIND_WORDS[task.kind] ?? task.kind} · ${runTimeWords(task.runMs)}`;

export const TASK = {
  heading: 'Task evidence',
  evidenceHelp: 'Observed by this app from the bot\'s own turns and the worker sessions it started. The app closes a task by itself; nobody clicks anything.',
  kind: 'Kind',
  started: 'Started',
  ended: 'Ended',
  stillRunning: 'Still running',
  notObserved: 'Not observed',
  runTime: 'Run time',
  sizeClass: 'Size class',
  sizeNote: 'Size follows how long the task has run. It does not show progress, health or remaining effort.',
  closeOut: 'Close-out',
  xp: 'XP credited',
  policy: 'Policy',
  bot: 'Bot',
  attempt: 'Attempt',
  noXp: 'No XP',
  noXpYet: 'No XP yet',
  xpLine: (xp: number, policy: string): string => `${xp} XP (${policy})`,
  invariant: 'XP follows what the app observed. It is not a check that the outcome was right.',
  rewardHeading: 'Reward',
  listColumns: { task: 'Task', closeOut: 'Close-out', size: 'Size and run time', bot: 'Bot', xp: 'XP' },
  listCaption: 'Tasks',
  sizeAndRun: (task: Pick<TaskItemV1, 'sizeClass' | 'runMs'>): string => `${SIZE_LABEL[task.sizeClass]} · ${runTimeWords(task.runMs)}`,
} as const;
