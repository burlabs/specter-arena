-- FROZEN: a store as released at schema version 4, with fixed seed rows. Never edit this file;
-- when 0005 ships, add schema-v5.sql for the next upgrade test instead.
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY CHECK (version >= 1),
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
  sha256     TEXT NOT NULL CHECK (length(sha256) = 64),
  applied_at TEXT NOT NULL CHECK (length(applied_at) = 20)
) STRICT;

CREATE TABLE store_meta (
  singleton         INTEGER PRIMARY KEY CHECK (singleton = 1),
  store_id          TEXT NOT NULL CHECK (length(store_id) = 36),
  created_at        TEXT NOT NULL CHECK (length(created_at) = 20),
  app_schema_family TEXT NOT NULL CHECK (app_schema_family = 'specter-arena')
) STRICT;

CREATE UNIQUE INDEX store_meta_store_id ON store_meta (store_id);

CREATE TABLE bot_binding (
  binding_seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  binding_id      TEXT NOT NULL UNIQUE CHECK (length(binding_id) = 28 AND binding_id GLOB 'bnd_*'),
  installation_id TEXT NOT NULL REFERENCES store_meta (store_id),
  dm_key          TEXT NOT NULL CHECK (length(dm_key) BETWEEN 8 AND 256),
  member_id       TEXT NOT NULL CHECK (
    length(member_id) BETWEEN 1 AND 80
    AND member_id NOT GLOB '*[^a-z0-9-]*'
    AND member_id NOT GLOB '-*'
    AND member_id NOT GLOB '*-'
  ),
  memory_store    TEXT NOT NULL CHECK (length(memory_store) <= 128),
  first_seen_ms   INTEGER NOT NULL CHECK (first_seen_ms >= 0),
  CHECK (
    dm_key = 'member-' || member_id
      || CASE WHEN memory_store = '' THEN '' ELSE '.memory-' || memory_store END
  ),
  UNIQUE (installation_id, dm_key)
) STRICT;

CREATE UNIQUE INDEX bot_binding_store ON bot_binding (installation_id, memory_store)
  WHERE memory_store <> '';

CREATE TRIGGER bot_binding_immutable BEFORE UPDATE ON bot_binding
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER bot_binding_keep BEFORE DELETE ON bot_binding
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TABLE bot_display_revision (
  revision_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  binding_id   TEXT NOT NULL REFERENCES bot_binding (binding_id),
  revision_no  INTEGER NOT NULL CHECK (revision_no >= 1),
  name         TEXT NOT NULL CHECK (length(name) <= 128),
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) <= 128),
  avatar_kind  TEXT CHECK (avatar_kind IS NULL OR length(avatar_kind) BETWEEN 1 AND 32),
  avatar_ref   TEXT CHECK (avatar_ref IS NULL OR length(avatar_ref) BETWEEN 1 AND 128),
  observed_ms  INTEGER NOT NULL CHECK (observed_ms >= 0),
  UNIQUE (binding_id, revision_no)
) STRICT;

CREATE TRIGGER bot_display_revision_immutable BEFORE UPDATE ON bot_display_revision
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER bot_display_revision_keep BEFORE DELETE ON bot_display_revision
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TABLE bot_presence (
  presence_id INTEGER PRIMARY KEY AUTOINCREMENT,
  binding_id  TEXT NOT NULL REFERENCES bot_binding (binding_id),
  state       TEXT NOT NULL CHECK (state IN ('present', 'absent')),
  since_ms    INTEGER NOT NULL CHECK (since_ms >= 0)
) STRICT;

CREATE INDEX bot_presence_latest ON bot_presence (binding_id, presence_id);

CREATE TRIGGER bot_presence_immutable BEFORE UPDATE ON bot_presence
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER bot_presence_keep BEFORE DELETE ON bot_presence
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TABLE binding_rebind (
  rebind_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  from_binding_id TEXT NOT NULL UNIQUE REFERENCES bot_binding (binding_id),
  to_binding_id   TEXT NOT NULL REFERENCES bot_binding (binding_id),
  decided_at_ms   INTEGER NOT NULL CHECK (decided_at_ms >= 0),
  note            TEXT CHECK (note IS NULL OR length(note) <= 200),
  CHECK (from_binding_id <> to_binding_id)
) STRICT;

