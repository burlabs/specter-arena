// Hand-written types for the seed wire contracts in contracts/schemas/. The schemas are the
// source of truth; contracts.test.ts fails when a type drifts from its schema.

export interface ApiErrorV1 {
  contractVersion: 1;
  error: string;
}

export interface PageV1<Item extends object = Record<string, unknown>> {
  contractVersion: 1;
  items: Item[];
  nextCursor: string | null;
}

export type StoreStateV1 = 'ready' | 'unconfigured' | 'migrating' | 'schema-newer' | 'sqlite-too-old' | 'unavailable' | 'disabled';

export interface ReadyV1 {
  contractVersion: 1;
  status: 'ready' | 'not-ready';
  store: StoreStateV1;
  storeVersion: number | null;
  latestVersion: number | null;
}

export interface RosterAvatarV1 {
  kind: string;
  ref: string | null;
}

/** The four Crew flags as the collector last saw them (null when not seen); not mapped to a state. */
export interface RosterSignalsV1 {
  needsInput: boolean | null;
  hasOptions: boolean | null;
  pendingApproval: boolean | null;
  waitingForInput: boolean | null;
}

/** state is a documented token, not a closed list: working, settled, unknown today. */
export interface RosterConditionV1 {
  state: string;
  reasonCode: string;
  basis: 'row' | 'event' | null;
  sourceTimeMs: number | null;
  observedAtMs: number | null;
  signals: RosterSignalsV1;
}

export interface RosterCoverageV1 {
  state: 'covered' | 'gap' | 'unknown';
  sinceMs: number | null;
  reasonCode: string | null;
  openGapCount: number;
}

/** running + unknown is the open worker count; unknown is never folded into running. */
export interface RosterWorkersV1 {
  running: number;
  seen: number;
  unknown: number;
}

export interface RosterItemV1 {
  /** 1 on the v1 wire; 2 on an item from `?view=signals` (`RosterItemV2` adds only `tokenReading`). */
  contractVersion: 1 | 2;
  bindingId: string;
  displayName: string | null;
  avatar: RosterAvatarV1 | null;
  presence: 'present' | 'absent' | 'unknown';
  condition: RosterConditionV1;
  coverage: RosterCoverageV1;
  lastObservedAtMs: number | null;
  workers: RosterWorkersV1;
}

export interface RosterCollectorV1 {
  state: string;
  reasonCode: string | null;
  sinceMs: number | null;
}

/** code is a token such as cron-turns-not-observable; count is null when the note has no number. */
export interface RosterNoteV1 {
  code: string;
  count: number | null;
}

export interface RosterV1 {
  contractVersion: 1;
  items: RosterItemV1[];
  nextCursor: string | null;
  rosterRevision: number;
  collector: RosterCollectorV1;
  notes: RosterNoteV1[];
}

/**
 * `roster-item.v2` (`GET /api/roster?view=signals`): v1 plus `tokenReading`. condition.state also
 * takes `waiting` (reasonCode approval-pending or question-pending), derived from Crew's row flags.
 */
export interface RosterTokenReadingV2 {
  kind: 'context';
  used: number;
  window: number;
  observedAt: number;
}

export interface RosterItemV2 extends Omit<RosterItemV1, 'contractVersion'> {
  contractVersion: 2;
  /** The context window in use: a gauge, never spend, a total or experience. Null is "Not collected". */
  tokenReading: RosterTokenReadingV2 | null;
}

export interface RosterV2 extends Omit<RosterV1, 'contractVersion' | 'items'> {
  contractVersion: 2;
  items: RosterItemV2[];
}

/** state is a documented token, not a closed list: working, ended, unknown today. */
export interface AttemptConditionV1 {
  state: string;
  reasonCode: string;
}

/** attemptId is opaque. endedMs and endSignal are null while the attempt is open. */
export interface AttemptItemV1 {
  contractVersion: 1;
  attemptId: string;
  kind: string;
  startedMs: number;
  endedMs: number | null;
  endSignal: string | null;
  condition: AttemptConditionV1;
}

