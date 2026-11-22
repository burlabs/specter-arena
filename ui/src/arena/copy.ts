export const STATE_TEXT = {
  defeated: 'Defeated',
  notCredited: 'Not credited',
  running: 'Running',
  open: 'Open',
} as const;

export const PROGRESS_TEXT = {
  unknown: 'Progress unknown',
  milestones: (done: number, total: number): string => `${done} of ${total} milestones`,
} as const;

export const ARENA = {
  region: 'Arena',
  loading: 'Loading the arena…',
  mapLabel: 'Arena map',
  mapPlate: 'Map art is not available. Positions are still correct.',
  listLabel: 'Arena list',
  listHeading: 'Everyone on the field',
  railLabel: 'Specters',
  noSpecterYet: 'No Specter yet',
  assign: 'Assign',
  assignFor: (name: string): string => `Assign a Specter to ${name}`,
  specterLoading: 'Specters are loading.',
  specterUnavailable: 'Specters could not be read, so no hero is drawn yet.',
  minimapLabel: 'Arena overview',
  selectionLabel: 'Selection',
  selectionEmpty: 'Select a Specter or a minion in the map, the rail or the list.',
  coverage: (gaps: number, unknownBots: number): string =>
    `Coverage: ${gaps} ${gaps === 1 ? 'bot has' : 'bots have'} a collection gap, ${unknownBots} ${unknownBots === 1 ? 'bot is' : 'bots are'} unknown`,
  asOf: 'As of',
  statsLabel: 'Arena summary',
  botsObserved: 'Bots observed',
  coverageUnknown: 'Coverage unknown',
  committedXp: 'Committed XP',
  botsOnField: 'Bots on the field',
  botsOnFieldNone: 'No bots are on the field.',
  emptyRosterTitle: 'No bots are on the roster yet',
  emptyRosterBody: 'The collector has not seen any Kiro Crew bots. Create or open a bot in Crew, then refresh.',
  noWork: 'No tasks are on the field.',
  staleBanner: 'Showing data from',
  retry: 'Retry',
  unsupportedTitle: 'Tasks are not available on this backend',
  unsupportedBody: 'This version of the app backend does not support tasks, so the arena has no minions to draw.',
  forbiddenTitle: 'Not permitted',
  forbiddenBody: 'The host did not allow this app to read tasks.',
  offlineTitle: 'Could not reach the app backend',
  offlineBody: 'Check that the app is running, then retry.',
  unavailableTitle: 'Tasks could not be loaded',
  unavailableBody: 'The backend answered with an error. Retry in a moment.',
  unexpectedTitle: 'Tasks answered in a form this page does not know',
  unexpectedBody: 'The backend returned something unexpected. Nothing was changed.',
  overflow: (count: number): string => `${count} more open ${count === 1 ? 'task is' : 'tasks are'} listed below and not drawn in the scene.`,
  truncated: 'The arena read the first 8 pages of open tasks, so counts may be higher than shown.',
  closedNote: 'Credited and not-credited tasks come from the 25 most recently updated of each, so an older one closed today may be missing here.',
  notDrawn: 'Not drawn in the scene',
  attemptsBadge: (count: number): string => `×${count} attempts`,
  linked: (count: number): string => `${count} open ${count === 1 ? 'attempt' : 'attempts'}`,
  level: (level: number): string => `Lv. ${level}`,
  xpAward: (xp: number): string => `+${xp} XP`,
  xpCommitted: (xp: number): string => `${xp} XP`,
  attackLegend: 'Attacks show live activity, not progress. A waiting marker is Crew\'s own flag. A minion\'s size follows how long its task has run. It never means progress or remaining effort.',
  xpLoading: 'Loading',
  xpUnavailable: 'Unavailable',
  noXp: 'No XP',
  selected: (name: string, state: string): string => `Selected ${name}, ${state}`,
  unknownCondition: 'Coverage unknown',
  atRest: 'No turn running',
  engaging: 'Working',
} as const;

export const HUD = {
  label: 'Map controls',
  fit: 'Fit map',
  reset: 'Reset view',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoom: 'Zoom',
  pause: 'Pause animation',
  paused: 'Animation paused',
  resume: 'Resume animation',
  minimapShow: 'Show overview',
  minimapHide: 'Hide overview',
  railShow: 'Show Specter rail',
  railHide: 'Hide Specter rail',
  inspectorShow: 'Show inspector',
  inspectorHide: 'Hide inspector',
} as const;

export const MODE = {
  LIVE: 'LIVE',
  FIXTURE: 'FIXTURE — demo data, not Crew activity',
  RECORDED: 'RECORDED — not live',
} as const;

export const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'working', label: 'Running' },
  { value: 'credited', label: 'Credited' },
  { value: 'not-credited', label: 'Not credited' },
  { value: 'unknown', label: 'Unknown' },
] as const;

export type FilterValue = (typeof FILTERS)[number]['value'];

export const CUE = {
  eyebrow: 'Task closed',
  title: 'Task credited',
} as const;

export const INSPECTOR = {
  region: 'Encounter inspector',
  close: 'Close inspector',
  loading: 'Loading evidence…',
  goneTitle: 'This item is no longer available',
  goneBody: 'It was removed, or this app can no longer see it. Nothing shown earlier is kept.',
  forbiddenTitle: 'Not permitted',
  forbiddenBody: 'The host did not allow this app to read it. Nothing shown earlier is kept.',
  failedTitle: 'Evidence could not be loaded',
  failedBody: 'Nothing shown earlier is kept. Retry in a moment.',
  retry: 'Retry',
  defeated: 'Defeated',
  committedXp: (xp: number): string => `${xp} XP credited`,
  handoffHeading: 'Reach Crew',
  summaryHeading: 'Diagnostic summary',
  copyButton: 'Copy diagnostic summary',
  copied: 'Copied.',
  copyRefused: 'Copy was refused. Select the text below.',
  summaryLabel: 'Diagnostic summary text',
  summaryHelp: 'Ids, states, times and counts only. No notes, names, links or message text.',
  specterFiction: 'Fiction, written for this Specter',
  openWork: 'Open tasks',
  noOpenWork: 'No open task is linked to this Specter.',
  attempts: 'Attempts',
  coverage: 'Coverage',
  xpLedger: 'XP ledger',
  noXp: 'No XP entries yet.',
  loadOlder: 'Load older entries',
  loadingOlder: 'Loading older entries…',
  olderFailed: 'Older entries could not be loaded.',
  source: 'Source details',
  forBot: (name: string): string => `for ${name}`,
  entryLine: (kind: string, amount: string, title: string): string => `${kind} ${amount} · ${title}`,
} as const;

/** "Lv. 3 · 250 XP", or the word for why the numbers are not known yet. Never a made-up "Lv. 1 · 0 XP". */
export function levelXpText(reading: 'ready' | 'loading' | 'failed', level: number, xp: number, suffix = ''): string {
  if (reading === 'loading') return ARENA.xpLoading;
  if (reading === 'failed') return ARENA.xpUnavailable;
  return `${ARENA.level(level)} · ${ARENA.xpCommitted(xp)}${suffix}`;
}
