-- FROZEN: a store as released at schema version 1, with fixed seed rows. Never edit this file;
-- when 0002 ships, add schema-v2.sql for the next upgrade test instead.
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

INSERT INTO schema_migrations (version, name, sha256, applied_at)
VALUES (1, 'baseline', 'fef6c7529554b4a1d2179f1e177f59b09335d65a998611aefea01de17255e570', '2026-01-01T00:00:00Z');

INSERT INTO store_meta (singleton, store_id, created_at, app_schema_family)
VALUES (1, '00000000-0000-4000-8000-000000000001', '2026-01-01T00:00:00Z', 'specter-arena');

PRAGMA user_version = 1;