/** sampleSize = botTurnsStarted + workersStarted = ended + stillOpen + unknown. coveredMs 0 means not collected. */
export interface AttemptsWindowV1 {
  fromMs: number;
  toMs: number;
  windowMs: number;
  observedFromMs: number;
  coveredMs: number;
  gapCount: number;
  botTurnsStarted: number;
  workersStarted: number;
  sampleSize: number;
  ended: number;
  stillOpen: number;
  unknown: number;
}

export interface AttemptsActivityV1 {
  last24h: AttemptsWindowV1;
  last7d: AttemptsWindowV1;
}

export interface AttemptsV1 {
  contractVersion: 1;
  bindingId: string;
  items: AttemptItemV1[];
  nextCursor: string | null;
  rosterRevision: number;
  asOfMs: number;
  activity: AttemptsActivityV1;
}

/** dataBase64 is null in lists and embedded copies; a string only in the body of GET /api/assets/{assetId}. `origin` is a documented token, not a closed list. */
export interface PortraitAssetV1 {
  contractVersion: 1;
  assetId: string;
  mediaType: 'image/png';
  width: number;
  height: number;
  byteLength: number;
  origin: string;
  label: string;
  dataBase64: string | null;
}

/** One read-only scene raster from GET /api/scene-assets/{key}; `key` names a file in the backend's fixed allowlist, not a closed list in the schema. */
export interface SceneAssetV1 {
  contractVersion: 1;
  key: string;
  mediaType: 'image/png';
  width: number;
  height: number;
  sha256: string;
  byteLength: number;
  dataBase64: string;
}

/** The 11 hero ids in roster order. A test compares this list with the `heroId` enum of specter.v2. */
export const HERO_IDS = ['vell', 'stitch', 'reeve', 'rattle', 'ember', 'shard', 'poly', 'tide', 'lume', 'moss', 'bur'] as const;
export type HeroId = (typeof HERO_IDS)[number];

/**
 * One bot's assigned hero. `portrait` is never null: it is the hero's bundled portrait while `avatarChosen` is false.
 * `version` is the avatar revision (0 when none) and goes back as `expectedVersion` on the portrait route.
 */
export interface SpecterV2 {
  contractVersion: 2;
  bindingId: string;
  version: number;
  heroId: HeroId;
  ordinal: number;
  displayName: string;
  name: string;
  epithet: string;
  personality: string;
  appearance: string;
  portrait: PortraitAssetV1;
  avatarChosen: boolean;
  source: 'roster';
  createdAtMs: number;
  updatedAtMs: number;
}

export interface SpectersV2 {
  contractVersion: 2;
  items: SpecterV2[];
}

/** One roster hero in `heroes.v1`. `assignedCount` is how many bots were ever given it; `assigned` is `assignedCount > 0`. */
export interface HeroesItemV1 {
  heroId: HeroId;
  name: string;
  epithet: string;
  personality: string;
  assigned: boolean;
  assignedCount: number;
}

/** Body of GET /api/heroes: all 11 roster heroes, in roster order. */
export interface HeroesV1 {
  contractVersion: 1;
  items: HeroesItemV1[];
}

/** Body of GET /api/portraits. The route has no schema of its own. */
export interface PortraitsV1 {
  contractVersion: 1;
  items: PortraitAssetV1[];
}

