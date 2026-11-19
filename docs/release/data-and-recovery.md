# Data, retention, restore and recovery

Draft for Eric's review. The agent does not submit.

Last verified commit: `65e0f549691af2c6f4c9425f021d4b17b6b76a82` (`main` after FP-16 PR-B #149; the changes of FP-16 PR-C were re-read at that PR's head)

This page says where Specter Arena keeps its data, what it never deletes, how to copy it, how to restore it and what a restore loses. Facts come from the code and tests named in each row. Anything not run on a live Crew install says so.

Related: `docs/release/install.md` (install, update, uninstall), `docs/release/blockers.md` (KL-07, KL-08, KL-10 to KL-13), `docs/release/threat-model.md`.

## 1. Where data lives

| Item | Path under `~/.kiro/crew/apps/specter-arena/` |
|---|---|
| Database | `data/store/specter-arena.db`, plus `specter-arena.db-wal` and `specter-arena.db-shm` while the app runs |
| Backups | `data/store/backups/` |
| Provisioned Python packages | `data/.kirocrew-deps*` (removed on uninstall) |

Directories the app creates are mode 0700 (`ensure_private_dir` in `backend/specter_arena/store/location.py`). Backup files are created owner-only, mode 0600 (`precreate_private_file` in the same file), written to a partial file, verified, then renamed in by `copy_database` in `backend/specter_arena/store/backup.py`. Uninstall keeps `data/store/` and `backups/` and removes `data/.kirocrew-deps*` (`docs/release/install.md`, section 10).

## 2. Retention

The default policy is **keep everything**. The only way to shrink the store is uninstall with `--purge-data`. This default was chosen during FP-14 planning and is for Eric to approve.

| Data | Behaviour | Evidence |
|---|---|---|
| `observation`, `quarantine`, `xp_entry` | Never changed and never deleted. UPDATE and DELETE abort in SQL | triggers `observation_immutable`, `observation_keep` (`store/migrations/0003_observation_coverage.sql`), `quarantine_immutable`, `quarantine_keep`, `xp_entry_immutable`, `xp_entry_keep` (`store/migrations/0006_work_xp.sql`) |
| `bot_binding`, `bot_display_revision`, `bot_presence`, `binding_rebind`, `work_item`, `work_attempt`, `work_milestone`, `work_decision`, `hero_assignment`, `avatar_revision`, `asset` | Never deleted. DELETE aborts in SQL. Rows that change do so only through guarded transitions | the `*_keep` triggers in migrations 0002, 0005, 0006 and 0007 (`store/migrations/0007_hero_roster.sql`) |
| `attempt`, `bot_state` (projections) | Rebuildable from observations. `rebuild_projection` is the only code that deletes from them and nothing in the running app calls it (KL-10) | `backend/specter_arena/store/projection.py` |
| XP and level | Not tied to `observation` or `attempt`. Each decision keeps its own evidence, at most 8192 bytes. Deleting or rebuilding observations cannot zero XP | `store/migrations/0006_work_xp.sql` (`evidence_json` check); `backend/tests/test_store_release_hardening.py::test_deleting_or_rebuilding_observations_never_changes_xp` |
| Pre-migration backups | The newest 3 are kept | `KEEP_PRE_MIGRATION` in `store/backup.py`; `backend/tests/test_store_backup.py::test_successive_upgrades_keep_the_newest_three_pre_migration_backups` |
| `backup-v<N>-<stamp>.db` and `*.pre-restore-<stamp>` files | Never pruned. The owner manages them | `store/backup.py` (`restore` moves the old database aside and never deletes it) |

Growth, measured once by the work-ledger research on Apple M5 Pro, macOS 26.6, Python 3.12.16, SQLite 3.53.1, in process, warm cache, no HTTP: about 0.4 KB per observation including indexes, and 4,661,248 bytes for 100 work items, 20 bots and about 10,100 observations. This is one run on one machine, not a benchmark.

## 3. Export

The app has no export. Two supported paths:

1. Disable the app, then copy the whole `data` folder (section 5, step 1). Copy the folder, not only the `.db` file: recent writes can sit in the `-wal` file beside it (a 4 MB `-wal` beside a 168 KB `.db` was seen on the owner's machine on 2026-11-19).
2. With the app disabled, run `sqlite3 ~/.kiro/crew/apps/specter-arena/data/store/specter-arena.db ".backup 'OUT.db'"`. The result is one closed file. The `.backup` command was run read-only against the owner's live file during research. It was not exercised through the owner's Crew with the app enabled.

## 4. Delete

Only `kirocrew app uninstall specter-arena --purge-data`. The flag was confirmed in `kirocrew app uninstall --help` on Crew 0.12.2 during research. This deletes the whole folder including the database and cannot be undone. There is no per-item delete (KL-07).

## 5. Restore

The tested path is the function `restore()` in `backend/specter_arena/store/backup.py`. It verifies the backup (`quick_check`, schema version), requires the live store to be closed, stages a copy, moves the live database aside as `specter-arena.db.pre-restore-<stamp>`, removes the `-wal` and `-shm` files of the replaced database, then renames the staged copy into place. Test: `backend/tests/test_store_release_hardening.py::test_a_restored_backup_keeps_identity_heroes_avatars_and_xp`.

The owner steps below do by hand what `restore()` does. **The hand procedure was not exercised on a live Crew install.** Treat it as untested until `docs/release/oa-5-result.md` or another record says otherwise.

1. Disable the app (Library toggle, or `kirocrew app disable specter-arena`).
2. Copy the whole `data` folder somewhere safe.
3. Move `specter-arena.db`, `specter-arena.db-wal` and `specter-arena.db-shm` out of `data/store/` (do not delete them yet). A stale `-wal` file beside a replaced database is unsafe, so all three must go.
4. Copy the chosen backup file from `data/store/backups/` to `data/store/specter-arena.db`.
5. Set its mode to 0600 (`chmod 600 data/store/specter-arena.db`).
6. Enable the app.

A backup is one closed file (`copy_database` sets `journal_mode = DELETE` and runs an integrity check before the rename; test `backend/tests/test_store_backup.py::test_a_backup_of_a_live_wal_store_is_one_verified_owner_only_file`). A newer schema than the code is refused (`SchemaNewer`). An older backup migrates forward on the next start, and a new pre-migration backup is taken first. Migration checksums are re-verified when the store opens (`verify_checksums` in `store/migrate.py`).

## 6. What a restore loses

A restore returns the store to the moment of the backup. Identity, heroes, avatars, work items and XP that existed in the backup are intact. Nothing written after it can be recovered from the restored store.

| Backup file | Loses |
|---|---|
| `pre-migrate-vN-to-vM-<stamp>.db` (taken before an upgrade) | Everything written since that upgrade started |
| `backup-v<N>-<stamp>.db` | Everything written since that file was taken |

Migration 0007 removes the generated Specter text from the database tables. Dropped text may remain in free pages of the database file and in the automatic `pre-migrate-v6-to-v7-<stamp>.db` backup (the newest 3 backups are kept) until those are pruned or deleted. The migration runner forbids `VACUUM`, so the file is not rewritten.
| A backup taken before an acceptance | The later acceptance, its XP award and its evidence. Tested result: XP 0, empty XP history, the work item back at `awaiting-review`, the hero present (`backend/tests/test_store_release_hardening.py::test_a_backup_taken_before_acceptance_restores_without_the_later_award`) |

Accepted items, XP awards, observations and new bindings, heroes and avatar choices written after the backup are not recoverable from the restored store. The app shows no banner after a restore. This page is the disclosure.

## 7. Scale and compatibility

- Supported acceptance profile: 20 tracked bots, 100 active work items and a 10,000-observation journal (`backend/tests/test_store_load.py`; `backend/tests/test_store_release_hardening.py::test_a_hundred_work_items_over_twenty_bots_page_in_four_requests_inside_the_budget`). These are proposed targets, not advertised benchmarks.
- Lists page at 25 items. `xp_summaries` returns at most 500 bindings (KL-11).
- Host: Kiro Crew 0.12.2 on macOS is the tested combination (KL-C14).
- SQLite 3.37 or newer, because the work tables are STRICT (KL-C11).
- A second process holding the write lock makes readiness read `unavailable` for up to 5 seconds (`BUSY_TIMEOUT_S`), then it recovers (KL-12; `backend/tests/test_store_release_hardening.py::test_a_second_connection_holding_the_write_lock_makes_the_store_unavailable_then_it_recovers`).
- Orphaned `.partial` and `.restore-*.db` files after a crash are not swept and are harmless (KL-13).
- After a manual projection rebuild, re-accepting an item can be refused until its attempt is observed again (KL-10).

## 8. Recovery runbook

| Symptom | Cause | Action |
|---|---|---|
| App reports `SchemaNewer` | An older release was installed over a newer database | Install the newer release, or restore a pre-migration backup (section 5) |
| The store reports a damaged database (`quick_check` failed) | Disk or copy damage | Disable the app, restore the newest good backup (section 5), then read section 6 for what was lost |
| The backend answers `503 store_unavailable` | The store failed to open, or another process holds the write lock | Wait. If it persists, disable and enable the app. If it persists after that, restore |
| An upgrade is refused after a failed pre-migration backup | The backup could not be written. The live database was not touched (`backend/tests/test_store_backup.py::test_a_failed_pre_migration_backup_aborts_the_migration`) | Free disk space and enable again |
| Roster empty, or "scope lost" or silent collection | A grant was lost (`scope-lost-or-silent`) | Reopen the app's permissions in Crew and approve them, then restart the app |
| First enable hangs | PyPI is unreachable | Connect and enable again |
