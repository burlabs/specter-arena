-- 0005 specter identity: the cosmetic identity of a bot (one active Specter per binding), its
-- immutable revision history, the bounded generation requests that can produce a candidate, and
-- immutable content-addressed PNG assets. Nothing here is observation, attempt or coverage data
-- and no migration-time statement touches the earlier tables. Only `specter` and
-- `generation_request` are ever updated, and both are guarded by triggers.
CREATE TABLE asset (
  asset_id    TEXT NOT NULL PRIMARY KEY CHECK (
    length(asset_id) = 28 AND asset_id GLOB 'ast_*' AND asset_id = 'ast_' || substr(sha256, 1, 24)
  ),
  sha256      TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  media_type  TEXT NOT NULL CHECK (media_type = 'image/png'),
  width       INTEGER NOT NULL CHECK (width BETWEEN 1 AND 1024),
  height      INTEGER NOT NULL CHECK (height BETWEEN 1 AND 1024),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 1048576),
  origin      TEXT NOT NULL CHECK (origin IN ('bundled', 'uploaded')),
  label       TEXT NOT NULL CHECK (length(label) <= 80),
  bytes       BLOB NOT NULL CHECK (
    typeof(bytes) = 'blob' AND length(bytes) = byte_length
    AND substr(bytes, 1, 8) = x'89504e470d0a1a0a'
  ),
  created_ms  INTEGER NOT NULL CHECK (created_ms >= 0)
) STRICT;

CREATE TRIGGER asset_immutable BEFORE UPDATE ON asset
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER asset_keep BEFORE DELETE ON asset
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TABLE generation_request (
  request_id     TEXT NOT NULL PRIMARY KEY CHECK (
    length(request_id) = 28 AND request_id GLOB 'req_*' AND substr(request_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  binding_id     TEXT NOT NULL REFERENCES bot_binding (binding_id),
  status         TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'ready', 'failed', 'cancelled', 'accepted', 'superseded')
  ),
  keep_json      TEXT NOT NULL CHECK (
    json_valid(keep_json) AND json_type(keep_json) = 'array' AND length(keep_json) <= 256
  ),
  prompt_version TEXT NOT NULL CHECK (length(prompt_version) BETWEEN 1 AND 32),
  model_label    TEXT CHECK (model_label IS NULL OR length(model_label) <= 64),
  candidate_json TEXT CHECK (
    candidate_json IS NULL
    OR (
      json_valid(candidate_json) AND json_type(candidate_json) = 'object'
      AND length(CAST(candidate_json AS BLOB)) <= 16384
    )
  ),
  error_code     TEXT CHECK (
    error_code IS NULL OR (length(error_code) BETWEEN 1 AND 40 AND error_code NOT GLOB '*[^a-z0-9_-]*')
  ),
  attempts       INTEGER NOT NULL CHECK (attempts BETWEEN 0 AND 8),
  internal_tag   TEXT NOT NULL CHECK (internal_tag = 'summoning'),
  created_ms     INTEGER NOT NULL CHECK (created_ms >= 0),
  started_ms     INTEGER CHECK (started_ms IS NULL OR started_ms >= created_ms),
  finished_ms    INTEGER CHECK (finished_ms IS NULL OR finished_ms >= created_ms),
  CHECK (started_ms IS NULL OR finished_ms IS NULL OR finished_ms >= started_ms),
  CHECK (
    (status = 'queued' AND started_ms IS NULL AND finished_ms IS NULL
      AND candidate_json IS NULL AND error_code IS NULL)
    OR (status = 'running' AND started_ms IS NOT NULL AND finished_ms IS NULL
      AND candidate_json IS NULL AND error_code IS NULL)
    OR (status IN ('ready', 'accepted', 'superseded') AND started_ms IS NOT NULL
      AND finished_ms IS NOT NULL AND candidate_json IS NOT NULL AND error_code IS NULL)
    OR (status = 'failed' AND finished_ms IS NOT NULL
      AND candidate_json IS NULL AND error_code IS NOT NULL)
    OR (status = 'cancelled' AND finished_ms IS NOT NULL
      AND candidate_json IS NULL AND error_code IS NULL)
  )
) STRICT;

CREATE INDEX generation_request_by_binding ON generation_request (binding_id, created_ms);

CREATE INDEX generation_request_by_status ON generation_request (status);

