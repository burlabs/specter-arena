import type { DecisionAction } from './model';

export const SECTION_LABEL = 'Work';

export const LIST = {
  label: 'Work items',
  detailLabel: 'Work detail',
  newItem: 'New work item',
  loading: 'Loading work items…',
  emptyTitle: 'No work items yet',
  emptyBody: 'Observed attempts stay unclassified and earn nothing until you track them as work.',
  unsupportedTitle: 'Work tracking is not supported here',
  unsupportedBody: 'This version of the app backend does not support work items yet.',
  failureTitle: 'Could not load work items',
  filterLabel: 'Show',
  selectPrompt: 'Select a work item to see its evidence and decisions.',
  gone: 'This work item no longer exists.',
  filterEmpty: 'No work items in this state.',
  loadOlder: 'Load older work items',
  loadingOlder: 'Loading older work items…',
  olderFailed: 'Could not load older work items. Try again.',
} as const;

export const STATE_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'All states' },
  { value: 'open', label: 'Open' },
  { value: 'awaiting-review', label: 'Awaiting your review' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'reopened', label: 'Reopened' },
];

export const DETAIL = {
  condition: 'Acceptance condition',
  partOf: 'Part of',
  created: 'Created',
  changed: 'Last changed',
  xp: 'XP',
  milestones: 'Milestones',
  milestoneHint: 'Marked by you',
  contributors: 'Contributors',
  contributorsHelp: 'Contributors are the bots whose attempts are linked here. They are frozen at the first acceptance.',
  noContributors: 'No bots yet. Link an attempt to add one.',
  noXpYet: 'No XP yet',
  evidence: 'Evidence',
  evidenceHelp: 'Ended says only that an attempt closed. It is not a result.',
  noEvidence: 'No attempts are linked yet.',
  missingAttempt: 'Not found in the attempts record',
  decisions: 'Decisions, oldest first',
  decisionsHelp: 'Every decision is recorded as app-owner. Crew gives apps no per-person identity.',
  noDecisions: 'No decisions yet.',
  decisionCap: 'Showing up to 50 decisions.',
  linkAttempt: 'Link another attempt',
  linkSubmit: 'Link attempt',
  linkCancel: 'Cancel',
  unknownStateNote: 'This app version does not know this state, so no actions are offered.',
  ended: 'Ended',
  stillOpen: 'Still open',
  notFound: 'Not found',
  reviewHeading: 'Review',
  blockedBy: 'Why it cannot be accepted yet',
  noXpItem: 'Tracked without XP',
  rewardedWhenAccepted: (bounty: number, policyVersion: string): string => `${bounty} XP when accepted (${policyVersion})`,
  groupsParts: (count: number): string => `Groups ${count} ${count === 1 ? 'part' : 'parts'} and earns no XP itself`,
  partsAccepted: (accepted: number, count: number): string => `${accepted} of ${count} ${count === 1 ? 'part' : 'parts'} accepted`,
  contributorLine: (name: string, attempts: number, xpNet: number): string =>
    `${name} · ${attempts} ${attempts === 1 ? 'attempt' : 'attempts'} · ${xpNet > 0 ? `${xpNet} XP` : 'No XP yet'}`,
  evidenceRow: (kind: string, shortId: string, status: string): string => `${kind} · ${shortId} · ${status}`,
  decisionLine: (seq: number, action: string, from: string, to: string): string => `#${seq} ${action} by app-owner. ${from} to ${to}.`,
  evidenceRef: (revision: string): string => `Evidence ${revision}`,
} as const;

export const PROGRESS = {
  unknown: 'Progress unknown',
  done: (done: number, total: number): string => `${done} of ${total} milestones done`,
} as const;

export const ACTION_LABELS: Readonly<Record<DecisionAction, string>> = {
  submit: 'Submit for review',
  accept: 'Accept…',
  reject: 'Reject…',
  block: 'Mark blocked',
  unblock: 'Unblock',
  cancel: 'Cancel work item…',
  reopen: 'Reopen…',
};

