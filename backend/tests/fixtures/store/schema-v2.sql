-- FROZEN: a store as released at schema version 2, with fixed seed rows. Never edit this file;
-- when 0003 ships, add schema-v3.sql for the next upgrade test instead.
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

INSERT INTO schema_migrations (version, name, sha256, applied_at)
VALUES (1, 'baseline', 'fef6c7529554b4a1d2179f1e177f59b09335d65a998611aefea01de17255e570', '2026-01-01T00:00:00Z');

INSERT INTO schema_migrations (version, name, sha256, applied_at)
VALUES (2, 'bot_binding', '5a11cf301571e93b718ae628dd1d2681d493a1ef71784b9566cc350b20c78f3a', '2026-01-02T00:00:00Z');

INSERT INTO store_meta (singleton, store_id, created_at, app_schema_family)
VALUES (1, '00000000-0000-4000-8000-000000000002', '2026-01-01T00:00:00Z', 'specter-arena');

INSERT INTO bot_binding (binding_id, installation_id, dm_key, member_id, memory_store, first_seen_ms)
VALUES (
  'bnd_000000000000000000000001',
  '00000000-0000-4000-8000-000000000002',
  'member-fixture-bot.memory-fixture-store',
  'fixture-bot',
  'fixture-store',
  1767225600000
);

INSERT INTO bot_display_revision (binding_id, revision_no, name, display_name, avatar_kind, avatar_ref, observed_ms)
VALUES ('bnd_000000000000000000000001', 1, 'fixture-bot', 'Fixture Bot', 'ghost', NULL, 1767225601000);

INSERT INTO bot_presence (binding_id, state, since_ms)
VALUES ('bnd_000000000000000000000001', 'present', 1767225601000);

PRAGMA user_version = 2;