CREATE INDEX generation_request_started ON generation_request (started_ms)
  WHERE started_ms IS NOT NULL;

CREATE TRIGGER generation_request_transition BEFORE UPDATE ON generation_request
WHEN NEW.request_id <> OLD.request_id OR NEW.binding_id <> OLD.binding_id
  OR NEW.keep_json <> OLD.keep_json OR NEW.prompt_version <> OLD.prompt_version
  OR NEW.internal_tag <> OLD.internal_tag OR NEW.created_ms <> OLD.created_ms
  OR NOT (
    (OLD.status = 'queued' AND NEW.status IN ('running', 'failed', 'cancelled'))
    OR (OLD.status = 'running' AND NEW.status IN ('ready', 'failed', 'cancelled'))
    OR (OLD.status = 'ready' AND NEW.status IN ('accepted', 'superseded', 'cancelled'))
  )
BEGIN SELECT RAISE(ABORT, 'illegal transition'); END;

CREATE TRIGGER generation_request_keep BEFORE DELETE ON generation_request
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TABLE specter (
  specter_id  TEXT NOT NULL PRIMARY KEY CHECK (
    length(specter_id) = 28 AND specter_id GLOB 'spc_*' AND substr(specter_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  binding_id  TEXT NOT NULL REFERENCES bot_binding (binding_id),
  version     INTEGER NOT NULL CHECK (version >= 1),
  archived_ms INTEGER CHECK (archived_ms IS NULL OR archived_ms >= 0),
  created_ms  INTEGER NOT NULL CHECK (created_ms >= 0),
  updated_ms  INTEGER NOT NULL CHECK (updated_ms >= created_ms)
) STRICT;

CREATE UNIQUE INDEX specter_one_active ON specter (binding_id) WHERE archived_ms IS NULL;

CREATE INDEX specter_by_binding ON specter (binding_id, created_ms);

CREATE TRIGGER specter_guard BEFORE UPDATE ON specter
WHEN NEW.specter_id <> OLD.specter_id OR NEW.binding_id <> OLD.binding_id
  OR NEW.created_ms <> OLD.created_ms OR NEW.version <> OLD.version + 1
  OR OLD.archived_ms IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'illegal specter update'); END;

CREATE TRIGGER specter_keep BEFORE DELETE ON specter
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TABLE specter_revision (
  revision_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  specter_id     TEXT NOT NULL REFERENCES specter (specter_id),
  revision_no    INTEGER NOT NULL CHECK (revision_no >= 1),
  change         TEXT NOT NULL CHECK (
    change IN ('generated', 'manual', 'renamed', 'portrait', 'archived')
  ),
  profile_json   TEXT NOT NULL CHECK (
    json_valid(profile_json) AND json_type(profile_json) = 'object'
    AND length(CAST(profile_json AS BLOB)) <= 16384
  ),
  asset_id       TEXT REFERENCES asset (asset_id),
  source         TEXT NOT NULL CHECK (source IN ('generated', 'manual')),
  request_id     TEXT REFERENCES generation_request (request_id),
  prompt_version TEXT CHECK (prompt_version IS NULL OR length(prompt_version) BETWEEN 1 AND 32),
  created_ms     INTEGER NOT NULL CHECK (created_ms >= 0),
  UNIQUE (specter_id, revision_no),
  CHECK (revision_no > 1 OR change IN ('generated', 'manual')),
  CHECK (change <> 'generated' OR (request_id IS NOT NULL AND source = 'generated')),
  CHECK (change <> 'manual' OR (request_id IS NULL AND source = 'manual')),
  CHECK (change IN ('generated', 'manual') OR request_id IS NULL),
  CHECK ((source = 'manual') = (prompt_version IS NULL))
) STRICT;

CREATE UNIQUE INDEX specter_revision_request ON specter_revision (request_id)
  WHERE request_id IS NOT NULL;

CREATE TRIGGER specter_revision_sequence BEFORE INSERT ON specter_revision
WHEN NEW.revision_no <> (SELECT version FROM specter WHERE specter_id = NEW.specter_id)
BEGIN SELECT RAISE(ABORT, 'revision out of sequence'); END;

CREATE TRIGGER specter_revision_immutable BEFORE UPDATE ON specter_revision
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER specter_revision_keep BEFORE DELETE ON specter_revision
BEGIN SELECT RAISE(ABORT, 'append-only'); END;
