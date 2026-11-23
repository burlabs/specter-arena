# Release blockers and known limitations

Draft for Eric's review. The agent does not submit.

Last verified commit: `fe662428db77da73b160d2b8e22a945164da544a` (`main` after FP-25 PR-B #210; re-read for release candidate RC-6)

State of this file: the release-candidate state, called RC-6 (RC-4 was tested by the owner, who asked for lane placement and two-way fights, PA-4; FP-24 delivered them). RC-2 (`9d4581c9`) was a rehearsal. RC-3 (`610939061c23`) was built after Wave A (FP-17 to FP-21) and tested by the owner, who asked for six product changes (PA-3); FP-22 (automatic tasks and XP) and FP-23 (the UX pivot) delivered them, and RC-4 was built from `main` after that work and the avatar packs PR (#196); RC-5 was built from `main` after FP-24 (#202 to #204); RC-6 is built from `main` after FP-25 (#209, #210), which centres the assignment dialog and adds the Crew store listing. RC-1 (`de533eb`, FP-14 PR-C) is superseded: it still carried summoning, which FP-16 removed. At RC-6 two rows are open on purpose: BLK-01 (the owner sitting OA-5 is not recorded on RC-4, RC-5 or RC-6) and BLK-02 (the two quality gates have not approved the final record). The commit that records the OA-5 result updates those two rows. The RC-4, RC-5 and RC-6 SHAs, artifact names and checksums are in `docs/release/evidence-checklist.md` sections 6, 7 and 8, once the release window fills them in. This file is part of every packaged artifact (`scripts/package.mjs` `REQUIRED_FILES`), so a reader of an artifact sees the state that was true when it was built.

Rule: unresolved authorization or cross-scope data exposure is always a BLOCKER, never a KNOWN LIMITATION.

Status vocabulary: `open`, `fixed in PR-X (#n)`, `fixed in FP-NN (#n, #m)`, `fixed in part in FP-NN (#n, #m)` (the row's text says what is left), `accepted (decision, date)`, `disclosed`, `conditional`, `moot (FP-16)`. Entry condition for FP-15 Stage B: no BLOCKER row has the status `open`.

Criteria IDs (FP-14-AC01 to AC06) are listed with their wording in `docs/release/evidence-checklist.md`.

## 1. BLOCKER

| ID | Component | What | User impact | Evidence | Criterion | Status |
|---|---|---|---|---|---|---|
| BLK-01 | delivery | The owner sitting OA-5 (`docs/release/oa-5-runbook.md`) has not run on an `npm run package` artifact of RC-4, RC-5 or RC-6. RC-4 was tested by the owner and the per-step results are not yet recorded; RC-5 added FP-24 and RC-6 adds FP-25, and the RC-6 re-check covers both. The update path from the installed app, the migration to store version 11, the first-visit assignment walkthrough, the Specter showcase, the Arena-first layout, lane placement and two-way fights, automatic tasks and XP on a real worker run, the Waiting on you and Context in use readings, the arena attacks, the Data tab, the sidebar logo, the arena map through the host proxy and the restart case have no installed-app evidence | Nothing in CI proves the installed app works | No result file exists yet: `docs/release/oa-5-result.md` is written after the sitting | AC01, AC06 | open |
| BLK-02 | delivery | Both quality gates have not yet approved the final release-candidate record | The release candidate is unreviewed by the two gates | The verdict files are cited in `docs/release/evidence-checklist.md` once received | AC03 | open |
| BLK-03 | experience | The copied diagnostic summary could carry a refresh-token value, a client-secret value or a Basic authorization header (issue #128) | A user who pastes a summary into a ticket could paste a credential they had typed into a work title or blocker | `ui/src/arena/diagnosticSummary.ts` (`SCRUBBERS`); `ui/src/arena/diagnosticSummary.test.ts` (`removes a %s from every free-text field`, one row per credential shape, and `keeps %s readable`). Residual limit: KL-18 | AC02 | fixed in PR-B (#142) |
| BLK-04 | specter-identity | With the `/api/chat` grant not yet approved, each summoning attempt created a request row that counted against the per-bot budget, so five attempts locked a bot out for 24 hours | A user who tried to summon before approving the grant could not summon after approving it | `backend/specter_arena/specters/service.py` (`start_summoning`); `backend/tests/test_specter_service.py::test_fp14_f1_an_unavailable_summoner_is_503_and_spends_no_budget (removed by FP-16)` and `::test_fp14_f1_a_refused_live_turn_still_counts_against_the_budget (removed by FP-16)` | AC01, AC06 | moot (FP-16): the generation path and the `/api/chat` grant no longer exist |
| BLK-05 | crew-integration, specter-identity | Conditional. Risk R2: the `/api/chat` grant is matched by path prefix, so on the host it may reach the list of all chat slots (KL-02). It would have become a BLOCKER only if the RC-1 runbook's step 7 showed slot rows or other bots' keys reaching an app route, a log or the copied summary | None known. The app never reads the slot list | `backend/tests/test_summoner_source_guard.py`; `backend/tests/test_summoner_client.py::test_fp14_discard_deletes_only_the_named_slot_and_never_lists (removed by FP-16)` | AC02 | moot (FP-16): the generation path and the `/api/chat` grant no longer exist |
| BLK-06 | work-ledger, delivery | AC04 had no real-schema restore test and no owner restore procedure | An owner who needed a restore had no tested path and no written steps | `backend/tests/test_store_release_hardening.py::test_a_restored_backup_keeps_identity_heroes_avatars_and_xp` and `::test_a_backup_taken_before_acceptance_restores_without_the_later_award`; `docs/release/data-and-recovery.md` | AC04 | fixed in PR-A (#141, test) and this PR (C1, document) |
| BLK-07 | crew-integration | A signed route read the whole request body into memory before checking the signature, and GET routes had no size cap. A 50 MiB GET with a bad signature was buffered in full before the 401 | An unauthenticated caller could make the backend buffer a large body | `backend/specter_arena/proxy_auth.py` (`_read_capped`, `MAX_BODY_BYTES`); `backend/tests/test_proxy_auth_body_cap.py` (8 test functions) | AC02 | fixed in PR-A (#141) |
| BLK-08 | experience | Three accessibility defects in the Arena: token accessible names did not contain their visible text (WCAG 2.5.3), the Crew handoff link had a contrast ratio of 1.77 to 1 against its panel, and no focus outline showed in forced-colors mode | A keyboard, voice-control or high-contrast user could not operate or read parts of the Arena | `ui/src/arena/BattlefieldScene.tsx`; `ui/src/observatory/observatory.css`; `tests/e2e/a11y.spec.ts` (AX-1, AX-2, AX-4) | AC05 | fixed in PR-B (#142) |

BLK-03, BLK-05 and BLK-07 are credential or authorization rows. They cannot be moved to KNOWN LIMITATION without an owner decision recorded in the handoff. BLK-05 is moot rather than moved: the grant it was about was removed.

## 2. KNOWN LIMITATION

Each limitation names where it is disclosed to a reader.

| ID | Component | What | Disclosed in |
|---|---|---|---|
| KL-01 | crew-integration | The replay cache of the signed-request check is in memory. A backend restart reopens a 60-second window in which a captured signed request could be replayed | `docs/release/threat-model.md` |
| KL-02 | crew-integration, specter-identity | The `/api/chat` grant matches child paths, so on the host it can reach the whole slot list (FP-06+07 handoff, risk R2). App code never reads it. A source guard and tests forbid any GET on it. Not observed on a live host | `docs/submission/known-limitations.md`, `docs/release/threat-model.md`, `docs/compatibility/monitoring-scope.md` Status: moot (FP-16): the generation path and the `/api/chat` grant no longer exist; the disclosures named here were removed with it |
| KL-03 | crew-integration, specter-identity, experience | Crew keeps the temporary summoning chat in its own history (FP-06+07 handoff, risk R3). The summon panel and `docs/release/install.md` say so. The RC-1 runbook's step 7 was to check the claim | `docs/submission/known-limitations.md`, `docs/release/install.md`, the summon panel Status: moot (FP-16): the generation path and the `/api/chat` grant no longer exist; the disclosures named here were removed with it |
| KL-04 | crew-integration, specter-identity | A summoning slot can remain in Crew after a crash if Crew is unreachable at the next start. The cleanup is best effort and bounded at 30 seconds (`DISCARD_BOUND_S`) | `docs/release/threat-model.md` Status: moot (FP-16): the generation path and the `/api/chat` grant no longer exist; the disclosures named here were removed with it |
| KL-05 | crew-integration, experience | The 2.8 MB arena-map body through the host proxy is unproven. It is measured only if OA-5 step 10 records it. The arena shows a fallback without the map if it fails | `docs/submission/known-limitations.md` (arena-map row) |
| KL-06 | crew-integration | An open feed that delivers no frames relies on the library keepalive, not on an application idle timeout | `docs/release/threat-model.md` |
| KL-07 | work-ledger | No purge path. Retention is keep-everything. Only uninstall with `--purge-data` shrinks the store | `docs/submission/known-limitations.md`, `docs/release/data-and-recovery.md` Status: fixed in FP-19 (#166, #167): the owner can set a retention window and run an explicit purge. The default is still keep everything. The file does not shrink (KL-23) |
| KL-08 | work-ledger | No in-app restore. The offline procedure is documented. A hand restore with a stale `-wal` file beside the replaced database was not exercised on a live Crew install | `docs/submission/known-limitations.md`, `docs/release/data-and-recovery.md` Status: fixed in part in FP-19 (#166, #167): the Data tab writes an export to `data/exports/`. It cannot be downloaded or restored through the app (KL-24) |
| KL-09 | work-ledger, experience | `GET /api/work` orders by creation time, so an item created long ago and accepted today can fall outside the arena's one accepted page of 25 | `docs/submission/known-limitations.md` (the accepted-items row was removed with the Work tab) Status: fixed in FP-18 (#161, #162): the arena reads its work streams in update order. Moot (FP-22): the arena now reads tasks, not work items, and the Work tab is gone |
| KL-10 | work-ledger | After a manual projection rebuild drops an attempt id, re-accepting a legacy work item is refused until the attempt is observed again. The ledger stays consistent. No production code calls `rebuild_projection`, and no UI accepts work items since FP-22. Tasks and their XP are not affected by a rebuild | `docs/release/data-and-recovery.md` |
| KL-11 | work-ledger | `xp_summaries` returns at most 500 bindings (`MAX_SUMMARIES` in `store/xp.py`). The supported profile is 20 | `docs/release/data-and-recovery.md` Status: fixed in FP-18 (#161, #162): the UI walks every page of `GET /api/xp?view=paged`. `GET /api/xp` without `view` is still capped at 500, and no UI caller uses it |
| KL-12 | work-ledger | Store readiness reads `unavailable` for up to 5 seconds while another process holds the write lock, then recovers | `docs/release/data-and-recovery.md` |
| KL-13 | work-ledger | Orphaned `.partial` and `.restore-*.db` temporary files after a crash are not swept | `docs/release/data-and-recovery.md` Status: fixed in FP-19 (#166, #167): the store sweeps them at start when they are older than ten minutes |
| KL-14 | specter-identity | Uploaded portraits beyond about 189 vanish from the 200-entry gallery. There is no upload count cap and no asset garbage collection | `docs/release/threat-model.md` Status: fixed in FP-19 (#166, #167): at most 100 uploads are stored, and "Remove unused uploads" deletes the ones no avatar uses |
| KL-15 | specter-identity | `backend/specter_arena/store/specters.py` is large. Splitting it is deferred | this file only (maintenance) Status: moot (FP-16): the file now holds heroes, avatars and assets only. |
| KL-16 | experience | Performance numbers are for the FIXTURE preview on one Apple machine. They say nothing about the installed app | `docs/submission/known-limitations.md` (performance row), `docs/release/evidence-checklist.md`, `.kiro/specs/fp-16-heroes-parity/performance.md` |
| KL-17 | experience | The automated accessibility scan covers the FIXTURE preview only. The real host theme, screen-reader output and Windows High Contrast are manual checks | `docs/submission/known-limitations.md`, `docs/release/a11y-checklist.md` |
| KL-18 | experience | A credential word followed by several unquoted words loses only its first word in the copied summary. Check the summary before sharing it | `docs/submission/known-limitations.md` |
| KL-19 | delivery | Three moderate `npm audit` findings in the development toolchain (an `eslint` dependency chain). None ships in the artifact. No Python audit was run | `docs/release/threat-model.md` |
| KL-20 | delivery | CI proves nothing about the installed app. Real-host evidence is OA-5 and OA-6 | `docs/release/evidence-checklist.md` |
| KL-21 | crew-integration, experience | The "Waiting on you" state and the "Context in use" reading come from reading the Crew 0.13.0 source, not from a live test (FP-20). Both fail closed: a flag Crew does not send leaves the condition unchanged or reads "Not collected". "Blocked" is still not observable | `docs/submission/known-limitations.md`, `docs/compatibility/crew-0.13.0.md` |
| KL-22 | experience | Arena attacks and casts show live activity only. They are not progress or damage. A bot that is waiting on you does not attack, and reduced motion turns attacks off (FP-21) | `docs/submission/known-limitations.md`, `docs/submission/features.md` |
| KL-23 | work-ledger | A purge does not shrink the database file, because the migration runner forbids `VACUUM`. Deleted rows can remain in free pages of the file and in the newest `pre-purge-*` backup (FP-19) | `docs/submission/known-limitations.md`, `docs/release/data-and-recovery.md` section 2 |
| KL-24 | work-ledger | An export cannot be downloaded through the app or restored from the UI. It is a file under `data/exports/` that the owner copies and restores by hand (FP-19) | `docs/submission/known-limitations.md`, `docs/release/data-and-recovery.md` sections 3 and 5 |
| KL-25 | work-ledger, experience | XP is credited automatically when a task the app observed ends cleanly. It reflects observed activity, not verified outcomes: a task that ended cleanly may have been wrong or useless. Tokens and session length are never XP. A credited task's XP is final and is never corrected (FP-22) | `docs/submission/known-limitations.md`, `docs/submission/features.md`, `docs/submission/architecture.md` |
| KL-26 | work-ledger | The first sweep after migration 0010 builds tasks from every retained attempt and credits them by the same rule, so a bot's XP can jump on the first open after an upgrade. Manual XP from earlier builds stays as history and still counts (FP-22) | `docs/submission/known-limitations.md`, `docs/release/data-and-recovery.md` section 6 |
| KL-27 | work-ledger, crew-integration | The "waiting at end" check, which keeps a task from being credited, reads the last stored row of the task's slot. Whether worker rows carry the pending-approval and open-question flags is read from source and not live-tested. A task that ended while Crew waited on you may be credited if the flags were not on that row (FP-22, extends KL-21) | `docs/submission/known-limitations.md` |
| KL-28 | work-ledger | The legacy work write routes (create, link, accept, reject and the rest) still answer through the signed API, but no UI calls them. Work items and manual XP stay as history. Task awards are not listed in `GET /api/roster/{id}/xp` (`xp-history.v1`); the task list and inspector show them (FP-22) | `docs/submission/known-limitations.md` |
| KL-29 | specter-identity | A Specter assignment is final. The app has no reassign and no un-assign, and a bot's hero text is fixed. The owner can change only the avatar (FP-23) | `docs/submission/known-limitations.md`, `docs/release/install.md` section 7 |
| KL-30 | experience | The assignment walkthrough is a native `<dialog>`. Its focus handling and top layer were proven in Chromium on the FIXTURE preview only, not inside Crew's host. Crew's global reset removes the dialog's default margin; FP-25 centres it with its own CSS, proven in Chromium with the reset injected, not in Crew. The OA-5 sitting and RC-6 step R7 are the live check (FP-23, FP-25) | `docs/submission/known-limitations.md`, `docs/release/oa-5-runbook.md` step 7 |
| KL-31 | experience | Minion size (small, medium, large by run time) hero positions on the map and the two-way fights are presentation only. Size is not progress, health or effort, random lane and jungle places mean nothing, and a minion striking back or a hero flinching never means a task is failing (FP-22, FP-23, FP-24) | `docs/submission/known-limitations.md`, `docs/submission/features.md` |
| KL-32 | experience | The avatar packs are optional files in the repository, not in the release artifact. The Specters tab links to them on GitHub, so the link needs a network. Crew allows importing and assigning a pack only from the owner's own dashboard, so the app can only link to them (PR #196) | `docs/submission/known-limitations.md`, `README.md` |
| KL-33 | experience, delivery | The Crew store listing (author, tags, highlights, platform, use cases, configuration, hero image, four screenshots, icon) was written against the field names in the installed Crew 0.13.1 source, and no Library detail page has been seen in a running Crew. The four screenshots are FIXTURE-preview captures with demo data, and the dark variants reuse the light files. The artifact grows by about 4.35 MB because `store/` ships (FP-25) | `docs/submission/known-limitations.md`, `docs/release/oa-5-runbook.md` step R8 |

### Carried from `docs/submission/known-limitations.md`

These rows keep their text and source in that file. The table names each row by the start of its "Limit" cell, because this PR adds and removes rows there and row numbers would not stay true.

| ID | Row in `known-limitations.md` |
|---|---|
| KL-C01 | First enable needs network access to PyPI |
| KL-C02 | "Blocked" is not observable, and "Waiting on you" is read from Crew source only |
| KL-C03 | The roster lists only bots Crew lets the app see |
| KL-C04 | Worker-session attribution and gateway restarts are unproven live |
| KL-C05 | Every decision is recorded as `app-owner` |
| KL-C06 | XP is credited automatically from observed tasks, not from accepted work |
| KL-C07 | "Open Bots in Crew" opens the Bots page only |
| KL-C08 | The arena draws at most 80 enemies |
| KL-C09 | Each arena poll reads a small amount of task JSON |
| KL-C10 | The "gap longer than two polls" rule has unit tests only |
| KL-C11 | SQLite 3.37 or newer is required |
| KL-C12 | Do not install an older release over a newer one |
| KL-C13 | Art is AI-generated and may not be unique |
| KL-C14 | One demo machine |

## 3. Fixed in FP-14 and not blockers

Listed so the gates and reviewers see them.

| Item | Where |
|---|---|
| Stranded Crew slot after a restart during summoning (specter-identity F2) | PR-A (#141): `SpecterService._sweep`, `Summoner.discard`; the `test_fp14_f2_*` tests. Residual: KL-04. Code and tests removed by FP-16 |
| Silent missing or tampered bundled art (F3) | PR-A (#141): `test_start_with_tampered_art_logs_once_by_type_only_and_reads_fail_503` |
| Summoner client response-size and cut-short branches untested | PR-A (#141): four size tests in `backend/tests/test_summoner_client.py`. Code and tests removed by FP-16 |
| Store write lock and 100-item walk had no real test | PR-A (#141): `backend/tests/test_store_release_hardening.py` |
| Summoning privacy note did not say Crew keeps the chat | PR-B (#142): `PRIVACY_NOTE` in `ui/src/specters/copy.ts`, pinned in `ui/src/specters/copy.test.ts`. Code and tests removed by FP-16 |
| A backend 401 had no pinned UI mapping | PR-B (#142): a row in `ui/src/observatory/useRoster.test.tsx` |
| Stale statements in `docs/compatibility/monitoring-scope.md` | this PR (C1): three dated notes and a closing re-check |