// A Record over keyof T makes tsc reject a missing or an extra key, so the test can compare these
// names with the schema's properties in both directions.
export const API_ERROR_KEYS: Record<keyof ApiErrorV1, true> = { contractVersion: true, error: true };
export const PAGE_KEYS: Record<keyof PageV1, true> = { contractVersion: true, items: true, nextCursor: true };
export const READY_KEYS: Record<keyof ReadyV1, true> = { contractVersion: true, status: true, store: true, storeVersion: true, latestVersion: true };
export const ROSTER_AVATAR_KEYS: Record<keyof RosterAvatarV1, true> = { kind: true, ref: true };
export const ROSTER_SIGNALS_KEYS: Record<keyof RosterSignalsV1, true> = { needsInput: true, hasOptions: true, pendingApproval: true, waitingForInput: true };
export const ROSTER_CONDITION_KEYS: Record<keyof RosterConditionV1, true> = { state: true, reasonCode: true, basis: true, sourceTimeMs: true, observedAtMs: true, signals: true };
export const ROSTER_COVERAGE_KEYS: Record<keyof RosterCoverageV1, true> = { state: true, sinceMs: true, reasonCode: true, openGapCount: true };
export const ROSTER_WORKERS_KEYS: Record<keyof RosterWorkersV1, true> = { running: true, seen: true, unknown: true };
export const ROSTER_ITEM_KEYS: Record<keyof RosterItemV1, true> = { contractVersion: true, bindingId: true, displayName: true, avatar: true, presence: true, condition: true, coverage: true, lastObservedAtMs: true, workers: true };
export const ROSTER_ITEM_V2_KEYS: Record<keyof RosterItemV2, true> = { ...ROSTER_ITEM_KEYS, tokenReading: true };
export const ROSTER_TOKEN_READING_KEYS: Record<keyof RosterTokenReadingV2, true> = { kind: true, used: true, window: true, observedAt: true };
export const ROSTER_COLLECTOR_KEYS: Record<keyof RosterCollectorV1, true> = { state: true, reasonCode: true, sinceMs: true };
export const ROSTER_NOTE_KEYS: Record<keyof RosterNoteV1, true> = { code: true, count: true };
export const ROSTER_KEYS: Record<keyof RosterV1, true> = { contractVersion: true, items: true, nextCursor: true, rosterRevision: true, collector: true, notes: true };
export const ROSTER_V2_KEYS: Record<keyof RosterV2, true> = ROSTER_KEYS;
export const ATTEMPT_CONDITION_KEYS: Record<keyof AttemptConditionV1, true> = { state: true, reasonCode: true };
export const ATTEMPT_ITEM_KEYS: Record<keyof AttemptItemV1, true> = { contractVersion: true, attemptId: true, kind: true, startedMs: true, endedMs: true, endSignal: true, condition: true };
export const ATTEMPTS_WINDOW_KEYS: Record<keyof AttemptsWindowV1, true> = { fromMs: true, toMs: true, windowMs: true, observedFromMs: true, coveredMs: true, gapCount: true, botTurnsStarted: true, workersStarted: true, sampleSize: true, ended: true, stillOpen: true, unknown: true };
export const ATTEMPTS_ACTIVITY_KEYS: Record<keyof AttemptsActivityV1, true> = { last24h: true, last7d: true };
export const ATTEMPTS_KEYS: Record<keyof AttemptsV1, true> = { contractVersion: true, bindingId: true, items: true, nextCursor: true, rosterRevision: true, asOfMs: true, activity: true };
export const PORTRAIT_ASSET_KEYS: Record<keyof PortraitAssetV1, true> = { contractVersion: true, assetId: true, mediaType: true, width: true, height: true, byteLength: true, origin: true, label: true, dataBase64: true };
export const SCENE_ASSET_KEYS: Record<keyof SceneAssetV1, true> = { contractVersion: true, key: true, mediaType: true, width: true, height: true, sha256: true, byteLength: true, dataBase64: true };
export const SPECTER_KEYS: Record<keyof SpecterV2, true> = { contractVersion: true, bindingId: true, version: true, heroId: true, ordinal: true, displayName: true, name: true, epithet: true, personality: true, appearance: true, portrait: true, avatarChosen: true, source: true, createdAtMs: true, updatedAtMs: true };
export const SPECTERS_KEYS: Record<keyof SpectersV2, true> = { contractVersion: true, items: true };
export const HEROES_ITEM_KEYS: Record<keyof HeroesItemV1, true> = { heroId: true, name: true, epithet: true, personality: true, assigned: true, assignedCount: true };
export const HEROES_KEYS: Record<keyof HeroesV1, true> = { contractVersion: true, items: true };

