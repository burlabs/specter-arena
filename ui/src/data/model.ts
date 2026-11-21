import type {
  CollectorControlV1,
  DataDeletedV1,
  DataExportFileV1,
  DataLifecycleV1,
  DataRunV1,
  RetentionDaysV1,
} from '../contracts/types';

export class DataShapeError extends Error {}

/** The windows the store accepts. `null` is "Keep everything" and is never purged. */
export const RETENTION_CHOICES: readonly RetentionDaysV1[] = [30, 90, 180, 365];
export const DAY_MS = 86_400_000;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isText = (value: unknown): value is string => typeof value === 'string';
const isNullableTime = (value: unknown): value is number | null => value === null || isCount(value);

const isRetentionDays = (value: unknown): value is RetentionDaysV1 | null =>
  value === null || (typeof value === 'number' && (RETENTION_CHOICES as readonly number[]).includes(value));

function isDeleted(value: unknown): value is DataDeletedV1 {
  return isObject(value) && isCount(value.observations) && isCount(value.quarantine) && isCount(value.attempts) && isCount(value.assets);
}

const RUN_KINDS = ['purge', 'asset-cleanup'];
const RUN_STATES = ['running', 'completed', 'interrupted', 'failed'];

function isRun(value: unknown): value is DataRunV1 {
  return (
    isObject(value) &&
    isText(value.kind) &&
    RUN_KINDS.includes(value.kind) &&
    isText(value.state) &&
    RUN_STATES.includes(value.state) &&
    isCount(value.cutoffMs) &&
    isCount(value.startedMs) &&
    isNullableTime(value.endedMs) &&
    isDeleted(value.deleted)
  );
}

const SHA256 = /^[0-9a-f]{64}$/;
/** A bare file name under data/exports/. A path separator or a dot-only name is refused so the panel never prints a path the app did not write. */
const EXPORT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isExportFile(value: unknown): value is DataExportFileV1 {
  return (
    isObject(value) &&
    isText(value.fileName) &&
    EXPORT_NAME.test(value.fileName) &&
    isCount(value.byteLength) &&
    isText(value.sha256) &&
    SHA256.test(value.sha256) &&
    isCount(value.createdMs)
  );
}

const nullOr = <T>(value: unknown, check: (candidate: unknown) => candidate is T): value is T | null => value === null || check(value);

/** Body of `GET /api/data` and of every successful write on the Data routes. Anything else is a fault, not data. */
export function parseDataLifecycle(body: unknown): DataLifecycleV1 {
  if (!isObject(body) || body.contractVersion !== 1) throw new DataShapeError('unexpected data body');
  const { retention, preview, uploads, exports } = body;
  if (
    !isCount(body.asOfMs) ||
    !isObject(retention) ||
    !isRetentionDays(retention.retentionDays) ||
    !isNullableTime(retention.changedAtMs) ||
    !isCount(retention.revision) ||
    !isNullableTime(body.horizonMs) ||
    !(preview === null || (isObject(preview) && isCount(preview.cutoffMs) && isCount(preview.observations) && isCount(preview.quarantine) && isCount(preview.attempts))) ||
    !nullOr(body.running, isRun) ||
    !nullOr(body.lastPurge, isRun) ||
    !nullOr(body.lastCleanup, isRun) ||
    !nullOr(body.lastExport, isExportFile) ||
    !isObject(uploads) ||
    !isCount(uploads.stored) ||
    !isCount(uploads.cap) ||
    !isCount(uploads.unused) ||
    !Array.isArray(exports) ||
    exports.length > 20 ||
    !exports.every(isExportFile) ||
    typeof body.paused !== 'boolean'
  ) {
    throw new DataShapeError('unexpected data body');
  }
  return body as unknown as DataLifecycleV1;
}

/** Body of `POST /api/collector`. */
export function parseCollectorControl(body: unknown): CollectorControlV1 {
  if (!isObject(body) || body.contractVersion !== 1 || typeof body.paused !== 'boolean' || !isCount(body.revision) || !isCount(body.changedAtMs) || !isText(body.state)) {
    throw new DataShapeError('unexpected collector body');
  }
  return body as unknown as CollectorControlV1;
}

/** `Intl`-free byte sizes so the text never depends on the browser's locale tables. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

/** What a purge of the preview would remove, as one number. Zero means the button has nothing to do. */
export const previewTotal = (preview: { observations: number; quarantine: number; attempts: number }): number => preview.observations + preview.quarantine + preview.attempts;

const plural = (count: number, one: string, many: string): string => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

export const observationWords = (count: number): string => plural(count, 'observation', 'observations');
export const quarantineWords = (count: number): string => plural(count, 'quarantined record', 'quarantined records');
export const attemptWords = (count: number): string => plural(count, 'attempt record', 'attempt records');
export const uploadWords = (count: number): string => plural(count, 'uploaded image', 'uploaded images');
