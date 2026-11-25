# FP-19 requirements: Data lifecycle and collection control

One session, two PRs. PR-A (this folder's first commit) is the backend: migration 0009, the store lifecycle, the startup sweep, the upload cap, the data routes, `POST /api/collector`, and two DRAFT contracts. PR-B adds the Data tab and freezes the contracts. Nothing is deleted until the owner presses a button; the default retention is keep everything.

Closes KL-07 (no purge), KL-08 (no export), KL-13 (orphan temp files) and KL-14 (no upload cap), and ships FP-04's deferred pause/resume route.

## Requirements (PR-A)

| Id | Requirement | Acceptance check |
|---|---|---|
| FP19-WL-01 | Migration 0009 adds `lifecycle_run` and `retention_setting` and replaces only `observation_keep`, `quarantine_keep` and `asset_keep`; every other table and trigger is byte for byte unchanged. A v8 store upgrades in one open with one `pre-migrate-v8-to-v9` backup and no row changes | `backend/tests/test_store_lifecycle.py` |
| FP19-WL-02 | The retention setting is null (keep everything, the default) or 30, 90, 180 or 365 days; setting the saved value changes nothing; no value below 30 is accepted | `backend/tests/test_store_lifecycle.py`; `backend/tests/test_data_routes.py` |
| FP19-WL-03 | A purge deletes only observations and quarantine rows older than the cutoff and ended attempts no work item links to. It keeps every observation a linked attempt needs, the opening row of each running attempt, and the newest row, event, turn, turn generation and `chat_done` of each bot's DM slot. The preview counts exactly what the purge deletes | `backend/tests/test_store_lifecycle.py` |
| FP19-WL-04 | A purge leaves `GET /api/work?view=list&order=updated`, `order=created`, `GET /api/work`, `GET /api/xp` (both views) and `GET /api/roster/{id}/xp` byte for byte identical; linked attempts and their evidence revision survive; reopen and re-accept still work | `backend/tests/test_data_routes.py` |
| FP19-WL-05 | SQL refuses a DELETE of an observation or quarantine row outside a running purge run or newer than its cutoff, of an asset that is bundled, referenced by an avatar revision, too young or outside a running cleanup run, and of any identity, hero, avatar, work, decision or XP row at any time | `backend/tests/test_store_lifecycle.py` |
| FP19-WL-06 | A read of a span before the purge horizon reports a gap (reason `purged`), never covered time with no activity; there is no horizon until a purge deletes a row | `backend/tests/test_store_lifecycle.py` |
| FP19-WL-07 | A purge and a cleanup first write `pre-purge-<stamp>.db` / `pre-cleanup-<stamp>.db`; a failed backup deletes nothing and opens no run; only the newest of each kind is kept | `backend/tests/test_store_lifecycle.py`; `backend/tests/test_data_routes.py` |
| FP19-WL-08 | A purge runs in bounded batches, each its own short transaction; one run is open at a time (409 `lifecycle_busy`); a run a crash left open is closed `interrupted` when the store opens | `backend/tests/test_store_lifecycle.py`; `backend/tests/test_data_routes.py` |
| FP19-WL-09 | An export is one verified, closed, owner-only SQLite copy `export-v<N>-<stamp>.db` in `data/exports/` with its sha256; no network | `backend/tests/test_store_lifecycle.py`; `backend/tests/test_data_routes.py` |
| FP19-WL-10 | When the store opens, only `.<name>.partial` and `.restore-<32 hex>.db` files older than 10 minutes in the store, backups and exports directories are deleted; a failure never blocks opening | `backend/tests/test_store_lifecycle.py` |
| FP19-REQ-01 | At most 100 uploaded assets are stored: a new image beyond that is 409 `upload_limit_reached`; the same bytes again return the existing asset | `backend/tests/test_store_lifecycle.py`; `backend/tests/test_specter_service.py`; `backend/tests/test_data_routes.py` |
| FP19-REQ-02 | Cleanup deletes only uploaded assets no avatar revision references and older than one hour; never a bundled asset | `backend/tests/test_store_lifecycle.py`; `backend/tests/test_data_routes.py` |
| FP19-CI-01 | `GET /api/data`, `POST /api/data/retention`, `/purge`, `/export`, `/asset-cleanup` are signed, answer `data-lifecycle` v1 and the `api-error` v1 codes of the contract, and answer 503 `store_not_ready` without the service | `backend/tests/test_data_routes.py` |
| FP19-CI-02 | `POST /api/collector` with `{"paused": bool}` is signed, idempotent, answers `collector-control` v1, calls the supervisor's pause and resume, records a `paused` coverage gap, and the roster names a paused collector | `backend/tests/test_data_routes.py` |
| FP19-CI-03 | Unsigned, oversized, malformed, duplicate-key and wrong-method requests change nothing | `backend/tests/test_data_routes.py` |
| FP19-DEL-01 | `data-lifecycle` v1 and `collector-control` v1 are FROZEN (PR-B; DRAFT in PR-A) in `contracts/OWNERS.md` with cases and a producer test; the schema count is 29 and the migration count 9 | `npm run check:schema`; `backend/tests/test_contract_producers.py` |