/** startedMs, endedMs and endSignal are null for an attempt that is no longer in the attempts record (present: false). */
export interface WorkAttemptV1 {
  attemptId: string;
  bindingId: string;
  kind: string;
  startedMs: number | null;
  endedMs: number | null;
  endSignal: string | null;
  ended: boolean;
  present: boolean;
}

export interface WorkContributorV1 {
  bindingId: string;
  attemptCount: number;
  xpNet: number;
}

export interface WorkMilestoneV1 {
  position: number;
  label: string;
  doneAtMs: number | null;
}

/** null on the item means progress is unknown. There is no percentage anywhere. */
export interface WorkProgressV1 {
  done: number;
  total: number;
}

/** blockers are tokens: no-evidence, attempts-not-ended, attempt-missing, children-not-accepted, wrong-state. */
export interface WorkReviewV1 {
  canAccept: boolean;
  blockers: string[];
}

/** action, fromState and toState are documented tokens, not closed lists. actor is always app-owner. */
export interface WorkDecisionV1 {
  decisionId: string;
  seq: number;
  action: string;
  fromState: string;
  toState: string;
  actor: 'app-owner';
  atMs: number;
  note: string | null;
  evidenceRevision: string | null;
}

export interface WorkItemV1 {
  contractVersion: 1;
  workId: string;
  parentId: string | null;
  title: string;
  acceptanceCondition: string;
  rewardable: boolean;
  bountyXp: number;
  policyVersion: string;
  /** A documented token, not a closed list: open, awaiting-review, blocked, rejected, cancelled, accepted, reopened. */
  state: string;
  version: number;
  createdAtMs: number;
  updatedAtMs: number;
  attempts: WorkAttemptV1[];
  contributors: WorkContributorV1[];
  milestones: WorkMilestoneV1[];
  progress: WorkProgressV1 | null;
  evidenceRevision: string;
  childCount: number;
  childrenAccepted: number;
  review: WorkReviewV1;
  decisions: WorkDecisionV1[];
}

export interface WorkItemsV1 {
  contractVersion: 1;
  items: WorkItemV1[];
  nextCursor: string | null;
  asOfMs: number;
}

/**
 * One work item as a list reads it (`GET /api/work?view=list`). The shared fields are the `work-item` v1 fields of the same name.
 * It has no acceptanceCondition, policyVersion, milestones, evidenceRevision, review or decisions: a screen that acts on an item
 * (review, accept, reject) must read the full `WorkItemV1` from `GET /api/work/{workId}`.
 * `everAccepted` is true when any decision on the item has action accept, now or earlier (it stays true after a reopen).
 */
export interface WorkListItemV1 {
  contractVersion: 1;
  workId: string;
  parentId: string | null;
  title: string;
  rewardable: boolean;
  bountyXp: number;
  /** A documented token, not a closed list: open, awaiting-review, blocked, rejected, cancelled, accepted, reopened. */
  state: string;
  version: number;
  createdAtMs: number;
  updatedAtMs: number;
  attempts: WorkAttemptV1[];
  contributors: WorkContributorV1[];
  progress: WorkProgressV1 | null;
  childCount: number;
  childrenAccepted: number;
  everAccepted: boolean;
}

/** Which order a `work-items` v2 page was read in. `created` is createdAtMs newest first; `updated` is updatedAtMs newest first. */
export type WorkListOrderV2 = 'created' | 'updated';

/** Body of GET /api/work?view=list[&order=created|updated]: one keyset page of at most 25 list items. A cursor only fits the order it came from. */
export interface WorkItemsV2 {
  contractVersion: 2;
  order: WorkListOrderV2;
  items: WorkListItemV1[];
  nextCursor: string | null;
  asOfMs: number;
}

