# Data, retention, restore and recovery

Draft for Eric's review. The agent does not submit.

Last verified commit: `d53b16ea6373094cb0835352adf68c255a9e1398` (`main` after the logo PR #181; re-read for release candidate RC-3)

This page says where Specter Arena keeps its data, what it never deletes, how to copy it, how to restore it and what a restore loses. Facts come from the code and tests named in each row. Anything not run on a live Crew install says so.

Related: `docs/release/install.md` (install, update, uninstall), `docs/release/blockers.md` (KL-07, KL-08, KL-10 to KL-14, KL-23, KL-24), `docs/release/threat-model.md`.

## 1. Where data lives

| Item | Path under `~/.kiro/crew/apps/specter-arena/` |
|---|---|
| Database | `data/store/specter-arena.db`, plus `specter-arena.db-wal` and `specter-arena.db-shm` while the app runs |
| Backups | `data/store/backups/` (`pre-migrate-*`, `pre-purge-*`, `pre-cleanup-*` and hand-made `backup-v<N>-*` files) |
| Exports | `data/exports/` (`export-v<N>-<stamp>.db` with a `.sha256` file beside each) |
| Provisioned Python packages | `data/.kirocrew-deps*` (removed on uninstall) |

Directories the app creates are mode 0700 (`ensure_private_dir` in `backend/specter_arena/store/location.py`). Backup files are created owner-only, mode 0600 (`precreate_private_file` in the same file), written to a partial file, verified, then renamed in by `copy_database` in `backend/specter_arena/store/backup.py`. Uninstall without `--purge-data` keeps `data/store/`, `backups/` and `data/exports/` and removes `data/.kirocrew-deps*`. Uninstall with `--purge-data` removes the whole `data` folder, including `data/exports/` (`docs/release/install.md`, section 10).

## 2. Retention

The default policy is **keep everything**. Nothing is deleted unless you ask. There is no schedule. In the Data tab you can save a retention window of 30, 90, 180 or 365 days. Saving a window deletes nothing. A purge runs only when you press it, after a preview of the counts and a confirmation, and only with the saved window (the route refuses with 409 `retention_not_set` or `retention_mismatch` otherwise). Uninstall with `--purge-data` still removes everything. KL-07 is fixed by FP-19 (#166, #167); the default keeps its meaning.

A purge first copies the database to `data/store/backups/pre-purge-<stamp>.db` and verifies it. If that copy fails, nothing is deleted. Then it deletes in batches of 500 rows, so a collector write waits for at most one batch. A purge a crash left open is closed as `interrupted` the next time the store opens, and rows already deleted stay deleted.

| Data | Behaviour | Evidence |
|---|---|---|
| `observation`, `quarantine` | Deleted only by a purge. The SQL guard lets a DELETE through only while a `purge` run is `running` and the row is older than that run's cutoff. Otherwise UPDATE and DELETE abort | triggers `observation_keep`, `quarantine_keep` replaced in `store/migrations/0009_data_lifecycle.sql`; `backend/tests/test_store_lifecycle.py::test_nothing_deletes_outside_a_running_lifecycle_run`, `::test_the_observation_guard_respects_the_cutoff_of_the_open_run` |
| Kept by a purge whatever their age | On each bot's direct-message slot, the newest observation of each kind and the newest `chat_done`; the newest observation with a turn and the newest with a turn generation of each bot; the row `bot_state` points at; the row that opened each running attempt; every row from a linked attempt's start to its end on its own slot | `backend/specter_arena/store/lifecycle.py` (`_OBSERVATION_CANDIDATES`); `backend/tests/test_store_lifecycle.py::test_a_purge_keeps_what_the_next_start_and_the_next_row_need`, `::test_observations_a_linked_attempt_needs_survive_and_old_unneeded_ones_go` |
| `attempt` (projection) | A purge deletes ended attempts older than the cutoff that no work item links. Running and linked attempts stay. The table has no SQL delete guard; the code and its tests bound the delete. `rebuild_projection` still deletes from it and nothing in the running app calls that (KL-10) | `store/lifecycle.py` (`_ATTEMPT_CANDIDATES`); `backend/tests/test_store_lifecycle.py::test_a_purge_deletes_only_old_unlinked_ended_attempts`, `::test_a_rebuild_after_a_purge_reproduces_bot_state_and_every_kept_attempt` |
| `bot_binding`, `bot_display_revision`, `bot_presence`, `binding_rebind`, `work_item`, `work_attempt`, `work_milestone`, `work_decision`, `hero_assignment`, `avatar_revision`, `xp_entry`, `retention_setting`, `lifecycle_run` | Never deleted. DELETE aborts in SQL, with or without a running purge. Rows that change do so only through guarded transitions | the `*_keep` triggers in migrations 0002, 0005, 0006, 0007 and 0009; `backend/tests/test_store_lifecycle.py::test_a_running_purge_still_cannot_delete_identity_heroes_work_or_xp`, `::test_a_purge_changes_no_identity_hero_decision_or_xp_row`, `::test_every_other_delete_guard_is_byte_for_byte_what_it_was_at_v8` |
| `asset` | Bundled art is never deleted. An uploaded asset is deleted only by "Remove unused uploads": it must be older than one hour and used by no avatar choice in the history. The SQL guard repeats both rules | `store/migrations/0009_data_lifecycle.sql` (`asset_keep`); `backend/tests/test_store_lifecycle.py::test_the_asset_guard_refuses_bundled_referenced_and_young_assets`, `::test_cleanup_deletes_only_old_unreferenced_uploads` |
| XP and level | Not tied to `observation` or `attempt`. Each decision keeps its own evidence, at most 8192 bytes. Deleting, purging or rebuilding observations cannot zero XP. Work and XP reads were byte-identical before and after a purge in the tests | `store/migrations/0006_work_xp.sql` (`evidence_json` check); `backend/tests/test_store_release_hardening.py::test_deleting_or_rebuilding_observations_never_changes_xp`; `backend/tests/test_store_lifecycle.py::test_a_purge_changes_no_identity_hero_decision_or_xp_row` |
| Purge horizon | The largest cutoff of any purge that deleted a row. Time before it reads as a coverage gap with the reason `purged`, never as zero activity. After a purge, `workers.seen` on a roster item counts only the worker attempts that were kept | `store/lifecycle.py` (`purge_horizon`, `with_purged_gap`); `backend/tests/test_store_lifecycle.py::test_a_window_that_reaches_the_purged_span_reads_it_as_a_gap_not_covered_time` |
| Pre-migration backups | The newest 3 are kept | `KEEP_PRE_MIGRATION` in `store/backup.py`; `backend/tests/test_store_backup.py::test_successive_upgrades_keep_the_newest_three_pre_migration_backups` |
| `pre-purge-<stamp>.db` and `pre-cleanup-<stamp>.db` | The newest one of each kind is kept. The older one is deleted only after the new copy is verified | `KEEP_PRE_LIFECYCLE` in `store/backup.py`; `backend/tests/test_store_lifecycle.py::test_a_pre_purge_backup_is_a_verified_copy_and_only_the_newest_is_kept`, `::test_pruning_touches_only_its_own_kind` |
| `backup-v<N>-<stamp>.db`, `*.pre-restore-<stamp>` files and `data/exports/` files | Never pruned. You manage them | `store/backup.py` (`restore` moves the old database aside and never deletes it) |

A purge does not shrink the database file. The migration runner forbids `VACUUM`. Deleted rows can remain in free pages of the file and in the newest `pre-purge-*` backup until the pages are reused or the backup is deleted (KL-23).

Growth, measured once by the work-ledger research on Apple M5 Pro, macOS 26.6, Python 3.12.16, SQLite 3.53.1, in process, warm cache, no HTTP: about 0.4 KB per observation including indexes, and 4,661,248 bytes for 100 work items, 20 bots and about 10,100 observations. One local FP-19 run purged a 10,000-observation store in 0.10 s and previewed it in 0.01 s. These are single runs on one machine, not benchmarks.

## 3. Export

The Data tab writes one export. It is a verified, closed SQLite copy named `export-v<N>-<stamp>.db` in `data/exports/`, created owner-only, with a `.sha256` file beside it. The Data tab lists the newest 20 (`MAX_LISTED_EXPORTS`) with name, size and hash. Nothing leaves the machine. The app has no download link and no import (KL-24): you copy the file yourself. Test: `backend/tests/test_store_lifecycle.py::test_an_export_is_a_verified_closed_owner_only_copy_in_the_exports_directory`.

The offline paths still work:

1. Disable the app, then copy the whole `data` folder (section 5, step 1). Copy the folder, not only the `.db` file: recent writes can sit in the `-wal` file beside it (a 4 MB `-wal` beside a 168 KB `.db` was seen on the owner's machine on 2026-11-19).
2. With the app disabled, run `sqlite3 ~/.kiro/crew/apps/specter-arena/data/store/specter-arena.db ".backup 'OUT.db'"`. The result is one closed file. The `.backup` command was run read-only against the owner's live file during research. It was not exercised through the owner's Crew with the app enabled.

The in-app export route was tested in the repository. It is checked on the installed app in the RC-3 sitting (`docs/release/oa-5-runbook.md`, Part 1 step 10).

## 4. Delete

- **Purge** old history: Data tab, section 2 above. It deletes old observations, quarantine rows and ended attempts that no work item uses, and nothing else.
- **Remove unused uploads**: Data tab. It first copies the database to `pre-cleanup-<stamp>.db`, then deletes uploaded portraits that no avatar choice in the history uses and that are older than one hour. At most 100 uploaded portraits are stored. A new image past that returns 409 `upload_limit_reached`. Bundled art is never deleted.
- **Everything**: `kirocrew app uninstall specter-arena --purge-data`. The flag was confirmed in `kirocrew app uninstall --help` on Crew 0.12.2 during research. This deletes the whole folder including the database, `data/store/backups/` and `data/exports/`, and cannot be undone.

There is still no per-item delete. Work items, decisions, XP entries, heroes and avatar choices cannot be deleted at all.

## 5. Restore

The tested path is the function `restore()` in `backend/specter_arena/store/backup.py`. It verifies the backup (`quick_check`, schema version), requires the live store to be closed, stages a copy, moves the live database aside as `specter-arena.db.pre-restore-<stamp>`, removes the `-wal` and `-shm` files of the replaced database, then renames the staged copy into place. Test: `backend/tests/test_store_release_hardening.py::test_a_restored_backup_keeps_identity_heroes_avatars_and_xp`.

The owner steps below do by hand what `restore()` does. **The hand procedure was not exercised on a live Crew install.** Treat it as untested until `docs/release/oa-5-result.md` or another record says otherwise.

1. Disable the app (Library toggle, or `kirocrew app disable specter-arena`).
2. Copy the whole `data` folder somewhere safe.
3. Move `specter-arena.db`, `specter-arena.db-wal` and `specter-arena.db-shm` out of `data/store/` (do not delete them yet). A stale `-wal` file beside a replaced database is unsafe, so all three must go.
4. Copy the chosen backup file from `data/store/backups/` (or an export from `data/exports/`) to `data/store/specter-arena.db`. Check an export against its `.sha256` file first (`shasum -a 256`).
5. Set its mode to 0600 (`chmod 600 data/store/specter-arena.db`).
6. Enable the app.

A backup is one closed file (`copy_database` sets `journal_mode = DELETE` and runs an integrity check before the rename; test `backend/tests/test_store_backup.py::test_a_backup_of_a_live_wal_store_is_one_verified_owner_only_file`). A newer schema than the code is refused (`SchemaNewer`). An older backup migrates forward on the next start, and a new pre-migration backup is taken first. The app restores nothing by itself (KL-08, KL-24): there is no restore button and no route. Migration checksums are re-verified when the store opens (`verify_checksums` in `store/migrate.py`).

## 6. What a restore loses

A restore returns the store to the moment of the backup. Identity, heroes, avatars, work items and XP that existed in the backup are intact. Nothing written after it can be recovered from the restored store.

| Backup file | Loses |
|---|---|
| `pre-migrate-vN-to-vM-<stamp>.db` (taken before an upgrade) | Everything written since that upgrade started |
| `backup-v<N>-<stamp>.db` | Everything written since that file was taken |
| `pre-purge-<stamp>.db` (the newest one) | Everything written since that purge started. It also puts the purged observations, quarantine rows and attempts back |
| `pre-cleanup-<stamp>.db` (the newest one) | Everything written since that cleanup started. It also puts the removed uploads back |
| `export-v<N>-<stamp>.db` | Everything written since that export |
| A backup taken before an acceptance | The later acceptance, its XP award and its evidence. Tested result: XP 0, empty XP history, the work item back at `awaiting-review`, the hero present (`backend/tests/test_store_release_hardening.py::test_a_backup_taken_before_acceptance_restores_without_the_later_award`) |

Accepted items, XP awards, observations and new bindings, heroes and avatar choices written after the backup are not recoverable from the restored store. The app shows no banner after a restore. This page is the disclosure.

Migration 0007 removed the generated Specter text from the database tables. Dropped text may remain in free pages of the database file and in an old `pre-migrate-v6-to-v7-<stamp>.db` backup, if one is still kept. A purge leaves deleted rows in the same way (KL-23). The migration runner forbids `VACUUM`, so the file is not rewritten.

Store version. The store is at version 9 (nine migrations; `npm run check:schema` reports 31 schemas and 9 migrations). Migration 0008 (FP-18) adds two indexes on `work_item` and no data. Migration 0009 (FP-19) adds the `lifecycle_run` and `retention_setting` tables and replaces the DELETE guards on `observation`, `quarantine` and `asset`. An older build refuses a version 9 store (`SchemaNewer`). Installing an older build over a migrated store is therefore not a rollback. A binary rollback needs the automatic backup taken before the migration: an update from version 6 writes one `pre-migrate-v6-to-v9-<stamp>.db`, and an update from version 8 writes `pre-migrate-v8-to-v9-<stamp>.db`. The runner takes one backup before all pending migrations, named with the version before and the version after. The newest 3 are kept. Restoring it loses what was written since the update (the first row of the table above). Test: `backend/tests/test_store_lifecycle.py::test_a_v8_store_migrates_to_v9_with_one_pre_migrate_backup`.

## 7. Scale and compatibility

- Supported acceptance profile: 20 tracked bots, 100 active work items and a 10,000-observation journal (`backend/tests/test_store_load.py`; `backend/tests/test_store_release_hardening.py::test_a_hundred_work_items_over_twenty_bots_page_in_four_requests_inside_the_budget`). These are proposed targets, not advertised benchmarks.
- Lists page at 25 items. The UI reads XP through `GET /api/xp?view=paged`, which walks every page with no 500 cap (KL-11, fixed in FP-18). `GET /api/xp` without `view` is still capped at 500 bindings, and no UI caller uses it.
- At most 100 uploaded portraits are stored (`MAX_UPLOADED_ASSETS`). The gallery lists 200 entries, so every stored asset is listed (KL-14, fixed in FP-19).
- Host: Kiro Crew 0.13.0 on macOS is the host of the RC-3 sitting (`kirocrew --version` on the owner's machine, 2026-11-20). Kiro Crew 0.12.2 was the tested combination before it (KL-C14). Neither is confirmed on an installed RC-3 until `docs/release/oa-5-result.md` exists.
- SQLite 3.37 or newer, because the work tables are STRICT (KL-C11).
- A second process holding the write lock makes readiness read `unavailable` for up to 5 seconds (`BUSY_TIMEOUT_S`), then it recovers (KL-12; `backend/tests/test_store_release_hardening.py::test_a_second_connection_holding_the_write_lock_makes_the_store_unavailable_then_it_recovers`).
- Orphaned `.partial` and `.restore-*.db` files after a crash are swept when the store opens, if they are older than ten minutes, in `store/`, `backups/` and `exports/` (KL-13, fixed in FP-19). The sweep never touches a database, a `-wal` or `-shm` file, a backup or an export. Test: `backend/tests/test_store_lifecycle.py::test_the_sweep_deletes_only_matching_names_older_than_ten_minutes`.
- After a manual projection rebuild, re-accepting an item can be refused until its attempt is observed again (KL-10).

## 8. Recovery runbook

| Symptom | Cause | Action |
|---|---|---|
| App reports `SchemaNewer` | An older release was installed over a newer database (version 9 at RC-3) | Install the newer release, or restore a pre-migration backup (section 5) |
| A purge or cleanup answers `backup_failed` (500) | The backup copy before it could not be written. Nothing was deleted | Free disk space and try again |
| A purge or cleanup answers `lifecycle_busy` (409) | Another purge, cleanup, export or retention change is running or was left open | Wait. A run a crash left open is closed as `interrupted` the next time the app starts |
| A purge removed more than you wanted | The purge ran as asked | Disable the app and restore the newest `pre-purge-*.db` (section 5). Read section 6 for what it loses |
| The store reports a damaged database (`quick_check` failed) | Disk or copy damage | Disable the app, restore the newest good backup (section 5), then read section 6 for what was lost |
| The backend answers `503 store_unavailable` | The store failed to open, or another process holds the write lock | Wait. If it persists, disable and enable the app. If it persists after that, restore |
| An upgrade is refused after a failed pre-migration backup | The backup could not be written. The live database was not touched (`backend/tests/test_store_backup.py::test_a_failed_pre_migration_backup_aborts_the_migration`) | Free disk space and enable again |
| Roster empty, or "scope lost" or silent collection | A grant was lost (`scope-lost-or-silent`) | Reopen the app's permissions in Crew and approve them, then restart the app |
| First enable hangs | PyPI is unreachable | Connect and enable again |
