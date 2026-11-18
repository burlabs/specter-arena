-- FROZEN: a store as released at schema version 5, with fixed seed rows. Never edit this file;
-- when 0006 ships, add schema-v6.sql for the next upgrade test instead.
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

INSERT INTO schema_migrations (version, name, sha256, applied_at)
VALUES (5, 'specter_identity', '9e020950355cfa664b35b37db3595f25bd3650462f1fbea5a8237e0228b3bb9e', '2026-01-05T00:00:00Z');

INSERT INTO asset (asset_id, sha256, media_type, width, height, byte_length, origin, label, bytes, created_ms)
VALUES (
  'ast_aaaaaaaaaaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaaaaaaaaaa0000000000000000000000000000000000000000',
  'image/png', 1, 1, 9, 'uploaded', 'fixture portrait', x'89504e470d0a1a0a00', 1767225604000
);

INSERT INTO specter (specter_id, binding_id, version, created_ms, updated_ms)
VALUES ('spc_000000000000000000000001', 'bnd_000000000000000000000001', 1, 1767225605000, 1767225605000);

INSERT INTO generation_request (request_id, binding_id, status, keep_json, prompt_version, model_label, candidate_json, attempts, internal_tag, created_ms, started_ms, finished_ms)
VALUES (
  'req_000000000000000000000001', 'bnd_000000000000000000000001', 'accepted', '[]', 'summon-1', 'fixture-model',
  '{"appearance":"A fixture lantern-bearer.","artBrief":"Grey coat.","assignmentRationale":"Fixture.","contractVersion":1,"epithet":null,"mannerism":"Taps twice.","name":"Fixture Specter","personality":"Dry.","signatureAction":null}',
  1, 'summoning', 1767225604500, 1767225604600, 1767225604900
);

INSERT INTO specter_revision (specter_id, revision_no, change, profile_json, asset_id, source, request_id, prompt_version, created_ms)
VALUES (
  'spc_000000000000000000000001', 1, 'generated',
  '{"appearance":"A fixture lantern-bearer.","artBrief":"Grey coat.","assignmentRationale":"Fixture.","contractVersion":1,"epithet":null,"mannerism":"Taps twice.","name":"Fixture Specter","personality":"Dry.","signatureAction":null}',
  NULL, 'generated', 'req_000000000000000000000001', 'summon-1', 1767225605000
);

UPDATE specter SET version = 2, updated_ms = 1767225606000 WHERE specter_id = 'spc_000000000000000000000001';

INSERT INTO specter_revision (specter_id, revision_no, change, profile_json, asset_id, source, request_id, prompt_version, created_ms)
VALUES (
  'spc_000000000000000000000001', 2, 'portrait',
  '{"appearance":"A fixture lantern-bearer.","artBrief":"Grey coat.","assignmentRationale":"Fixture.","contractVersion":1,"epithet":null,"mannerism":"Taps twice.","name":"Fixture Specter","personality":"Dry.","signatureAction":null}',
  'ast_aaaaaaaaaaaaaaaaaaaaaaaa', 'generated', NULL, 'summon-1', 1767225606000
);

PRAGMA user_version = 5;
