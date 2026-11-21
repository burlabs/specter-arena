-- 0009 data lifecycle (FP-19): the owner can set a retention window, run an explicit purge of old
-- observations, quarantine rows and unlinked ended attempts, and remove unused uploaded assets.
-- Nothing here deletes a row; the migration only adds two tables and replaces three DELETE guards.
--
-- Until now every evidence table aborted every DELETE. The three guards below (`observation_keep`,
-- `quarantine_keep`, `asset_keep`) now let a DELETE through only while a `lifecycle_run` of the
-- matching kind is `running` and the row is older than that run's cutoff (an asset must also be
-- uploaded and referenced by no `avatar_revision`). The guard stays in SQL, so a code bug cannot
-- delete identity, hero assignment, avatar history, work items, decisions or the XP ledger: their
-- own `*_keep` triggers are untouched. The purge horizon is read as the largest cutoff of any
-- purge run that deleted a row.
CREATE TABLE lifecycle_run (
  run_id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kind                 TEXT NOT NULL CHECK (kind IN ('purge', 'asset-cleanup')),
  state                TEXT NOT NULL CHECK (state IN ('running', 'completed', 'interrupted', 'failed')),
  cutoff_ms            INTEGER NOT NULL CHECK (cutoff_ms >= 0),
  started_ms           INTEGER NOT NULL CHECK (started_ms >= 0),
  ended_ms             INTEGER CHECK (ended_ms IS NULL OR ended_ms >= started_ms),
  deleted_observations INTEGER NOT NULL DEFAULT 0 CHECK (deleted_observations >= 0),
  deleted_quarantine   INTEGER NOT NULL DEFAULT 0 CHECK (deleted_quarantine >= 0),
  deleted_attempts     INTEGER NOT NULL DEFAULT 0 CHECK (deleted_attempts >= 0),
  deleted_assets       INTEGER NOT NULL DEFAULT 0 CHECK (deleted_assets >= 0),
  CHECK ((state = 'running') = (ended_ms IS NULL))
) STRICT;

-- At most one run is open at a time.
CREATE UNIQUE INDEX lifecycle_one_running ON lifecycle_run (state) WHERE state = 'running';

CREATE TRIGGER lifecycle_run_guard BEFORE UPDATE ON lifecycle_run
WHEN OLD.state <> 'running'
  OR NEW.run_id <> OLD.run_id OR NEW.kind <> OLD.kind
  OR NEW.cutoff_ms <> OLD.cutoff_ms OR NEW.started_ms <> OLD.started_ms
  OR NEW.deleted_observations < OLD.deleted_observations
  OR NEW.deleted_quarantine < OLD.deleted_quarantine
  OR NEW.deleted_attempts < OLD.deleted_attempts
  OR NEW.deleted_assets < OLD.deleted_assets
BEGIN SELECT RAISE(ABORT, 'illegal lifecycle update'); END;

CREATE TRIGGER lifecycle_run_keep BEFORE DELETE ON lifecycle_run
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TABLE retention_setting (
  singleton     INTEGER PRIMARY KEY CHECK (singleton = 1),
  retention_days INTEGER CHECK (retention_days IS NULL OR retention_days IN (30, 90, 180, 365)),
  changed_at_ms INTEGER CHECK (changed_at_ms IS NULL OR changed_at_ms >= 0),
  revision      INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

-- Seed: keep everything, never changed.
INSERT INTO retention_setting (singleton, retention_days, changed_at_ms, revision)
VALUES (1, NULL, NULL, 0);

CREATE TRIGGER retention_setting_guard BEFORE UPDATE ON retention_setting
WHEN NEW.singleton <> OLD.singleton OR NEW.revision <> OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'illegal retention update'); END;

CREATE TRIGGER retention_setting_keep BEFORE DELETE ON retention_setting
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

DROP TRIGGER observation_keep;

CREATE TRIGGER observation_keep BEFORE DELETE ON observation
WHEN NOT EXISTS (
  SELECT 1 FROM lifecycle_run r
  WHERE r.kind = 'purge' AND r.state = 'running' AND OLD.received_at_ms < r.cutoff_ms
)
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

DROP TRIGGER quarantine_keep;

CREATE TRIGGER quarantine_keep BEFORE DELETE ON quarantine
WHEN NOT EXISTS (
  SELECT 1 FROM lifecycle_run r
  WHERE r.kind = 'purge' AND r.state = 'running' AND OLD.received_at_ms < r.cutoff_ms
)
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

DROP TRIGGER asset_keep;

CREATE TRIGGER asset_keep BEFORE DELETE ON asset
WHEN NOT (
  OLD.origin = 'uploaded'
  AND NOT EXISTS (SELECT 1 FROM avatar_revision v WHERE v.asset_id = OLD.asset_id)
  AND EXISTS (
    SELECT 1 FROM lifecycle_run r
    WHERE r.kind = 'asset-cleanup' AND r.state = 'running' AND OLD.created_ms < r.cutoff_ms
  )
)
BEGIN SELECT RAISE(ABORT, 'append-only'); END;
