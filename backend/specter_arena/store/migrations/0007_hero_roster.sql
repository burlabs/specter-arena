-- 0007 hero roster (FP-16 / PA-2): every bot binding gets one fixed hero, assigned once and never
-- changed; the avatar is the only thing a user may choose. The summoning-era tables (the
-- generated profile text, its revisions and the generation requests) are dropped. `asset` stays.
--
-- The hero ids in the CHECK below, in the backfill, and in `HERO_IDS` (store/specters.py) are
-- the roster order of `backend/specter_arena/specters/heroes.json`; a test pins all three.
-- Assignment number n gets hero n % 11 at ordinal n / 11 + 1. Heroes are never reclaimed.
-- The migration runner forbids PRAGMA and VACUUM, so dropped text can stay in free pages and in
-- the automatic pre-migrate backup until that backup is pruned (docs/release/data-and-recovery.md).
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

-- Backfill: every existing binding, oldest first. `binding_seq` breaks a first_seen_ms tie, and
-- it is the order runtime assignment follows (creation order).
INSERT INTO hero_assignment (binding_id, assignment_no, hero_id, ordinal, assigned_ms)
SELECT binding_id, n,
  CASE n % 11
    WHEN 0 THEN 'vell' WHEN 1 THEN 'stitch' WHEN 2 THEN 'reeve' WHEN 3 THEN 'rattle'
    WHEN 4 THEN 'ember' WHEN 5 THEN 'shard' WHEN 6 THEN 'poly' WHEN 7 THEN 'tide'
    WHEN 8 THEN 'lume' WHEN 9 THEN 'moss' ELSE 'bur' END,
  n / 11 + 1, first_seen_ms
FROM (
  SELECT binding_id, first_seen_ms,
         row_number() OVER (ORDER BY first_seen_ms, binding_seq) - 1 AS n
  FROM bot_binding
) ORDER BY n;

-- Keep the portrait a user chose: the newest Specter of each binding (archived or not), at its
-- newest revision, when that revision points at an asset. Generated text is not copied.
INSERT INTO avatar_revision (binding_id, revision_no, asset_id, created_ms)
SELECT s.binding_id, 1, r.asset_id, r.created_ms
FROM specter s
JOIN specter_revision r ON r.specter_id = s.specter_id AND r.revision_no = s.version
WHERE r.asset_id IS NOT NULL
  AND s.specter_id = (
    SELECT s2.specter_id FROM specter s2 WHERE s2.binding_id = s.binding_id
    ORDER BY s2.created_ms DESC, s2.specter_id DESC LIMIT 1
  );

-- DROP TABLE does not fire the append-only triggers. Child first: specter_revision references
-- specter and generation_request, and foreign keys are on.
DROP TABLE specter_revision;
DROP TABLE specter;
DROP TABLE generation_request;
