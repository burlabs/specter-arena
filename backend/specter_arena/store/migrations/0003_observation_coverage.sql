-- 0003 observation and coverage: append-only evidence (observation, quarantine), collector run
-- bookkeeping, coverage intervals and the collector settings row. Closed vocabularies other than
-- `origin` are validated in code so a new event type never needs a table rebuild.
CREATE TABLE observation (
  seq              INTEGER PRIMARY KEY AUTOINCREMENT,
  binding_id       TEXT NOT NULL REFERENCES bot_binding (binding_id),
  kind             TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 16),
  event_type       TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 40),
  source           TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 24),
  slot_key         TEXT NOT NULL CHECK (length(slot_key) BETWEEN 1 AND 256),
  turn             INTEGER CHECK (turn IS NULL OR turn >= 0),
  turn_gen         TEXT CHECK (
    turn_gen IS NULL
    OR (length(turn_gen) BETWEEN 1 AND 16 AND turn_gen NOT GLOB '*[^0-9a-f]*')
  ),
  tool_call_id     TEXT CHECK (tool_call_id IS NULL OR length(tool_call_id) <= 128),
  dedup_key        TEXT CHECK (dedup_key IS NULL OR length(dedup_key) BETWEEN 1 AND 512),
  fact_digest      TEXT CHECK (fact_digest IS NULL OR length(fact_digest) = 64),
  received_at_ms   INTEGER NOT NULL CHECK (received_at_ms >= 0),
  source_time_ms   INTEGER CHECK (source_time_ms IS NULL OR source_time_ms >= 0),
  origin           TEXT NOT NULL CHECK (origin IN ('live', 'recorded', 'fixture')),
  contract_version INTEGER NOT NULL CHECK (contract_version >= 1),
  payload          TEXT NOT NULL CHECK (
    json_valid(payload) AND length(CAST(payload AS BLOB)) <= 65536
  )
) STRICT;

CREATE UNIQUE INDEX observation_event_dedup ON observation (binding_id, event_type, dedup_key)
  WHERE dedup_key IS NOT NULL;

CREATE INDEX observation_row_latest ON observation (binding_id, slot_key, seq)
  WHERE kind = 'row-change';

CREATE INDEX observation_by_binding ON observation (binding_id, seq);

CREATE TRIGGER observation_immutable BEFORE UPDATE ON observation
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER observation_keep BEFORE DELETE ON observation
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TABLE quarantine (
  seq                  INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id               TEXT NOT NULL,
  received_at_ms       INTEGER NOT NULL CHECK (received_at_ms >= 0),
  reason               TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 40),
  frame_type           TEXT NOT NULL CHECK (length(frame_type) BETWEEN 1 AND 64),
  size_bytes           INTEGER NOT NULL CHECK (size_bytes >= 0),
  digest               TEXT CHECK (
    digest IS NULL
    OR (
      length(digest) = 19
      AND digest GLOB 'sha256:[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
    )
  ),
  count                INTEGER NOT NULL DEFAULT 1 CHECK (count BETWEEN 1 AND 2147483648),
  first_received_at_ms INTEGER NOT NULL CHECK (first_received_at_ms >= 0),
  CHECK (first_received_at_ms <= received_at_ms)
) STRICT;

CREATE TRIGGER quarantine_immutable BEFORE UPDATE ON quarantine
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER quarantine_keep BEFORE DELETE ON quarantine
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TABLE collector_run (
  run_id            TEXT PRIMARY KEY CHECK (length(run_id) BETWEEN 8 AND 64),
  started_ms        INTEGER NOT NULL CHECK (started_ms >= 0),
  last_heartbeat_ms INTEGER NOT NULL CHECK (last_heartbeat_ms >= 0),
  ended_ms          INTEGER CHECK (ended_ms IS NULL OR ended_ms >= 0),
  end_reason        TEXT CHECK (end_reason IS NULL OR length(end_reason) <= 40),
  roster_checked_ms INTEGER CHECK (roster_checked_ms IS NULL OR roster_checked_ms >= 0),
  roster_ok         INTEGER CHECK (roster_ok IS NULL OR roster_ok IN (0, 1)),
  roster_reason     TEXT CHECK (roster_reason IS NULL OR length(roster_reason) <= 40)
) STRICT;

CREATE TABLE coverage_interval (
  interval_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         TEXT NOT NULL REFERENCES collector_run (run_id),
  state          TEXT NOT NULL CHECK (state IN ('covered', 'gap')),
  start_ms       INTEGER NOT NULL CHECK (start_ms >= 0),
  end_ms         INTEGER,
  reason         TEXT CHECK (reason IS NULL OR length(reason) <= 40),
  dropped_json   TEXT CHECK (
    dropped_json IS NULL OR (json_valid(dropped_json) AND length(dropped_json) <= 512)
  ),
  source_from_ms INTEGER CHECK (source_from_ms IS NULL OR source_from_ms >= 0),
  source_to_ms   INTEGER CHECK (source_to_ms IS NULL OR source_to_ms >= 0),
  CHECK (end_ms IS NULL OR end_ms >= start_ms),
  CHECK (state = 'covered' OR reason IS NOT NULL)
) STRICT;

CREATE UNIQUE INDEX coverage_open_covered ON coverage_interval (run_id)
  WHERE state = 'covered' AND end_ms IS NULL;

CREATE UNIQUE INDEX coverage_open_gap ON coverage_interval (run_id)
  WHERE state = 'gap' AND end_ms IS NULL;

CREATE INDEX coverage_by_run ON coverage_interval (run_id, interval_id);

CREATE TABLE collector_setting (
  singleton     INTEGER PRIMARY KEY CHECK (singleton = 1),
  paused        INTEGER NOT NULL CHECK (paused IN (0, 1)),
  changed_at_ms INTEGER NOT NULL CHECK (changed_at_ms >= 0),
  revision      INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

INSERT INTO collector_setting (singleton, paused, changed_at_ms, revision)
VALUES (1, 0, 0, 0);
