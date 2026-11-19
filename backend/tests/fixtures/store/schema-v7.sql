-- FROZEN: a store as released at schema version 7, with fixed seed rows. Never edit this file;
-- when 0008 ships, add schema-v8.sql for the next upgrade test instead.
-- Generated once from the packaged migrations 0001-0007 (sqlite_master text, creation order).
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

CREATE TABLE work_item (
  work_id              TEXT NOT NULL PRIMARY KEY CHECK (
    length(work_id) = 28 AND work_id GLOB 'wrk_*' AND substr(work_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  parent_id            TEXT REFERENCES work_item (work_id) CHECK (
    parent_id IS NULL OR parent_id <> work_id
  ),
  title                TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  acceptance_condition TEXT NOT NULL CHECK (length(acceptance_condition) BETWEEN 1 AND 280),
  rewardable           INTEGER NOT NULL CHECK (rewardable IN (0, 1)),
  bounty_xp            INTEGER NOT NULL CHECK (bounty_xp BETWEEN 0 AND 100000),
  policy_version       TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 32),
  state                TEXT NOT NULL CHECK (
    state IN ('open', 'awaiting-review', 'blocked', 'rejected', 'cancelled', 'accepted', 'reopened')
  ),
  version              INTEGER NOT NULL CHECK (version >= 1),
  request_token        TEXT NOT NULL UNIQUE CHECK (
    length(request_token) BETWEEN 8 AND 64 AND request_token NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  created_ms           INTEGER NOT NULL CHECK (created_ms >= 0),
  updated_ms           INTEGER NOT NULL CHECK (updated_ms >= created_ms),
  CHECK (rewardable = 1 OR bounty_xp = 0)
) STRICT;

CREATE INDEX work_item_by_created ON work_item (created_ms, work_id);

CREATE INDEX work_item_by_parent ON work_item (parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE work_attempt (
  attempt_id TEXT NOT NULL PRIMARY KEY CHECK (
    length(attempt_id) = 28 AND attempt_id GLOB 'att_*' AND substr(attempt_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  work_id    TEXT NOT NULL REFERENCES work_item (work_id),
  binding_id TEXT NOT NULL REFERENCES bot_binding (binding_id),
  kind       TEXT NOT NULL CHECK (kind IN ('bot-turn', 'worker')),
  linked_ms  INTEGER NOT NULL CHECK (linked_ms >= 0)
) STRICT;

CREATE INDEX work_attempt_by_work ON work_attempt (work_id, binding_id);

CREATE INDEX work_attempt_by_binding ON work_attempt (binding_id, work_id);

CREATE TABLE work_milestone (
  work_id  TEXT NOT NULL REFERENCES work_item (work_id),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 8),
  label    TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  done_ms  INTEGER CHECK (done_ms IS NULL OR done_ms >= 0),
  PRIMARY KEY (work_id, position)
) STRICT, WITHOUT ROWID;

CREATE TABLE work_decision (
  decision_id       TEXT NOT NULL PRIMARY KEY CHECK (
    length(decision_id) = 28 AND decision_id GLOB 'dec_*' AND substr(decision_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  work_id           TEXT NOT NULL REFERENCES work_item (work_id),
  seq               INTEGER NOT NULL CHECK (seq >= 1),
  action            TEXT NOT NULL CHECK (
    action IN ('submit', 'accept', 'reject', 'block', 'unblock', 'cancel', 'reopen')
  ),
  from_state        TEXT NOT NULL CHECK (
    from_state IN ('open', 'awaiting-review', 'blocked', 'rejected', 'cancelled', 'accepted', 'reopened')
  ),
  to_state          TEXT NOT NULL CHECK (
    to_state IN ('open', 'awaiting-review', 'blocked', 'rejected', 'cancelled', 'accepted', 'reopened')
  ),
  actor             TEXT NOT NULL CHECK (actor = 'app-owner'),
  at_ms             INTEGER NOT NULL CHECK (at_ms >= 0),
  note              TEXT CHECK (note IS NULL OR length(note) <= 280),
  evidence_revision TEXT CHECK (
    evidence_revision IS NULL
    OR (length(evidence_revision) = 24 AND evidence_revision NOT GLOB '*[^0-9a-f]*')
  ),
  evidence_json     TEXT CHECK (
    evidence_json IS NULL
    OR (json_valid(evidence_json) AND length(CAST(evidence_json AS BLOB)) <= 8192)
  ),
  request_token     TEXT NOT NULL CHECK (
    length(request_token) BETWEEN 8 AND 64 AND request_token NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  UNIQUE (work_id, seq),
  UNIQUE (work_id, request_token),
  CHECK (
    (action IN ('accept', 'reject') AND evidence_revision IS NOT NULL AND evidence_json IS NOT NULL)
    OR (action NOT IN ('accept', 'reject') AND evidence_revision IS NULL AND evidence_json IS NULL)
  )
) STRICT;

CREATE TABLE xp_entry (
  entry_id       TEXT NOT NULL PRIMARY KEY CHECK (
    length(entry_id) = 28 AND entry_id GLOB 'xpe_*' AND substr(entry_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  work_id        TEXT NOT NULL REFERENCES work_item (work_id),
  binding_id     TEXT NOT NULL REFERENCES bot_binding (binding_id),
  seq            INTEGER NOT NULL CHECK (seq >= 1),
  kind           TEXT NOT NULL CHECK (kind IN ('award', 'correction', 'reinstatement')),
  amount         INTEGER NOT NULL CHECK (amount BETWEEN -100000 AND 100000 AND amount <> 0),
  policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 32),
  decision_id    TEXT NOT NULL REFERENCES work_decision (decision_id),
  created_ms     INTEGER NOT NULL CHECK (created_ms >= 0),
  UNIQUE (work_id, binding_id, seq),
  UNIQUE (decision_id, binding_id),
  CHECK ((kind = 'correction') = (amount < 0))
) STRICT;

CREATE INDEX xp_entry_by_binding ON xp_entry (binding_id, created_ms, entry_id);

CREATE INDEX xp_entry_by_work ON xp_entry (work_id, binding_id, seq);

CREATE TRIGGER work_item_new BEFORE INSERT ON work_item
WHEN NEW.state <> 'open' OR NEW.version <> 1 OR NEW.updated_ms <> NEW.created_ms
BEGIN SELECT RAISE(ABORT, 'work item must start open at version 1'); END;

CREATE TRIGGER work_item_parent_open BEFORE INSERT ON work_item
WHEN NEW.parent_id IS NOT NULL AND (
  EXISTS (SELECT 1 FROM xp_entry WHERE work_id = NEW.parent_id)
  OR COALESCE((SELECT state FROM work_item WHERE work_id = NEW.parent_id), '') IN ('accepted', 'cancelled')
)
BEGIN SELECT RAISE(ABORT, 'parent locked'); END;

CREATE TRIGGER work_item_depth BEFORE INSERT ON work_item
WHEN NEW.parent_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM work_item p1
  JOIN work_item p2 ON p2.work_id = p1.parent_id
  JOIN work_item p3 ON p3.work_id = p2.parent_id
  WHERE p1.work_id = NEW.parent_id
)
BEGIN SELECT RAISE(ABORT, 'work tree too deep'); END;

CREATE TRIGGER work_item_guard BEFORE UPDATE ON work_item
WHEN NEW.work_id <> OLD.work_id OR NEW.parent_id IS NOT OLD.parent_id
  OR NEW.title <> OLD.title OR NEW.acceptance_condition <> OLD.acceptance_condition
  OR NEW.rewardable <> OLD.rewardable OR NEW.bounty_xp <> OLD.bounty_xp
  OR NEW.policy_version <> OLD.policy_version OR NEW.request_token <> OLD.request_token
  OR NEW.created_ms <> OLD.created_ms OR NEW.version <> OLD.version + 1
  OR NEW.updated_ms < OLD.updated_ms
BEGIN SELECT RAISE(ABORT, 'illegal work update'); END;

CREATE TRIGGER work_item_state BEFORE UPDATE ON work_item
WHEN NEW.state <> OLD.state AND NOT COALESCE((
  SELECT 1 FROM work_decision d
  WHERE d.work_id = NEW.work_id
    AND d.seq = (SELECT max(seq) FROM work_decision WHERE work_id = NEW.work_id)
    AND d.from_state = OLD.state AND d.to_state = NEW.state
), 0)
BEGIN SELECT RAISE(ABORT, 'state changes only through a decision'); END;

CREATE TRIGGER work_item_keep BEFORE DELETE ON work_item
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER work_attempt_eligible BEFORE INSERT ON work_attempt
WHEN NOT EXISTS (
  SELECT 1 FROM attempt
  WHERE attempt_id = NEW.attempt_id AND binding_id = NEW.binding_id AND kind = NEW.kind
)
BEGIN SELECT RAISE(ABORT, 'attempt not eligible'); END;

CREATE TRIGGER work_attempt_open BEFORE INSERT ON work_attempt
WHEN COALESCE((SELECT state FROM work_item WHERE work_id = NEW.work_id), '') IN ('accepted', 'cancelled')
BEGIN SELECT RAISE(ABORT, 'work item is closed to new attempts'); END;

CREATE TRIGGER work_attempt_limit BEFORE INSERT ON work_attempt
WHEN (SELECT count(*) FROM work_attempt WHERE work_id = NEW.work_id) >= 16
  OR (
    NOT EXISTS (SELECT 1 FROM work_attempt WHERE work_id = NEW.work_id AND binding_id = NEW.binding_id)
    AND (SELECT count(DISTINCT binding_id) FROM work_attempt WHERE work_id = NEW.work_id) >= 8
  )
BEGIN SELECT RAISE(ABORT, 'attempt or contributor limit reached'); END;

CREATE TRIGGER work_attempt_frozen BEFORE INSERT ON work_attempt
WHEN EXISTS (SELECT 1 FROM xp_entry WHERE work_id = NEW.work_id)
  AND NOT EXISTS (SELECT 1 FROM xp_entry WHERE work_id = NEW.work_id AND binding_id = NEW.binding_id)
BEGIN SELECT RAISE(ABORT, 'contributors are frozen once XP exists'); END;

CREATE TRIGGER work_attempt_immutable BEFORE UPDATE ON work_attempt
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER work_attempt_keep BEFORE DELETE ON work_attempt
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER work_milestone_new BEFORE INSERT ON work_milestone
WHEN COALESCE((SELECT version FROM work_item WHERE work_id = NEW.work_id), 0) <> 1
  OR NEW.done_ms IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'milestones are set at creation'); END;

CREATE TRIGGER work_milestone_guard BEFORE UPDATE ON work_milestone
WHEN NEW.work_id <> OLD.work_id OR NEW.position <> OLD.position OR NEW.label <> OLD.label
  OR COALESCE((SELECT state FROM work_item WHERE work_id = OLD.work_id), '') = 'cancelled'
BEGIN SELECT RAISE(ABORT, 'illegal milestone update'); END;

CREATE TRIGGER work_milestone_keep BEFORE DELETE ON work_milestone
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER work_decision_sequence BEFORE INSERT ON work_decision
WHEN NEW.seq <> COALESCE((SELECT max(seq) FROM work_decision WHERE work_id = NEW.work_id), 0) + 1
  OR NEW.at_ms < COALESCE((SELECT max(at_ms) FROM work_decision WHERE work_id = NEW.work_id), 0)
BEGIN SELECT RAISE(ABORT, 'decision out of sequence'); END;

CREATE TRIGGER work_decision_transition BEFORE INSERT ON work_decision
WHEN NOT COALESCE(
  (SELECT state FROM work_item WHERE work_id = NEW.work_id) = NEW.from_state
  AND (
    (NEW.action = 'submit' AND NEW.from_state IN ('open', 'reopened') AND NEW.to_state = 'awaiting-review')
    OR (NEW.action = 'accept' AND NEW.from_state = 'awaiting-review' AND NEW.to_state = 'accepted')
    OR (NEW.action = 'reject' AND NEW.from_state = 'awaiting-review' AND NEW.to_state = 'rejected')
    OR (NEW.action = 'block' AND NEW.from_state IN ('open', 'reopened', 'awaiting-review') AND NEW.to_state = 'blocked')
    OR (NEW.action = 'unblock' AND NEW.from_state = 'blocked' AND NEW.to_state = 'open')
    OR (NEW.action = 'cancel'
        AND NEW.from_state IN ('open', 'awaiting-review', 'blocked', 'rejected', 'reopened')
        AND NEW.to_state = 'cancelled')
    OR (NEW.action = 'reopen' AND NEW.from_state IN ('accepted', 'rejected') AND NEW.to_state = 'reopened')
  ), 0)
BEGIN SELECT RAISE(ABORT, 'illegal transition'); END;

CREATE TRIGGER work_decision_immutable BEFORE UPDATE ON work_decision
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER work_decision_keep BEFORE DELETE ON work_decision
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER xp_entry_sequence BEFORE INSERT ON xp_entry
WHEN NEW.seq <> COALESCE(
  (SELECT max(seq) FROM xp_entry WHERE work_id = NEW.work_id AND binding_id = NEW.binding_id), 0
) + 1
BEGIN SELECT RAISE(ABORT, 'xp entry out of sequence'); END;

CREATE TRIGGER xp_entry_chain BEFORE INSERT ON xp_entry
WHEN NOT COALESCE(
  (NEW.seq = 1 AND NEW.kind = 'award' AND NEW.amount > 0)
  OR (
    NEW.seq > 1 AND NEW.kind = 'correction'
    AND (SELECT kind FROM xp_entry
         WHERE work_id = NEW.work_id AND binding_id = NEW.binding_id AND seq = NEW.seq - 1)
        IN ('award', 'reinstatement')
    AND NEW.amount = -(SELECT amount FROM xp_entry
         WHERE work_id = NEW.work_id AND binding_id = NEW.binding_id AND seq = NEW.seq - 1)
  )
  OR (
    NEW.seq > 1 AND NEW.kind = 'reinstatement'
    AND (SELECT kind FROM xp_entry
         WHERE work_id = NEW.work_id AND binding_id = NEW.binding_id AND seq = NEW.seq - 1)
        = 'correction'
    AND NEW.amount = (SELECT amount FROM xp_entry
         WHERE work_id = NEW.work_id AND binding_id = NEW.binding_id AND seq = 1)
  ), 0)
BEGIN SELECT RAISE(ABORT, 'illegal xp entry'); END;

CREATE TRIGGER xp_entry_leaf BEFORE INSERT ON xp_entry
WHEN NEW.kind = 'award' AND (
  COALESCE((SELECT rewardable FROM work_item WHERE work_id = NEW.work_id), 0) <> 1
  OR EXISTS (SELECT 1 FROM work_item WHERE parent_id = NEW.work_id)
)
BEGIN SELECT RAISE(ABORT, 'only a rewardable leaf can be awarded'); END;

CREATE TRIGGER xp_entry_contributor BEFORE INSERT ON xp_entry
WHEN NOT EXISTS (
  SELECT 1 FROM work_attempt WHERE work_id = NEW.work_id AND binding_id = NEW.binding_id
)
BEGIN SELECT RAISE(ABORT, 'beneficiary is not a contributor'); END;

CREATE TRIGGER xp_entry_cap BEFORE INSERT ON xp_entry
WHEN NEW.kind = 'award' AND (
  COALESCE((SELECT sum(amount) FROM xp_entry WHERE work_id = NEW.work_id AND kind = 'award'), 0)
    + NEW.amount > COALESCE((SELECT bounty_xp FROM work_item WHERE work_id = NEW.work_id), 0)
  OR EXISTS (
    SELECT 1 FROM xp_entry
    WHERE work_id = NEW.work_id AND kind = 'award' AND decision_id <> NEW.decision_id
  )
)
BEGIN SELECT RAISE(ABORT, 'award exceeds the bounty'); END;

CREATE TRIGGER xp_entry_decision BEFORE INSERT ON xp_entry
WHEN NOT COALESCE((
  SELECT 1 FROM work_decision d
  WHERE d.decision_id = NEW.decision_id AND d.work_id = NEW.work_id
    AND d.at_ms = NEW.created_ms
    AND ((NEW.kind IN ('award', 'reinstatement') AND d.action = 'accept')
      OR (NEW.kind = 'correction' AND d.action = 'reopen' AND d.from_state = 'accepted'))
), 0)
BEGIN SELECT RAISE(ABORT, 'xp entry does not match its decision'); END;

CREATE TRIGGER xp_entry_immutable BEFORE UPDATE ON xp_entry
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER xp_entry_keep BEFORE DELETE ON xp_entry
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TABLE hero_assignment (
  binding_id    TEXT NOT NULL PRIMARY KEY REFERENCES bot_binding (binding_id),
  assignment_no INTEGER NOT NULL UNIQUE CHECK (assignment_no >= 0),
  hero_id       TEXT NOT NULL CHECK (
    hero_id = CASE assignment_no % 11
      WHEN 0 THEN 'vell' WHEN 1 THEN 'stitch' WHEN 2 THEN 'reeve' WHEN 3 THEN 'rattle'
      WHEN 4 THEN 'ember' WHEN 5 THEN 'shard' WHEN 6 THEN 'poly' WHEN 7 THEN 'tide'
      WHEN 8 THEN 'lume' WHEN 9 THEN 'moss' ELSE 'bur' END
  ),
  ordinal       INTEGER NOT NULL CHECK (ordinal = assignment_no / 11 + 1),
  assigned_ms   INTEGER NOT NULL CHECK (assigned_ms >= 0)
) STRICT;

CREATE TRIGGER hero_assignment_sequence BEFORE INSERT ON hero_assignment
WHEN NEW.assignment_no <> (SELECT count(*) FROM hero_assignment)
BEGIN SELECT RAISE(ABORT, 'assignment out of sequence'); END;

CREATE TRIGGER hero_assignment_immutable BEFORE UPDATE ON hero_assignment
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER hero_assignment_keep BEFORE DELETE ON hero_assignment
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TABLE avatar_revision (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  binding_id  TEXT NOT NULL REFERENCES hero_assignment (binding_id),
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  asset_id    TEXT REFERENCES asset (asset_id),
  created_ms  INTEGER NOT NULL CHECK (created_ms >= 0),
  UNIQUE (binding_id, revision_no)
) STRICT;

CREATE TRIGGER avatar_revision_sequence BEFORE INSERT ON avatar_revision
WHEN NEW.revision_no <> (
  SELECT coalesce(max(revision_no), 0) + 1 FROM avatar_revision WHERE binding_id = NEW.binding_id
)
BEGIN SELECT RAISE(ABORT, 'revision out of sequence'); END;

CREATE TRIGGER avatar_revision_immutable BEFORE UPDATE ON avatar_revision
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER avatar_revision_keep BEFORE DELETE ON avatar_revision
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

INSERT INTO schema_migrations (version, name, sha256, applied_at)
VALUES (1, 'baseline', 'fef6c7529554b4a1d2179f1e177f59b09335d65a998611aefea01de17255e570', '2026-01-01T00:00:00Z');

INSERT INTO schema_migrations (version, name, sha256, applied_at)
VALUES (2, 'bot_binding', '5a11cf301571e93b718ae628dd1d2681d493a1ef71784b9566cc350b20c78f3a', '2026-01-02T00:00:00Z');

INSERT INTO schema_migrations (version, name, sha256, applied_at)
VALUES (3, 'observation_coverage', 'fb4c2b6e0802468abf37da643d358e7d8f0fbf61ac6722efacdf5a9f017d5424', '2026-01-03T00:00:00Z');

INSERT INTO schema_migrations (version, name, sha256, applied_at)
VALUES (4, 'projection_attempt', '8c5eb2674bc7330fb0f493115c6722b3fa66c804530aa5a61d0c492fa0bf250c', '2026-01-04T00:00:00Z');

INSERT INTO schema_migrations (version, name, sha256, applied_at)
VALUES (5, 'specter_identity', '9e020950355cfa664b35b37db3595f25bd3650462f1fbea5a8237e0228b3bb9e', '2026-01-05T00:00:00Z');

INSERT INTO schema_migrations (version, name, sha256, applied_at)
VALUES (6, 'work_xp', 'e8f53a1ee0bfe0d8b2d5db8c8c630866f78f43433bdbe26e8414560f75af84ef', '2026-01-06T00:00:00Z');

INSERT INTO schema_migrations (version, name, sha256, applied_at)
VALUES (7, 'hero_roster', '8d006ab99df9bdf1b33cc048a12f623aa1163966cd1526aecb83e95937bbd60e', '2026-01-07T00:00:00Z');

INSERT INTO store_meta (singleton, store_id, created_at, app_schema_family)
VALUES (1, '00000000-0000-4000-8000-000000000007', '2026-01-01T00:00:00Z', 'specter-arena');

INSERT INTO bot_binding (binding_id, installation_id, dm_key, member_id, memory_store, first_seen_ms)
VALUES ('bnd_000000000000000000000001', '00000000-0000-4000-8000-000000000007', 'member-fixture-bot', 'fixture-bot', '', 1767225600000);

INSERT INTO bot_binding (binding_id, installation_id, dm_key, member_id, memory_store, first_seen_ms)
VALUES ('bnd_000000000000000000000002', '00000000-0000-4000-8000-000000000007', 'member-second-bot', 'second-bot', '', 1767225610000);

INSERT INTO asset (asset_id, sha256, media_type, width, height, byte_length, origin, label, bytes, created_ms)
VALUES (
  'ast_aaaaaaaaaaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaaaaaaaaaa0000000000000000000000000000000000000000',
  'image/png', 1, 1, 9, 'uploaded', 'fixture portrait', x'89504e470d0a1a0a00', 1767225604000
);

INSERT INTO hero_assignment (binding_id, assignment_no, hero_id, ordinal, assigned_ms)
VALUES ('bnd_000000000000000000000001', 0, 'vell', 1, 1767225600000);

INSERT INTO hero_assignment (binding_id, assignment_no, hero_id, ordinal, assigned_ms)
VALUES ('bnd_000000000000000000000002', 1, 'stitch', 1, 1767225610000);

INSERT INTO avatar_revision (binding_id, revision_no, asset_id, created_ms)
VALUES ('bnd_000000000000000000000001', 1, 'ast_aaaaaaaaaaaaaaaaaaaaaaaa', 1767225620000);

PRAGMA user_version = 7;