export interface XpSummaryV1 {
  /**
   * 1 on the history route. `xp-summary.v2` (the paged read) is a superset with the same level fields, so a v2 body
   * is assignable here and every reader of `totalXp`, `level`, `levelFloorXp` and `nextLevelXp` takes either.
   */
  contractVersion: 1 | 2;
  bindingId: string;
  totalXp: number;
  level: number;
  levelTableVersion: string;
  levelFloorXp: number;
  nextLevelXp: number | null;
  acceptedWorkCount: number;
  policyVersion: string;
}

/**
 * One bot's derived total under `xp-summary.v2`: every v1 member, with `totalXp` net of both ledgers (`xp-policy-1`
 * history and `xp-policy-2` task awards). Task XP is credited automatically when a task ends cleanly and reflects
 * observed activity, not verified outcomes. `acceptedWorkCount` is the legacy count and never changes.
 */
export interface XpSummaryV2 extends XpSummaryV1 {
  contractVersion: 2;
  creditedTaskCount: number;
}

export interface XpSummariesV1 {
  contractVersion: 1;
  items: XpSummaryV1[];
  asOfMs: number;
}

/** Body of GET /api/xp?view=paged: one keyset page (200 at most, ascending bindingId) of every binding with an XP entry. Read pages until nextCursor is null. */
export interface XpSummariesV2 {
  contractVersion: 2;
  items: XpSummaryV1[];
  nextCursor: string | null;
  asOfMs: number;
}

/** Body of the paged XP read of `xp-summaries.v3`: one keyset page (200 at most, ascending bindingId) of `xp-summary.v2`. Read pages until nextCursor is null. */
export interface XpSummariesV3 {
  contractVersion: 3;
  items: XpSummaryV2[];
  nextCursor: string | null;
  asOfMs: number;
}

/** kind is a documented token: award, correction, reinstatement. amount is negative for a correction. */
export interface XpEntryV1 {
  entryId: string;
  workId: string;
  workTitle: string;
  kind: string;
  amount: number;
  policyVersion: string;
  decisionId: string;
  createdAtMs: number;
}

export interface XpHistoryV1 {
  contractVersion: 1;
  bindingId: string;
  summary: XpSummaryV1;
  items: XpEntryV1[];
  nextCursor: string | null;
  asOfMs: number;
}

export type TaskKindV1 = 'bot-turn' | 'worker';
export type TaskStateV1 = 'open' | 'credited' | 'not-credited';
export type TaskAttemptStateV1 = 'working' | 'ended' | 'unknown';
export type TaskCloseReasonV1 = 'clean-end' | 'unknown-terminal' | 'coverage-gap' | 'waiting-at-end';
export type TaskSizeClassV1 = 'small' | 'medium' | 'large';

/**
 * `task-item.v1`: one task the backend built from one observed attempt and closed out by itself. `credited` is final.
 * `runMs` is `endedAtMs - startedAtMs` when ended, else `asOfMs - startedAtMs`, and `sizeClass` is a function of it:
 * small below 120,000, medium below 900,000, large from 900,000. Size is presentation only.
 */
export interface TaskItemV1 {
  contractVersion: 1;
  taskId: string;
  bindingId: string;
  attemptId: string;
  kind: TaskKindV1;
  state: TaskStateV1;
  attemptState: TaskAttemptStateV1;
  closeReason: TaskCloseReasonV1 | null;
  startedAtMs: number;
  endedAtMs: number | null;
  closedAtMs: number | null;
  updatedAtMs: number;
  runMs: number;
  sizeClass: TaskSizeClassV1;
  xpCredited: number | null;
  policyVersion: string;
}

/** `tasks.v1`: `GET /api/tasks`, one keyset page of at most 25 tasks, `updatedAtMs` newest first. */
export interface TasksV1 {
  contractVersion: 1;
  items: TaskItemV1[];
  nextCursor: string | null;
  asOfMs: number;
}

