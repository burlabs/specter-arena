/** Words for the XP cards, the level meter and the progression ledger. */
export const LEVEL_NOTE = 'Level follows XP credited automatically for tasks, plus earlier accepted work. It reflects observed activity, not ability, outcome quality or current condition.';

export const XP = {
  tasksCredited: 'Tasks credited',
  xp: 'XP',
  level: 'Level',
  unit: 'XP',
  loading: 'Not loaded yet',
  unsupported: 'Not supported by this backend',
  failed: 'Could not load. It retries automatically.',
  topLevel: 'Top level reached',
  levelWord: (level: number): string => `Level ${level}`,
  toward: (into: number, span: number, next: number): string => `${into} of ${span} XP toward level ${next}`,
  entryPolicy: (policyVersion: string): string => `Policy ${policyVersion}`,
  policy: (policyVersion: string, tableVersion: string): string => `Policy ${policyVersion} · Level table ${tableVersion}`,
} as const;

export const PROGRESSION = {
  label: 'Progression',
  entries: 'XP entries, newest first',
  empty: 'No ledger entries to list yet.',
  basis: 'XP is credited automatically when a task ends cleanly. It reflects observed activity, not verified outcomes.',
  loading: 'Loading progression…',
  gone: 'This bot is no longer on the roster.',
  loadOlder: 'Load older entries',
  loadingOlder: 'Loading older entries…',
  olderFailed: 'Could not load older entries. Try again.',
  retry: 'Retry',
  failedTitle: 'Could not load progression',
  unsupportedTitle: 'Progression is not supported here',
  unsupportedBody: 'This version of the app backend does not support XP yet.',
} as const;

export const ENTRY_KIND_WORDS: Readonly<Record<string, string>> = {
  award: 'Award',
  correction: 'Correction (reopened)',
  reinstatement: 'Reinstated',
};

export const entryKindWords = (kind: string): string => ENTRY_KIND_WORDS[kind] ?? `Unknown entry (${kind})`;

export const PARTIAL_ROSTER = 'The roster is partial, so some bot names may show as unknown.';
