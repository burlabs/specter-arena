import type { DataRunV1, DataDeletedV1 } from '../contracts/types';
import type { SourceMode } from '../host';
import { attemptWords, observationWords, quarantineWords, uploadWords } from './model';

export const DATA_MODE: Readonly<Record<SourceMode, string>> = {
  LIVE: 'LIVE',
  FIXTURE: 'FIXTURE — demo data. Nothing here changes your real data.',
  RECORDED: 'RECORDED — not live',
};

export const PAGE = {
  label: 'Data',
  heading: 'Data and collection',
  loading: 'Loading data controls…',
  unsupportedTitle: 'This version of the app has no data controls',
  unsupportedBody: 'The app backend does not offer them yet. Update the app in Crew, then reload.',
  failureTitle: 'Could not load the data controls',
  stale: 'Showing the last data that loaded.',
} as const;

export const COLLECTION = {
  heading: 'Collection',
  pausedNote: 'While collection is paused nothing new is recorded. That time is kept as a gap in coverage, never as no activity.',
  runningNote: 'Pausing records a gap in coverage until you resume.',
  pause: 'Pause collection',
  resume: 'Resume collection',
  notPaused: 'Collection is not paused.',
  pausedDone: 'Collection paused.',
  resumedDone: 'Collection resumed.',
} as const;

/** The seven options of the picker; the empty value is "Keep everything". */
export const RETENTION = {
  heading: 'History',
  label: 'Keep history for',
  keepEverything: 'Keep everything',
  save: 'Save setting',
  saved: 'Retention setting saved. Nothing was deleted.',
  help: 'Choosing a window deletes nothing by itself. History older than the window is removed only when you press Purge and confirm.',
  keepNote: 'Keep everything is selected, so nothing is ever purged.',
  unsavedNote: 'Save the setting before you purge. A purge always uses the saved window.',
  daysLabel: (days: number): string => `${days} days`,
  /** What stays: stated once so the promise is next to the button that could break it. */
  kept: 'A purge never touches bot identity, hero assignment, avatars, work items, decisions or XP.',
  backup: 'Before it deletes anything the app writes a backup in data/store/backups/. If the backup fails, nothing is deleted. Only the newest purge backup is kept.',
  noShrink: 'The database file does not shrink after a purge. The space is reused by later writes, and deleted content can stay in unused pages until then.',
} as const;

export const PURGE = {
  heading: 'Purge old history',
  open: 'Purge…',
  confirmHeading: 'Purge old history',
  confirm: 'Purge history',
  cancel: 'Cancel',
  nothing: 'Nothing is older than the saved window, so there is nothing to purge.',
  none: 'Choose a window and save it to see what a purge would delete.',
  running: 'A purge is running. Wait for it to finish.',
  working: 'Purging…',
  done: 'Purge finished.',
  /** Said once the horizon is known; "unknown" is the honest word, never "no activity". */
  horizon: (date: string): string => `History before ${date} was purged. Coverage for that time is unknown.`,
} as const;

export const EXPORT = {
  heading: 'Export',
  help: 'Writes a consistent copy of the whole store to your computer. It is not sent anywhere, and the app never deletes an export.',
  action: 'Export the store',
  working: 'Exporting…',
  none: 'No export has been written yet.',
  saved: (fileName: string): string => `Saved to data/exports/${fileName} in the app folder.`,
  listLabel: 'Exports',
} as const;

export const UPLOADS = {
  heading: 'Uploaded images',
  usage: (stored: number, cap: number): string => `${stored.toLocaleString('en-US')} of ${cap.toLocaleString('en-US')} uploaded images stored.`,
  atCap: 'The upload limit is reached. Remove unused uploads, or reuse an image already stored.',
  unused: (count: number): string => `${uploadWords(count)} ${count === 1 ? 'is' : 'are'} not used by any avatar, current or past.`,
  noneUnused: 'Every uploaded image is used by an avatar.',
  help: 'Only uploads older than one hour that no avatar uses are removed. Bundled art is never removed. A backup is written first.',
  open: 'Remove unused uploads…',
  confirmHeading: 'Remove unused uploads',
  confirm: 'Remove unused uploads',
  working: 'Removing…',
  done: 'Unused uploads removed.',
} as const;

const RUN_KIND: Readonly<Record<string, string>> = { purge: 'purge', 'asset-cleanup': 'upload cleanup' };

function deletedWords(kind: string, deleted: DataDeletedV1): string {
  if (kind === 'asset-cleanup') return `removed ${uploadWords(deleted.assets)}`;
  return `deleted ${observationWords(deleted.observations)}, ${quarantineWords(deleted.quarantine)} and ${attemptWords(deleted.attempts)}`;
}

/** One sentence for a finished, interrupted or failed run. `time` is already formatted. */
export function runWords(run: DataRunV1, time: string): string {
  const name = RUN_KIND[run.kind] ?? run.kind;
  if (run.state === 'completed') return `Last ${name} finished ${time}: ${deletedWords(run.kind, run.deleted)}.`;
  if (run.state === 'interrupted') {
    return `The last ${name} was interrupted (${time}) after it ${deletedWords(run.kind, run.deleted)}. What it deleted stays deleted. Run it again to finish.`;
  }
  if (run.state === 'failed') return `The last ${name} failed (${time}). ${run.kind === 'purge' ? 'Check the counts below before you try again.' : 'Try again.'}`;
  return `A ${name} is running (started ${time}). Wait for it to finish.`;
}

const ERROR_WORDS: Readonly<Record<string, string>> = {
  invalid_body: 'The app did not accept that request. Reload the page and try again.',
  lifecycle_busy: 'Another data action is already running. Wait for it to finish, then try again.',
  retention_not_set: 'Choose and save a retention setting first.',
  retention_mismatch: 'The saved setting is different from the one on screen. The panel was refreshed. Check it, then try again.',
  backup_failed: 'The safety backup could not be written, so nothing was deleted.',
  export_failed: 'The export could not be written. Nothing in the store changed.',
  store_unavailable: "The app's database is unavailable. Nothing was changed. Retry in a moment.",
  store_not_ready: 'The app is still starting. Retry in a moment.',
  collector_unavailable: 'The collector is not available, so collection could not be paused or resumed.',
  offline: 'Could not reach the app backend. Nothing was changed.',
  unexpected: 'The app backend sent a reply this page does not understand. Nothing was changed. Reload the page.',
};

export const errorWords = (code: string): string => ERROR_WORDS[code] ?? `The request failed (${code}). Nothing was changed.`;