export const WORK_ATTEMPT_KEYS: Record<keyof WorkAttemptV1, true> = { attemptId: true, bindingId: true, kind: true, startedMs: true, endedMs: true, endSignal: true, ended: true, present: true };
export const WORK_CONTRIBUTOR_KEYS: Record<keyof WorkContributorV1, true> = { bindingId: true, attemptCount: true, xpNet: true };
export const WORK_MILESTONE_KEYS: Record<keyof WorkMilestoneV1, true> = { position: true, label: true, doneAtMs: true };
export const WORK_PROGRESS_KEYS: Record<keyof WorkProgressV1, true> = { done: true, total: true };
export const WORK_REVIEW_KEYS: Record<keyof WorkReviewV1, true> = { canAccept: true, blockers: true };
export const WORK_DECISION_KEYS: Record<keyof WorkDecisionV1, true> = { decisionId: true, seq: true, action: true, fromState: true, toState: true, actor: true, atMs: true, note: true, evidenceRevision: true };
export const WORK_ITEM_KEYS: Record<keyof WorkItemV1, true> = { contractVersion: true, workId: true, parentId: true, title: true, acceptanceCondition: true, rewardable: true, bountyXp: true, policyVersion: true, state: true, version: true, createdAtMs: true, updatedAtMs: true, attempts: true, contributors: true, milestones: true, progress: true, evidenceRevision: true, childCount: true, childrenAccepted: true, review: true, decisions: true };
export const WORK_ITEMS_KEYS: Record<keyof WorkItemsV1, true> = { contractVersion: true, items: true, nextCursor: true, asOfMs: true };
export const WORK_LIST_ITEM_KEYS: Record<keyof WorkListItemV1, true> = { contractVersion: true, workId: true, parentId: true, title: true, rewardable: true, bountyXp: true, state: true, version: true, createdAtMs: true, updatedAtMs: true, attempts: true, contributors: true, progress: true, childCount: true, childrenAccepted: true, everAccepted: true };
export const WORK_ITEMS_V2_KEYS: Record<keyof WorkItemsV2, true> = { contractVersion: true, order: true, items: true, nextCursor: true, asOfMs: true };
export const XP_SUMMARY_KEYS: Record<keyof XpSummaryV1, true> = { contractVersion: true, bindingId: true, totalXp: true, level: true, levelTableVersion: true, levelFloorXp: true, nextLevelXp: true, acceptedWorkCount: true, policyVersion: true };
export const XP_SUMMARIES_KEYS: Record<keyof XpSummariesV1, true> = { contractVersion: true, items: true, asOfMs: true };
export const XP_SUMMARIES_PAGED_KEYS: Record<keyof XpSummariesV2, true> = { contractVersion: true, items: true, nextCursor: true, asOfMs: true };
export const XP_SUMMARY_TASK_VIEW_KEYS: Record<keyof XpSummaryV2, true> = { ...XP_SUMMARY_KEYS, creditedTaskCount: true };
export const XP_SUMMARIES_TASK_VIEW_KEYS: Record<keyof XpSummariesV3, true> = { contractVersion: true, items: true, nextCursor: true, asOfMs: true };
export const TASK_ITEM_KEYS: Record<keyof TaskItemV1, true> = {
  contractVersion: true,
  taskId: true,
  bindingId: true,
  attemptId: true,
  kind: true,
  state: true,
  attemptState: true,
  closeReason: true,
  startedAtMs: true,
  endedAtMs: true,
  closedAtMs: true,
  updatedAtMs: true,
  runMs: true,
  sizeClass: true,
  xpCredited: true,
  policyVersion: true,
};
export const TASKS_KEYS: Record<keyof TasksV1, true> = { contractVersion: true, items: true, nextCursor: true, asOfMs: true };
export const XP_ENTRY_KEYS: Record<keyof XpEntryV1, true> = { entryId: true, workId: true, workTitle: true, kind: true, amount: true, policyVersion: true, decisionId: true, createdAtMs: true };
export const XP_HISTORY_KEYS: Record<keyof XpHistoryV1, true> = { contractVersion: true, bindingId: true, summary: true, items: true, nextCursor: true, asOfMs: true };

