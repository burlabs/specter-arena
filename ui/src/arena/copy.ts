import { TOKEN_CAPTION } from '../specters/copy';

export const PLACEHOLDER_TOKEN = TOKEN_CAPTION;

export const STATE_TEXT = {
  defeated: 'Defeated',
  awaitingReview: 'Awaiting your review',
  blocked: 'Blocked',
  reopened: 'Reopened',
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
  minimapLabel: 'Arena overview',
  selectionLabel: 'Selection',
  gone: 'This item is no longer on the field.',
  selectionEmpty: 'Select a Specter or an enemy in the map, the rail or the list.',
  selectionInspectorNote: 'Evidence and decisions open in the work list. Nothing here changes any work.',
  coverage: (gaps: number, unknownBots: number): string =>
    `Coverage: ${gaps} ${gaps === 1 ? 'bot has' : 'bots have'} a collection gap, ${unknownBots} ${unknownBots === 1 ? 'bot is' : 'bots are'} unknown`,
  asOf: 'As of',
  emptyRosterTitle: 'No bots are on the roster yet',
  emptyRosterBody: 'The collector has not seen any Kiro Crew bots. Create or open a bot in Crew, then refresh.',
  noWork: 'No work is on the field.',
  staleBanner: 'Showing data from',
  retry: 'Retry',
  unsupportedTitle: 'Work is not available on this backend',
  unsupportedBody: 'This version of the app backend does not support work items, so the arena has no enemies to draw.',
  forbiddenTitle: 'Not permitted',
  forbiddenBody: 'The host did not allow this app to read work items.',
  offlineTitle: 'Could not reach the app backend',
  offlineBody: 'Check that the app is running, then retry.',
  unavailableTitle: 'Work could not be loaded',
  unavailableBody: 'The backend answered with an error. Retry in a moment.',
  unexpectedTitle: 'Work answered in a form this page does not know',
  unexpectedBody: 'The backend returned something unexpected. Nothing was changed.',
  overflow: (count: number): string => `${count} more on-field ${count === 1 ? 'item is' : 'items are'} listed below and not drawn in the scene.`,
  truncated: 'The arena read the first 8 pages of each state, so counts may be higher than shown.',
  acceptedGap: 'Accepted items come from the newest-created page only, so an older item accepted today may be missing here.',
  notDrawn: 'Not drawn in the scene',
  attemptsBadge: (count: number): string => `×${count} attempts`,
  linked: (count: number): string => `${count} open ${count === 1 ? 'attempt' : 'attempts'}`,
  level: (level: number): string => `Lv. ${level}`,
  xpAward: (xp: number): string => `+${xp} XP`,
  xpCommitted: (xp: number): string => `${xp} XP`,
  noXp: 'No XP',
  partOf: 'Part of',
  contributors: 'Contributors',
  noContributors: 'No bots linked',
  partsAccepted: (accepted: number, total: number): string => `${accepted} of ${total} ${total === 1 ? 'part' : 'parts'} accepted`,
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
} as const;

export const MODE = {
  LIVE: 'LIVE',
  FIXTURE: 'FIXTURE — demo data, not Crew activity',
  RECORDED: 'RECORDED — not live',
} as const;

export const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'working', label: 'Working' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'awaiting-review', label: 'Awaiting your review' },
  { value: 'defeated', label: 'Defeated' },
  { value: 'unknown', label: 'Unknown' },
] as const;

export type FilterValue = (typeof FILTERS)[number]['value'];

export const CUE = {
  eyebrow: 'New committed outcome',
  title: 'Outcome accepted',
} as const;
