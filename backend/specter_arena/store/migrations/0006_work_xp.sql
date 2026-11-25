-- 0006 work and XP ledger: user-created WorkItems that group observed attempts under one stated
-- objective, their milestones, the append-only human decisions that move them between states,
-- and the append-only XP entries those decisions write. Nothing here is observation, attempt or
-- Specter data. There is deliberately no foreign key to `attempt` (`rebuild_projection` empties
-- and refills it; the id is a stable hash, the row is read when a decision is made) and none to
-- `generation_request`, `specter`, `specter_revision` or `asset`: summoning can never become work.
-- Only `work_item.state/version/updated_ms` and `work_milestone.done_ms` are ever updated, and
-- both are guarded by triggers. Every rule the store functions enforce is also enforced here.
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

-- work_item: creation shape, parent rules, update guard, state only through a decision.
CREATE TRIGGER work_item_new BEFORE INSERT ON work_item
WHEN NEW.state <> 'open' OR NEW.version <> 1 OR NEW.updated_ms <> NEW.created_ms
BEGIN SELECT RAISE(ABORT, 'work item must start open at version 1'); END;

CREATE TRIGGER work_item_parent_open BEFORE INSERT ON work_item
WHEN NEW.parent_id IS NOT NULL AND (
  EXISTS (SELECT 1 FROM xp_entry WHERE work_id = NEW.parent_id)
  OR COALESCE((SELECT state FROM work_item WHERE work_id = NEW.parent_id), '') IN ('accepted', 'cancelled')
)
BEGIN SELECT RAISE(ABORT, 'parent locked'); END;

-- At most three levels (a root is level 1): refuse a new item that would have three ancestors.
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

-- work_attempt: only a real, matching attempt; bounded; closed items and frozen contributors.
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

-- work_milestone: set at creation (item still at version 1); afterwards only done_ms moves.
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

-- work_decision: gapless sequence, legal transition from the item's current state, time never
-- goes backwards, append-only.
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

-- xp_entry: the sequence rule. Entry 1 of a (work, binding) is an award. After an award or a
-- reinstatement the next entry is a correction of exactly that amount; after a correction the
-- next is a reinstatement of exactly the original award. Net is therefore only ever 0 or the
-- award. Every comparison is wrapped in COALESCE(..., 0): a NULL from a missing predecessor
-- would otherwise make `NOT (...)` NULL and the trigger would silently not fire.
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

-- The leaf-only rule: only a rewardable item with no children can be awarded, only to one of its
-- own contributors, never above its bounty in total, and every award of one item comes from the
-- same accepting decision.
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
