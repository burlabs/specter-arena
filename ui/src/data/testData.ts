import type { DataExportFileV1, DataLifecycleV1, DataRunV1 } from '../contracts/types';

export const NOW_MS = 1_794_916_800_000;

export const runOf = (extra: Partial<DataRunV1> = {}): DataRunV1 => ({
  kind: 'purge',
  state: 'completed',
  cutoffMs: NOW_MS - 90 * 86_400_000,
  startedMs: NOW_MS - 60_000,
  endedMs: NOW_MS - 56_000,
  deleted: { observations: 5200, quarantine: 12, attempts: 410, assets: 0 },
  ...extra,
});

export const exportOf = (n: number, extra: Partial<DataExportFileV1> = {}): DataExportFileV1 => ({
  fileName: `export-v9-2026111${n}T010203Z.db`,
  byteLength: 4_194_304,
  sha256: String(n).repeat(64).slice(0, 64),
  createdMs: NOW_MS - n * 3_600_000,
  ...extra,
});

/** A valid `data-lifecycle` v1 body: keep everything, nothing stored, collection running. */
export const dataBody = (extra: Partial<DataLifecycleV1> = {}): DataLifecycleV1 => ({
  contractVersion: 1,
  asOfMs: NOW_MS,
  retention: { retentionDays: null, changedAtMs: null, revision: 0 },
  horizonMs: null,
  preview: null,
  running: null,
  lastPurge: null,
  lastCleanup: null,
  lastExport: null,
  uploads: { stored: 0, cap: 100, unused: 0 },
  exports: [],
  paused: false,
  ...extra,
});