// data-lifecycle v1 and collector-control v1 (FP-19). The schemas are owned by the backend PR-A and are DRAFT until
// PR-B freezes them; the key tables below join the schema-drift test in contracts.test.ts once those files exist.

/** The retention windows the store accepts; null (kept out of this type) means keep everything. */
export type RetentionDaysV1 = 30 | 90 | 180 | 365;

export interface DataRetentionV1 {
  retentionDays: RetentionDaysV1 | null;
  changedAtMs: number | null;
  revision: number;
}

/** What `POST /api/data/purge` would delete now. */
export interface DataPreviewV1 {
  cutoffMs: number;
  observations: number;
  quarantine: number;
  attempts: number;
}

export interface DataDeletedV1 {
  observations: number;
  quarantine: number;
  attempts: number;
  assets: number;
}

export type LifecycleRunKindV1 = 'purge' | 'asset-cleanup';
export type LifecycleRunStateV1 = 'running' | 'completed' | 'interrupted' | 'failed';

export interface DataRunV1 {
  kind: LifecycleRunKindV1;
  state: LifecycleRunStateV1;
  cutoffMs: number;
  startedMs: number;
  endedMs: number | null;
  deleted: DataDeletedV1;
}

/** One file under `data/exports/`; `fileName` is a bare name, never a path. */
export interface DataExportFileV1 {
  fileName: string;
  byteLength: number;
  sha256: string;
  createdMs: number;
}

export interface DataUploadsV1 {
  stored: number;
  cap: number;
  unused: number;
}

/** Body of GET /api/data and of every successful POST retention, POST purge, POST export and POST asset-cleanup. */
export interface DataLifecycleV1 {
  contractVersion: 1;
  asOfMs: number;
  retention: DataRetentionV1;
  horizonMs: number | null;
  preview: DataPreviewV1 | null;
  running: DataRunV1 | null;
  lastPurge: DataRunV1 | null;
  lastCleanup: DataRunV1 | null;
  lastExport: DataExportFileV1 | null;
  uploads: DataUploadsV1;
  exports: DataExportFileV1[];
  paused: boolean;
}

/** Body of POST /api/collector. `state` is the supervisor state after the call, a pattern string like `roster.v1.collector.state`. */
export interface CollectorControlV1 {
  contractVersion: 1;
  paused: boolean;
  revision: number;
  changedAtMs: number;
  state: string;
}

export const DATA_RETENTION_KEYS: Record<keyof DataRetentionV1, true> = { retentionDays: true, changedAtMs: true, revision: true };
export const DATA_PREVIEW_KEYS: Record<keyof DataPreviewV1, true> = { cutoffMs: true, observations: true, quarantine: true, attempts: true };
export const DATA_DELETED_KEYS: Record<keyof DataDeletedV1, true> = { observations: true, quarantine: true, attempts: true, assets: true };
export const DATA_RUN_KEYS: Record<keyof DataRunV1, true> = { kind: true, state: true, cutoffMs: true, startedMs: true, endedMs: true, deleted: true };
export const DATA_EXPORT_FILE_KEYS: Record<keyof DataExportFileV1, true> = { fileName: true, byteLength: true, sha256: true, createdMs: true };
export const DATA_UPLOADS_KEYS: Record<keyof DataUploadsV1, true> = { stored: true, cap: true, unused: true };
export const DATA_LIFECYCLE_KEYS: Record<keyof DataLifecycleV1, true> = {
  contractVersion: true,
  asOfMs: true,
  retention: true,
  horizonMs: true,
  preview: true,
  running: true,
  lastPurge: true,
  lastCleanup: true,
  lastExport: true,
  uploads: true,
  exports: true,
  paused: true,
};
export const COLLECTOR_CONTROL_KEYS: Record<keyof CollectorControlV1, true> = { contractVersion: true, paused: true, revision: true, changedAtMs: true, state: true };
