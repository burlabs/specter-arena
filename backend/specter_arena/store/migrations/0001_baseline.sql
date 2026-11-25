-- 0001 baseline: migration bookkeeping and the installation anchor. No domain tables.
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

INSERT INTO store_meta (singleton, store_id, created_at, app_schema_family)
VALUES (
  1,
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
    || substr(lower(hex(randomblob(2))), 2) || '-'
    || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2)
    || '-' || lower(hex(randomblob(6))),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  'specter-arena'
);