CREATE TRIGGER binding_rebind_immutable BEFORE UPDATE ON binding_rebind
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER binding_rebind_keep BEFORE DELETE ON binding_rebind
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

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

INSERT INTO schema_migrations (version, name, sha256, applied_at)
VALUES (1, 'baseline', 'fef6c7529554b4a1d2179f1e177f59b09335d65a998611aefea01de17255e570', '2026-01-01T00:00:00Z');

INSERT INTO schema_migrations (version, name, sha256, applied_at)
VALUES (2, 'bot_binding', '5a11cf301571e93b718ae628dd1d2681d493a1ef71784b9566cc350b20c78f3a', '2026-01-02T00:00:00Z');

INSERT INTO schema_migrations (version, name, sha256, applied_at)
VALUES (3, 'observation_coverage', 'fb4c2b6e0802468abf37da643d358e7d8f0fbf61ac6722efacdf5a9f017d5424', '2026-01-03T00:00:00Z');

INSERT INTO schema_migrations (version, name, sha256, applied_at)
VALUES (4, 'projection_attempt', '8c5eb2674bc7330fb0f493115c6722b3fa66c804530aa5a61d0c492fa0bf250c', '2026-01-04T00:00:00Z');

INSERT INTO store_meta (singleton, store_id, created_at, app_schema_family)
VALUES (1, '00000000-0000-4000-8000-000000000004', '2026-01-01T00:00:00Z', 'specter-arena');

INSERT INTO bot_binding (binding_id, installation_id, dm_key, member_id, memory_store, first_seen_ms)
VALUES (
  'bnd_000000000000000000000001',
  '00000000-0000-4000-8000-000000000004',
  'member-fixture-bot.memory-fixture-store',
  'fixture-bot',
  'fixture-store',
  1767225600000
);

INSERT INTO bot_display_revision (binding_id, revision_no, name, display_name, avatar_kind, avatar_ref, observed_ms)
VALUES ('bnd_000000000000000000000001', 1, 'fixture-bot', 'Fixture Bot', 'ghost', NULL, 1767225601000);

INSERT INTO bot_presence (binding_id, state, since_ms)
VALUES ('bnd_000000000000000000000001', 'present', 1767225601000);

INSERT INTO collector_run (run_id, started_ms, last_heartbeat_ms, ended_ms, end_reason)
VALUES ('run-fixture-0001', 1767225600000, 1767225660000, 1767225660000, 'restart');

INSERT INTO coverage_interval (run_id, state, start_ms, end_ms, reason)
VALUES ('run-fixture-0001', 'covered', 1767225600000, 1767225660000, NULL);

INSERT INTO observation (binding_id, kind, event_type, source, slot_key, turn, turn_gen, fact_digest, received_at_ms, origin, contract_version, payload)
VALUES (
  'bnd_000000000000000000000001', 'row-change', 'slot-row', 'crew-ws',
  'member-fixture-bot.memory-fixture-store', 1, 'abc123',
  '0000000000000000000000000000000000000000000000000000000000000001',
  1767225602000, 'fixture', 1, '{"running":true,"turn":1,"turnGen":"abc123"}'
);

INSERT INTO quarantine (run_id, received_at_ms, reason, frame_type, size_bytes, count, first_received_at_ms)
VALUES ('run-fixture-0001', 1767225603000, 'unknown-event-type', 'invalid', 10, 1, 1767225603000);

INSERT INTO collector_setting (singleton, paused, changed_at_ms, revision)
VALUES (1, 0, 0, 1);



INSERT INTO bot_state (binding_id, dm_slot_key, running, turn, turn_gen, last_activity_ms, row_observed_ms, extra_facts, row_digest, observed_seq)
VALUES ('bnd_000000000000000000000001', 'member-fixture-bot.memory-fixture-store', 1, 1, 'abc123', NULL, 1767225602000, '{}', '0000000000000000000000000000000000000000000000000000000000000001', 1);

INSERT INTO attempt (attempt_id, binding_id, kind, slot_key, started_ms, started_seq, running)
VALUES ('att_000000000000000000000001', 'bnd_000000000000000000000001', 'bot-turn', 'member-fixture-bot.memory-fixture-store', 1767225602000, 1, 1);

INSERT INTO slot_seen (binding_id, slot_key, last_seen_ms)
VALUES ('bnd_000000000000000000000001', 'member-fixture-bot.memory-fixture-store', 1767225602000);

PRAGMA user_version = 4;