export const ACTION_WORDS: Readonly<Record<string, string>> = {
  submit: 'Submitted for review',
  accept: 'Accepted',
  reject: 'Rejected',
  block: 'Marked blocked',
  unblock: 'Unblocked',
  cancel: 'Cancelled',
  reopen: 'Reopened',
};

export const actionWords = (action: string): string => ACTION_WORDS[action] ?? `Unknown action (${action})`;

export const ACTION_ANNOUNCE: Readonly<Record<string, string>> = {
  submit: 'Sent for review.',
  accept: 'Work accepted.',
  reject: 'Work rejected.',
  block: 'Work marked blocked.',
  unblock: 'Work unblocked.',
  cancel: 'Work item cancelled.',
  reopen: 'Work reopened.',
};

export const BLOCKER_WORDS: Readonly<Record<string, string>> = {
  'no-evidence': 'No attempts are linked yet.',
  'attempts-not-ended': 'An attempt is still open.',
  'attempt-missing': 'An attempt is no longer in the attempts record.',
  'children-not-accepted': 'Every part must be accepted first.',
  'wrong-state': 'Send it for review first.',
};

export const blockerWords = (token: string): string => BLOCKER_WORDS[token] ?? `Blocked by: ${token}`;

export const ERROR_WORDS: Readonly<Record<string, string>> = {
  stale_evidence: 'The evidence changed after you opened this review, so nothing was decided.',
  version_conflict: 'This work item changed somewhere else. It was reloaded; review it and try again.',
  invalid_transition: 'That action is not possible from the current state. The item was reloaded.',
  attempts_not_ended: 'An attempt is still open, so it cannot be accepted yet.',
  no_evidence: 'No attempts are linked, so there is nothing to accept.',
  children_not_accepted: 'Every part must be accepted first.',
  attempt_already_linked: 'That attempt is already tracked in another work item.',
  attempt_not_eligible: 'Only bot turns and worker attempts can be tracked.',
  unknown_attempt: 'That attempt is no longer in the attempts record.',
  unknown_work: 'This work item no longer exists.',
  unknown_binding: 'This bot is no longer on the roster.',
  parent_locked: 'That parent already has XP or is closed, so it cannot take new parts.',
  contributors_frozen: 'XP was already awarded, so only attempts from existing contributors can be linked.',
  request_reused: 'That request id was already used with different fields. Try again.',
  limit_reached: 'A limit was reached: up to 16 attempts and 8 milestones.',
  invalid_body: 'The app could not use what was sent. Check the fields and try again.',
  invalid_state: 'That state filter is not one this backend knows.',
  invalid_cursor: 'The next page could not be found. Reload the list.',
  invalid_limit: 'That page size was not accepted.',
  body_too_large: 'That request was too large.',
  store_not_ready: 'The app database is still starting. Try again in a moment.',
  store_unavailable: "The app's database is unavailable. Nothing was changed.",
  offline: 'Could not reach the app backend. Nothing was changed.',
  unexpected: 'The app backend sent a reply this page could not read.',
  http_403: 'Your session expired. Reload the page to sign in again.',
  busy: 'Another change is still being saved.',
};

export const errorWords = (code: string): string => ERROR_WORDS[code] ?? `Something went wrong (${code}).`;

/** Codes after which the item on screen may be out of date, so the page reloads it. */
export const REFRESH_CODES: readonly string[] = ['version_conflict', 'invalid_transition', 'attempts_not_ended', 'no_evidence', 'children_not_accepted', 'stale_evidence', 'unknown_attempt'];

export const LEVEL_NOTE = 'Level reflects accepted work, not ability or current condition.';

