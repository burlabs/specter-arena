-- 0011 hero choice (FP-23 / PA-3): a bot starts with no hero and the user picks one, or asks for a
-- random one. `hero_assignment` is rebuilt so `hero_id` is any of the 11 roster ids (the 0007 CHECK
-- tied it to the assignment number) and `ordinal` counts the holders of that hero. Every 0007 row is
-- copied as it is (same assignment number, hero, ordinal and time) with `assigned_by` = 'auto', and
-- `avatar_revision` is rebuilt to reference the new table with every row copied. Rows stay
-- append-only. No new binding gets a hero any more (store/bindings.py no longer assigns one).
--
-- The hero ids below and in `HERO_IDS` (store/specters.py) are the roster order of
-- `backend/specter_arena/specters/heroes.json`; a test pins them.
-- The migration runner forbids PRAGMA, so the rebuild is: create the new tables, copy, drop the
-- child, drop the parent, rename. DROP TABLE does not fire the append-only triggers.
CREATE TABLE hero_assignment_new (
  binding_id    TEXT NOT NULL PRIMARY KEY REFERENCES bot_binding (binding_id),
  assignment_no INTEGER NOT NULL UNIQUE CHECK (assignment_no >= 0),
  hero_id       TEXT NOT NULL CHECK (hero_id IN (
    'vell', 'stitch', 'reeve', 'rattle', 'ember', 'shard', 'poly', 'tide', 'lume', 'moss', 'bur'
  )),
  ordinal       INTEGER NOT NULL CHECK (ordinal >= 1),
  assigned_ms   INTEGER NOT NULL CHECK (assigned_ms >= 0),
  assigned_by   TEXT NOT NULL CHECK (assigned_by IN ('auto', 'picked', 'random')),
  UNIQUE (hero_id, ordinal)
) STRICT;

INSERT INTO hero_assignment_new (binding_id, assignment_no, hero_id, ordinal, assigned_ms, assigned_by)
SELECT binding_id, assignment_no, hero_id, ordinal, assigned_ms, 'auto'
FROM hero_assignment ORDER BY assignment_no;

CREATE TABLE avatar_revision_new (
  revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
  binding_id  TEXT NOT NULL REFERENCES hero_assignment_new (binding_id),
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  asset_id    TEXT REFERENCES asset (asset_id),
  created_ms  INTEGER NOT NULL CHECK (created_ms >= 0),
  UNIQUE (binding_id, revision_no)
) STRICT;

INSERT INTO avatar_revision_new (revision_id, binding_id, revision_no, asset_id, created_ms)
SELECT revision_id, binding_id, revision_no, asset_id, created_ms
FROM avatar_revision ORDER BY revision_id;

-- `asset_keep` (0009) names avatar_revision in its body and a RENAME re-parses every trigger, so it
-- is dropped here and recreated unchanged at the end.
DROP TRIGGER asset_keep;
DROP TABLE avatar_revision;
DROP TABLE hero_assignment;
ALTER TABLE hero_assignment_new RENAME TO hero_assignment;
ALTER TABLE avatar_revision_new RENAME TO avatar_revision;

CREATE TRIGGER hero_assignment_sequence BEFORE INSERT ON hero_assignment
WHEN NEW.assignment_no <> (SELECT count(*) FROM hero_assignment)
BEGIN SELECT RAISE(ABORT, 'assignment out of sequence'); END;

CREATE TRIGGER hero_assignment_ordinal BEFORE INSERT ON hero_assignment
WHEN NEW.ordinal <> (SELECT count(*) FROM hero_assignment WHERE hero_id = NEW.hero_id) + 1
BEGIN SELECT RAISE(ABORT, 'ordinal out of sequence'); END;

CREATE TRIGGER hero_assignment_immutable BEFORE UPDATE ON hero_assignment
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER hero_assignment_keep BEFORE DELETE ON hero_assignment
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER avatar_revision_sequence BEFORE INSERT ON avatar_revision
WHEN NEW.revision_no <> (
  SELECT coalesce(max(revision_no), 0) + 1 FROM avatar_revision WHERE binding_id = NEW.binding_id
)
BEGIN SELECT RAISE(ABORT, 'revision out of sequence'); END;

CREATE TRIGGER avatar_revision_immutable BEFORE UPDATE ON avatar_revision
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER avatar_revision_keep BEFORE DELETE ON avatar_revision
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

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
