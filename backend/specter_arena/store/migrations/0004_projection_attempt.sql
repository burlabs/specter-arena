-- 0004 projection and attempt: tables that `rebuild_projection` empties and refills from the
-- append-only observations, plus `slot_seen`, volatile bookkeeping that is neither evidence nor
-- rebuilt.
CREATE TABLE bot_state (
  binding_id         TEXT PRIMARY KEY REFERENCES bot_binding (binding_id),
  dm_slot_key        TEXT NOT NULL CHECK (length(dm_slot_key) BETWEEN 1 AND 256),
  running            INTEGER CHECK (running IS NULL OR running IN (0, 1)),
  turn               INTEGER CHECK (turn IS NULL OR turn >= 0),
  turn_gen           TEXT,
  pending_approval   INTEGER CHECK (pending_approval IS NULL OR pending_approval IN (0, 1)),
  needs_input        INTEGER CHECK (needs_input IS NULL OR needs_input IN (0, 1)),
  has_options        INTEGER CHECK (has_options IS NULL OR has_options IN (0, 1)),
  waiting_for_input  INTEGER CHECK (waiting_for_input IS NULL OR waiting_for_input IN (0, 1)),
  interrupted        INTEGER CHECK (interrupted IS NULL OR interrupted IN (0, 1)),
  last_activity_ms   INTEGER CHECK (last_activity_ms IS NULL OR last_activity_ms >= 0),
  row_observed_ms    INTEGER CHECK (row_observed_ms IS NULL OR row_observed_ms >= 0),
  event_observed_ms  INTEGER CHECK (event_observed_ms IS NULL OR event_observed_ms >= 0),
  last_terminal_turn INTEGER CHECK (last_terminal_turn IS NULL OR last_terminal_turn >= 0),
  last_terminal_gen  TEXT,
  extra_facts        TEXT NOT NULL CHECK (json_valid(extra_facts) AND length(extra_facts) <= 2048),
  row_digest         TEXT,
  observed_seq       INTEGER NOT NULL CHECK (observed_seq >= 0)
) STRICT;

CREATE TABLE attempt (
  attempt_id TEXT PRIMARY KEY CHECK (length(attempt_id) = 28 AND attempt_id GLOB 'att_*'),
  binding_id TEXT NOT NULL REFERENCES bot_binding (binding_id),
  kind       TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 16),
  slot_key   TEXT NOT NULL CHECK (length(slot_key) BETWEEN 1 AND 256),
  started_ms INTEGER NOT NULL CHECK (started_ms >= 0),
  started_seq INTEGER NOT NULL CHECK (started_seq >= 1),
  ended_ms   INTEGER CHECK (ended_ms IS NULL OR ended_ms >= 0),
  ended_seq  INTEGER CHECK (ended_seq IS NULL OR ended_seq >= 1),
  end_signal TEXT CHECK (end_signal IS NULL OR length(end_signal) <= 24),
  running    INTEGER NOT NULL CHECK (running IN (0, 1))
) STRICT;

CREATE INDEX attempt_by_binding ON attempt (binding_id, kind);

CREATE TABLE slot_seen (
  binding_id       TEXT NOT NULL REFERENCES bot_binding (binding_id),
  slot_key         TEXT NOT NULL CHECK (length(slot_key) BETWEEN 1 AND 256),
  last_seen_ms     INTEGER NOT NULL CHECK (last_seen_ms >= 0),
  last_activity_ms INTEGER CHECK (last_activity_ms IS NULL OR last_activity_ms >= 0),
  PRIMARY KEY (binding_id, slot_key)
) STRICT, WITHOUT ROWID;