export const XP = {
  acceptedWork: 'Accepted work',
  xp: 'XP',
  level: 'Level',
  unit: 'XP from accepted work',
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
  empty: 'No XP entries yet. XP comes only from work you accept.',
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

export const ACCEPT_OWNER_LINE = 'You are accepting this as the app owner.';

export const REVIEW = {
  back: 'Go back',
  noteLabel: 'Note (optional)',
  reasonLabel: 'Reason (optional)',
  stale: 'The evidence changed after you opened this review, so nothing was decided. Review it again.',
  reviewAgain: 'Review again',
  reloading: 'Reloading the latest evidence…',
  changed: 'This work changed. Review it again.',
  accept: {
    heading: 'Accept this work',
    warning: `Ended attempts alone never decide anything. ${ACCEPT_OWNER_LINE}`,
    acknowledge: 'I reviewed the evidence above and accept this work',
    submit: 'Accept work',
    evidence: (count: number, ids: string): string => `${count} linked ${count === 1 ? 'attempt' : 'attempts'}: ${ids}`,
    noAttempts: 'No linked attempts. This item groups other work.',
    noXp: 'This item is tracked without XP.',
    groups: (count: number): string => `This groups ${count} ${count === 1 ? 'part' : 'parts'} and earns no XP itself.`,
    award: (bounty: number, contributors: number): string =>
      `Accepting awards ${bounty} XP in total, split across ${contributors} ${contributors === 1 ? 'contributor' : 'contributors'}. Exact amounts appear after you accept.`,
  },
  reject: {
    heading: 'Reject this work',
    body: 'Rejecting awards no XP. You can reopen it later.',
    submit: 'Reject work',
  },
  cancel: {
    heading: 'Cancel this work item',
    body: 'A cancelled item cannot be reopened.',
    submit: 'Cancel work item',
  },
  reopen: {
    heading: 'Reopen this work item',
    takesBack: 'Reopening takes back the XP it earned. Accepting it again restores exactly the same amount, never more.',
    noXp: 'Reopening changes no XP.',
    submit: 'Reopen work',
  },
} as const;

export const CREATE = {
  heading: 'New work item',
  title: 'Title',
  condition: 'Acceptance condition',
  conditionHelp: 'Say what you will check before you accept this work.',
  milestones: 'Milestones (optional)',
  milestoneLabel: (position: number): string => `Milestone ${position}`,
  addMilestone: 'Add milestone',
  removeMilestone: (position: number): string => `Remove milestone ${position}`,
  rewardable: 'Award XP for this work',
  parent: 'Part of (optional)',
  noParent: 'Not part of another item',
  attempts: 'Attempts to track',
  noAttempts: 'You can create an item with no attempts and link them later. It cannot be accepted until it has evidence.',
  submit: 'Create work item',
  cancel: 'Cancel',
  invalid: 'Add a title and an acceptance condition within the limits.',
  counter: (used: number, max: number): string => `${used} of ${max}`,
  created: 'Work item created.',
  createdHidden: 'Created. It is hidden by the current filter.',
} as const;

export const PICKER = {
  label: 'Choose attempts',
  bot: 'Bot',
  chooseBot: 'Choose a bot',
  loading: 'Loading attempts…',
  failed: 'Could not load attempts for this bot.',
  gone: 'This bot is no longer on the roster.',
  empty: 'This bot has no recorded attempts.',
  loadOlder: 'Load older attempts',
  loadingOlder: 'Loading older attempts…',
  olderFailed: 'Could not load older attempts. Try again.',
  selected: (count: number, max: number): string => `${count} of ${max} selected`,
  limit: (max: number): string => `You can track up to ${max} attempts in one item.`,
  trackedIn: (title: string): string => `Tracked in ${title}`,
  noSelection: 'No attempts selected.',
  selectedLabel: 'Selected attempts',
  singleChoice: 'Choose one attempt',
} as const;

export const ANNOUNCE = {
  milestoneOn: (label: string): string => `Milestone marked: ${label}.`,
  milestoneOff: (label: string): string => `Milestone cleared: ${label}.`,
  linked: 'Attempt linked.',
} as const;

export const ROW = {
  noXp: 'No XP',
  groups: 'Groups parts',
  awarded: (xp: number): string => `${xp} XP awarded`,
  pending: (bounty: number): string => `${bounty} XP when accepted`,
  noBots: 'No bots linked',
} as const;

export const KIND_WORDS: Readonly<Record<string, string>> = { 'bot-turn': 'Bot turn', worker: 'Worker' };

export const kindWords = (kind: string): string => KIND_WORDS[kind] ?? kind;

export const PARTIAL_ROSTER = 'The roster is partial, so some contributor names may show as unknown.';
