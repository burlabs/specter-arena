# Evidence checklist

Draft for Eric's review. The agent does not submit.

Last verified commit: `3895df06d69cf14e9e78ea59bf3458cefb6894df` (`main` after FP-28 #220; re-read for release candidate RC-8)

This file maps each FP-14 acceptance criterion to the evidence for it, and each failure scenario to a test. Cells that need a run on the release candidate (RC-2, the merge commit of the RC-2 docs PR #151, for FP-14 issue #136, is section 4; RC-3 is section 5; RC-4 is section 6) or the OA-5 sitting read `pending` and are filled in the commit that records the result. A cell is never filled from memory: a number comes from a run, with its environment.

## 1. Criterion table

| ID | Criterion (verbatim from the FP-14 intake) | Evidence | Result | SHA | Date | Who | Environment |
|---|---|---|---|---|---|---|---|
| FP-14-AC01 | All selected required capabilities pass on a fresh supported Crew installation and across the agreed restart/reconnect cases. | `docs/release/oa-5-result.md` (steps 1 to 13; the fresh installation is Part 2, steps 14 to 18, shared with OA-6); restart and reconnect tests in section 2 | pending (OA-5) | pending | pending | Eric (owner sitting) | pending |
| FP-14-AC02 | No acceptance/XP invariant fails in property-based and concurrency tests; unresolved authorization or cross-scope data exposure is release-blocking. | `backend/tests/test_store_xp_properties.py`; `backend/tests/test_store_work_concurrency.py`; `docs/release/threat-model.md`; `docs/release/blockers.md` | pass: the full backend suite (4,023 tests, these included) passed at RC-2 | `9d4581c9` | 2026-11-20 | agent | Apple M5 Pro, macOS 26.6, Node 26.13.0, Python 3.12.16, SQLite 3.53.1 |
| FP-14-AC03 | The agreed new-code coverage threshold is met and both independent quality gates approve the committed release candidate. | Coverage rows below; the two gate verdict files | pending (BLK-02) | pending | pending | orchestrator (gates run as sub-agents) | pending |
| FP-14-AC04 | Backup/restore and retention tests retain correct identity/progression and report intentionally unavailable historical details. | `backend/tests/test_store_release_hardening.py` (restore tests); `docs/release/data-and-recovery.md` sections 2, 5 and 6 | pass: the full backend suite passed at RC-2; the hand restore is OA-5 step 18 | `9d4581c9` | 2026-11-20 | agent | Apple M5 Pro, macOS 26.6, Node 26.13.0, Python 3.12.16, SQLite 3.53.1 |
| FP-14-AC05 | Keyboard/reduced-motion operation works end to end; performance results name workload and environment instead of unsupported claims. | `tests/e2e/a11y.spec.ts`; `docs/release/a11y-checklist.md`; the performance record added with the result; `.kiro/specs/fp-16-heroes-parity/performance.md` (FIXTURE preview, FP-16 PR-C); `.kiro/specs/fp-10-11-live-arena/performance.md` ("Re-run for RC-2", FIXTURE preview) | pending, measured at RC-2; manual items pending (OA-5) | pending | pending | agent, then Eric | pending |
| FP-14-AC06 | The integrated journey uses real generation and observed work, with explicit fixture/recorded-mode separation. | OA-5 steps 6 to 12 (Roster, walkthrough, Specters, Arena, Data); the release build must carry no fixture marker and exactly the release grants (`npm run check:fixtures`) | pending (OA-5) | pending | pending | Eric | pending |

"New-code threshold" means the repository's existing 90 percent gate per tool. No separate diff-coverage gate exists.

### Coverage at RC-2

| Tool | Measure | Gate | Result |
|---|---|---|---|
| Node scripts (`npm run coverage`) | lines | 90 percent | 98.96 percent lines (394 tests) |
| UI (vitest) | statements, branches, lines | 90 percent | 99.58 statements, 96.3 branches, 99.81 lines (1,863 tests) |
| Backend (pytest-cov) | total | 90 percent | 99.84 percent (4,023 tests) |

### Quality gates

| Gate | Head it approved | Verdict | Verdict file |
|---|---|---|---|
| `gate-requirements` | `ae8f53ba` (PR #151 rev 2; same tree `1e6b94d6` as RC-2) | APPROVED (with note), after BLOCKED on rev 1 `f205e04b` | orchestrator project folder `2026-11-20-specter-release/gates/pr151-ae8f53b-requirements.md` (local, not committed) |
| `gate-fit` | `ae8f53ba` (PR #151 rev 2; same tree `1e6b94d6` as RC-2) | APPROVED (with note) | orchestrator project folder `2026-11-20-specter-release/gates/pr151-ae8f53b-fit.md` (local, not committed) |

Both gates run as sub-agents of the orchestrator on a clean checkout, because the implementer cannot reach `gate-requirements` and `gate-fit`. A PR description is not evidence. This file cites the verdict files and the head each one approved. The gates should read `docs/release/blockers.md`, `docs/release/threat-model.md` and this file as release evidence, because no CI job checks them.

## 2. Failure scenarios

| Scenario | Test (file::name) | Status |
|---|---|---|
| Duplicate and reordered observations | `backend/tests/test_collector_store_contract.py` and `backend/tests/test_collector_lanes.py` | existing |
| Reconnect storm, gap, restart | `backend/tests/test_collector_load.py::test_every_reconnect_after_a_snapshot_records_a_gap_and_covers_again_only_on_a_new_snapshot`; `backend/tests/test_collector_supervisor.py::test_ac02d_a_new_turn_gen_is_one_zero_length_source_restart_and_no_unobserved_turns` | existing |
| Token expiry | `ui/src/observatory/useRoster.test.tsx` (the 401 `unauthorized` row, mapped to `unknown`); the 403 `expired` path in `ui/src/observatory/ObservatoryPage.test.tsx` (`shows the %s error state when the first load fails`); collector renewal in `backend/tests/test_collector_auth.py::test_a_rejected_renewal_stops_collection` | new row in PR-B (#142), others existing |
| Closed UI, store restart | `backend/tests/test_store_core.py::test_data_and_store_id_survive_a_restart`; `backend/tests/test_specter_service.py::test_start_installs_all_eleven_bundled_portraits_once` | existing |
| Database lock | `backend/tests/test_store_release_hardening.py::test_a_second_connection_holding_the_write_lock_makes_the_store_unavailable_then_it_recovers` | new in PR-A (#141) |
| Partial migration failure | `backend/tests/test_store_migrations.py::test_a_failing_migration_rolls_back_completely`; `backend/tests/test_store_backup.py::test_a_failed_pre_migration_backup_aborts_the_migration`; a rehearsal of the v4 to v6 migration on a copy of the owner's database (research, delivery-F6) | existing; rehearsal recorded in research only |
| Missing art | `backend/tests/test_specter_service.py::test_start_with_tampered_art_logs_once_by_type_only_and_reads_fail_503`; `backend/tests/test_specter_bundled.py::test_a_tampered_file_is_never_served` | new in PR-A (#141) and existing |
| Concurrent acceptance (legacy manual path, kept as history) | `backend/tests/test_store_work_concurrency.py::test_eight_concurrent_accepts_with_distinct_tokens_make_one_award`, `::test_four_handles_accepting_at_once_make_one_award`; `backend/tests/test_store_xp_properties.py` | existing; no UI calls it since FP-22 |
| Automatic close-out and XP (FP-22) | `backend/tests/test_store_tasks.py` (`test_the_close_out_rule_orders_its_reasons`, `test_a_worker_that_ends_cleanly_becomes_a_credited_task_with_one_award`, `test_a_gap_over_the_attempt_means_not_credited`, `test_a_task_ending_with_an_approval_or_question_pending_is_not_credited`, `test_a_credited_task_whose_worker_runs_again_earns_nothing_more`, `test_the_sweep_does_nothing_while_the_collector_is_paused`, `test_the_first_sweep_backfills_retained_attempts_with_the_same_rule`); `backend/tests/test_store_xp_policy.py`; `backend/tests/test_task_api.py` | new in FP-22 (#186, #187) |
| Hero choice, final assignment and the 0011 rebuild (FP-23) | `backend/tests/test_store_hero_choice.py`; `backend/tests/test_store_hero_choice_migration.py` | new in FP-23 (#192) |
| Restore keeps identity and XP | `backend/tests/test_store_release_hardening.py::test_a_restored_backup_keeps_identity_heroes_avatars_and_xp`, `::test_a_backup_taken_before_acceptance_restores_without_the_later_award` | new in PR-A (#141) |
| Oversize or unauthenticated body | `backend/tests/test_proxy_auth_body_cap.py` (8 test functions) | new in PR-A (#141) |
| Hero assignment and avatar changes | `backend/tests/test_store_heroes.py`; `backend/tests/test_heroes.py`; `tests/e2e/specters.spec.ts` (`a keyboard-only journey changes the avatar and lands on the hero heading`) | new in FP-16 PR-A |
| Scrubber shapes | `ui/src/arena/diagnosticSummary.test.ts` (`removes a %s from every free-text field`, `keeps %s readable`, `removes the whole quoted value, not just its first word`) | new in PR-B (#142) |
| Keyboard, reduced motion, forced colors, axe | `tests/e2e/a11y.spec.ts` AX-1 to AX-6 | new in PR-B (#142) |
| Fresh installation, real observed work, the first-visit walkthrough in the host | none automated | manual, OA-5 only (KL-20) |

## 3. Store figures after FP-16 (WL-6)

One warm in-process run on Apple M5 Pro, macOS 26.6 (25G72), Python 3.12.16, SQLite 3.53.1, no HTTP, with the same profile as the FP-14 figures: 20 bindings with 100 ended worker attempts, 100 work items with 2 milestones each, 50 submitted and accepted, 10,000 observations ingested in batches of 100. It is a one-off script that is not committed, not a benchmark, and it says nothing about the installed app. The profile follows `backend/tests/test_store_release_hardening.py::test_a_hundred_work_items_over_twenty_bots_page_in_four_requests_inside_the_budget` and `backend/tests/test_store_load.py`.

| Figure | FP-14 (`c2104dbe`) | After FP-16 (`65e0f549`, schema v7) |
|---|---|---|
| Create 100 work items | 0.011 s | 0.010 s |
| 50 accept pairs | 0.013 s | 0.012 s |
| Ingest 10,000 observations | 0.38 s | 0.37 s |
| `list_work` walk of 100 items in 4 pages | 2.7 ms | 2.4 ms |
| `rebuild_projection` (10,200 observations folded) | 0.149 s | 0.141 s |
| Database file | 4,661,248 bytes | 4,648,960 bytes |

The migration added one `count(*)` and one insert per first-seen binding and dropped three tables, so no visible change was expected, and none appeared.

## 4. Release candidate build record

RC-1 (`de533eb2744935148d5ae613110287188f93ac55`, FP-14 PR-C) is superseded because it still carried summoning. RC-2 is built with `npm run package -- --commit <RC-2 SHA>` from a clean clone after the RC-2 docs PR merges. The row is filled from that run's output only.

| Candidate | Commit | Artifact | sha256 | Files | Built on |
|---|---|---|---|---|---|
| RC-2 | `9d4581c9402a098f4aef61e33c7c187b23dbfcb3` | `specter-arena-0.1.0-9d4581c9402a.tar.gz`, 6,033,464 bytes | `59ea8520f0905ca91cac83ea27603e6b0aec20e481b2790ee9e6332f2e30424f` | 1,283 | 2026-11-20, Apple M5 Pro, macOS 26.6, Node 26.13.0, npm 11.20.0 |

Two builds of RC-2 into separate output folders gave the same sha256. `shasum -a 256 -c` on the sidecar and the per-file check of `RELEASE-MANIFEST.txt` (`docs/release/install.md` section 3) both pass. The artifact has no `agents/` folder, `app.json` grants `/apps/specter-arena/api/*`, `/api/agents` and `slots:user` only, and it carries `0007_hero_roster.sql`. Coverage above was measured at RC-2 with `npm run coverage` on the same machine. The gates approved the PR #151 head whose tree equals RC-2's; BLK-02 stays open until FP-15 Stage B confirms the final candidate.

## 5. RC-3 (superseded by PA-3)

RC-3 is the candidate built from `main` after Wave A (FP-17 to FP-21) and the logo PR #181. It was built and handed to the owner on 2026-11-21, and the owner tested it on 2026-11-22. The owner asked for six product changes (PA-3), so RC-3 is superseded by RC-4 (section 6) and its sitting was not recorded as a pass. BLK-01 and BLK-02 therefore did not close on RC-3. The six notes were:

1. Tasks are created and closed automatically from observed activity, with no Work tab and no manual accept. XP now reflects observed activity, not verified outcomes.
2. Hero assignment is a user step. A new bot starts without a hero, and a first-visit walkthrough assigns one or randomizes all.
3. The Specters tab is a showcase of the 11 heroes with a big idle sprite, Attack and Cast buttons and a list of the bots that hold a hero. The Roster shows the bots.
4. The tab order is Arena, Roster, Specters, Data. The arena is bigger, the minimap sits below it and the side panels collapse.
5. Each hero keeps one fixed position on the lanes and jungle (presentation only).
6. Minions are tasks, sized by run time (presentation only).

| Item | Value |
|---|---|
| Commit | `610939061c23d242318f7222b3b71ad2302fccad` |
| Artifact name | `specter-arena-0.1.0-610939061c23.tar.gz` |
| Bytes | 6,278,683 |
| sha256 | `0e3b292026599da17d782df6d9eff2fe80dcd10692a88b602755967a11db8a68` |
| File count | 1,599 |
| Host | Kiro Crew 0.13.0 |
| App version | 0.1.0 |
| Store version and migrations | 9 and 9 |
| UI bundle cap | 419,000 characters |
| OA-5 and OA-6 result | none: superseded. The rows above are the RC-3 build record, kept in the release window's own records outside this repository. The gates approved the PR #182 head `d4cfba5d`, whose tree RC-3 was built from |

## 6. RC-4

RC-4 is the candidate built from `main` after FP-22 (#186, #187), FP-23 (#192 to #194) and the avatar packs PR (#196). It is built with `npm run package -- --commit <RC-4 SHA>` from a clean clone after the RC-4 docs PR merges. The RELEASE window fills every cell below except the OA-5 and OA-6 result from that run's output and from the quality-gate verdict files only. Nothing here is filled from memory.

| Item | Value |
|---|---|
| Commit | `7745c24e0c125c3471ae8a5e9f60f3ec4a3c5bf1` (PR #197, `main` after the RC-4 docs refresh) |
| Artifact name | `specter-arena-0.1.0-7745c24e0c12.tar.gz` |
| Bytes | 6,305,686 |
| sha256 | `7a9859d77c19aaadb4b203e2003ac9b64059d0f3a0572c0d8dd30fe98257f96b` |
| File count | 1,750 entries in the tarball (`tar -tzf`), which is the 1,749 files that `RELEASE-MANIFEST.txt` lists plus the manifest itself. The packager prints 1750 |
| Paths that must be absent from the artifact (`avatar-packs/`, `docs/images/`, `agents/`) | absent: a listing of the tarball matched none of the three. `app.json` grants `/apps/specter-arena/api/*`, `/api/agents` and `slots:user` and has no `agents` key. It carries `0010_auto_tasks.sql` and `0011_hero_choice.sql` and the four `ui/icons/` files |
| Host | Kiro Crew 0.13.1 (as given by the owner; not read by the agent) |
| App version | 0.1.0 |
| Build | 2026-11-22, Apple M5 Pro, macOS 26.6, Node 26.13.0, npm 11.20.0. Two builds from separate clones gave the same sha256. `shasum -a 256 -c` on the sidecar and the per-file check of `RELEASE-MANIFEST.txt` both pass |
| Coverage (Node scripts, UI, backend) | the `coverage` CI job passed on the PR #197 head `e7cd4021`, which has the same tree as the RC-4 commit for everything but the squash. Percentages were not re-measured in this window; the figures at the FP-23 PR-C head are in its handoff (UI 99.76% lines) |
| Gates (`gate-requirements`, `gate-fit`: head approved and verdict file) | both APPROVED on PR #197 head `e7cd4021`; verdict files `pr197-e7cd402-requirements.md` and `pr197-e7cd402-fit.md` in the release window's local gates folder (not committed). Earlier heads: `6c42e2f4` BLOCKED by both (a wrong bot-detail tab list, a stale step number); `13c33cec` APPROVED (requirements with note, fit without) |
| Store version and migrations | 11 and 11 (`npm run check:schema`: 37 schemas, 11 migrations, read at `232629b6`; unchanged at RC-5) |
| UI bundle cap | 367,000 characters (`ui/src/build-output.test.ts`; the build was 307.49 kB at the FP-23 PR-C head, per the FP-23 report) |
| OA-5 and OA-6 result | pending: `docs/release/oa-5-result.md`, written after the sitting in `docs/release/oa-5-runbook.md` (steps 1 to 18; the optional avatar-pack step 19 is recorded there if it was run) |

## 7. RC-5

RC-5 is the candidate built from `main` after FP-24 (#202, #203, #204): lane and jungle hero placement, minions beside their hero, two-way fights and the zoomed-out showcase with a practice target. It changes the UI only. It is built with `npm run package -- --commit <RC-5 SHA>` from a clean clone after the RC-5 docs PR merges. The RELEASE window filled every cell below except the re-check result from that run's output and from the quality-gate verdict files only. Nothing here is filled from memory.

| Item | Value |
|---|---|
| Commit | `4a1eb347e3b2597b2b704c50439046b7da56291f` (PR #205, `main` after the RC-5 docs refresh) |
| Artifact name | `specter-arena-0.1.0-4a1eb347e3b2.tar.gz` |
| Bytes | 6,328,259 |
| sha256 | `4661f6d2ae411cd3d6cb733fed2e2bedd2a06dded629db728e7af66e35ea8d3c` |
| File count | 1,756 entries in the tarball (`tar -tzf`), which is the 1,755 files that `RELEASE-MANIFEST.txt` lists plus the manifest itself. The packager prints 1756 |
| Paths that must be absent from the artifact (`avatar-packs/`, `docs/images/`, `agents/`) | absent: a listing of the tarball matched none of the three. `app.json` grants `/apps/specter-arena/api/*`, `/api/agents` and `slots:user` and has no `agents` key. The newest migration is `0011_hero_choice.sql` |
| Build | 2026-11-23, Apple M5 Pro, macOS 26.6, Node 26.13.0, npm 11.20.0. Two builds from separate output folders gave the same sha256. `shasum -a 256 -c` on the sidecar and the per-file check of `RELEASE-MANIFEST.txt` both pass |
| Host | Kiro Crew 0.13.1 (as given by the owner; not read by the agent) |
| App version | 0.1.0 |
| Gates (`gate-requirements`, `gate-fit`: head approved and verdict file) | both APPROVED (with note) on PR #205 head `4d2a62e8`; verdict files `pr205-4d2a62e-requirements.md` and `pr205-4d2a62e-fit.md` in the release window's local gates folder (not committed). FP-24's own gate verdicts are in its handoff |
| Store version and migrations | 11 and 11, unchanged from RC-4 (FP-24 added no migration) |
| UI bundle cap | 367,000 characters (321.24 kB at the FP-24 PR-C head, per the FP-24 report) |
| RC-4 per-step result and RC-5 arena re-check result | pending: `docs/release/oa-5-result.md`, written after the sitting in `docs/release/oa-5-runbook.md` (RC-5 steps R1 to R6) |

## 8. RC-6

RC-6 is the candidate built from `main` after FP-25 (#209, #210): the assignment dialog centred by the app's own CSS, and the Crew store listing (`store/hero.png` and four `store/screenshot-*.png`, about 4.35 MB more in the tarball). Permissions, version and store version are unchanged from RC-5. It is built with `npm run package -- --commit <RC-6 SHA>` from a clean clone after the RC-6 docs PR merges. The RELEASE window filled every cell below except the re-check result, from that run's output and from the quality-gate verdict files only. Nothing here is filled from memory.

| Item | Value |
|---|---|
| Commit | `86f2e186ff506f99fe86b1bb53e9c76238956c23` (PR #211, `main` after the RC-6 docs refresh) |
| Artifact name | `specter-arena-0.1.0-86f2e186ff50.tar.gz` |
| Bytes | 10,669,163 |
| sha256 | `d23212e2d42954dd4df580003d485b66a711380dfe8ce805238ade0b5de2460c` |
| File count | 1,762 entries in the tarball (`tar -tzf`), which is the 1,761 files that `RELEASE-MANIFEST.txt` lists plus the manifest itself. The packager prints 1762 |
| Paths that must be absent from the artifact (`avatar-packs/`, `docs/images/`, `agents/`) and present (`store/hero.png`, four `store/screenshot-*.png`) | absent: a listing matched none of `avatar-packs/`, `docs/images/`, `agents/`. Present: `store/hero.png` (sha256 `bad00b84…77da`, equal to its provenance row) and `store/screenshot-arena.png`, `-specters.png`, `-roster.png`, `-assign.png`. `app.json` names them as `heroImage` and `screenshots`, grants only `/apps/specter-arena/api/*`, `/api/agents` and `slots:user`, and has no `agents` key. The newest migration is `0011_hero_choice.sql` |
| Host | Kiro Crew 0.13.1 (as given by the owner; not read by the agent) |
| App version | 0.1.0 |
| Gates (`gate-requirements`, `gate-fit`: head approved and verdict file) | both approved PR #211 head `336bfd7f` (requirements APPROVED (with note), fit APPROVED); verdict files `pr211-336bfd7-requirements.md` and `pr211-336bfd7-fit.md` in the release window's local gates folder (not committed). Head `47cd02eb` was BLOCKED by both (a 12-minute cap against a 13-minute total, a stale RC-5 reference). FP-25's own verdicts are in its handoff |
| Build | 2026-11-23, Apple M5 Pro, macOS 26.6, Node 26.13.0, npm 11.20.0. Two builds from separate output folders gave the same sha256. `shasum -a 256 -c` on the sidecar and the per-file check of `RELEASE-MANIFEST.txt` both pass. The tarball is about 4.34 MB larger than RC-5 (10,669,163 against 6,328,259 bytes) |
| Store version and migrations | 11 and 11, unchanged (FP-25 added no migration) |
| UI bundle cap | 367,000 characters, unchanged (`ui/src/build-output.test.ts`) |
| RC-4 per-step result and RC-6 re-check result | pending: `docs/release/oa-5-result.md`, written after the sitting in `docs/release/oa-5-runbook.md` (RC-6 steps R1 to R8) |

## 9. RC-7

RC-7 is the candidate built from `main` after FP-26 (#214, #216): the app is branded "Specters of the Abyss" (slug `specter-arena`), `app-registry.json` makes the repository installable from the Crew external registry (and stays out of the artifact), the Node floor for the build is 22, and the backend logs a warning when `ui/dist/index.mjs` is missing. Permissions, version and store version are unchanged. It is built with `npm run package -- --commit <RC-7 SHA>` from a clean clone after the RC-7 docs PR merges. The RELEASE window filled every cell below except the sitting result, from that run's output and from the quality-gate verdict files only. Nothing here is filled from memory.

| Item | Value |
|---|---|
| Commit | `98acd0b750a84ca67b28f5d3a3c6a67732c7dc3d` (PR #217, `main` after the RC-7 docs PR) |
| Artifact name | `specter-arena-0.1.0-98acd0b750a8.tar.gz` |
| Bytes | 10,680,445 |
| sha256 | `6254fadf77d3a78fd4d2c5b7e9b2a27ff1337c437d2547e92bab65169d709927` |
| File count | 1,766 entries in the tarball (`tar -tzf`), which is the 1,765 files that `RELEASE-MANIFEST.txt` lists plus the manifest itself. The packager prints 1766 |
| Paths that must be absent from the artifact (`avatar-packs/`, `docs/images/`, `agents/`, `app-registry.json`) and present (`store/hero.png`, four `store/screenshot-*.png`) | absent: a listing matched none of `avatar-packs/`, `docs/images/`, `agents/`, and `app-registry.json` is not in the extracted folder. Present: `store/hero.png` and `store/screenshot-arena.png`, `-assign.png`, `-roster.png`, `-specters.png`. `app.json` grants only `/apps/specter-arena/api/*`, `/api/agents` and `slots:user` and has no `agents` key. The newest migration is `0011_hero_choice.sql` |
| `app.json` `displayName` and `ui.pages[0].label` | both read "Specters of the Abyss", read from the extracted artifact. `name` is still `specter-arena` |
| Host | Kiro Crew 0.13.1 (as given by the owner; not read by the agent) |
| App version | 0.1.0 |
| Gates (`gate-requirements`, `gate-fit`: head approved and verdict file) | both APPROVED (with note) on PR #217 head `602e2d00`; verdict files `pr217-602e2d0-requirements.md` and `pr217-602e2d0-fit.md` in the release window's local gates folder (not committed). Earlier heads: `6c3cdc31` BLOCKED by both (a duplicated RC-6 block, R7 and R8 missing from Part A), `33b8f273` BLOCKED by both (a code string the brand check would hit, an unescaped pipe in a table cell), `82979608` BLOCKED by requirements (an untrue KL-34 sentence) and APPROVED (with note) by fit |
| Build | 2026-11-24, Apple M5 Pro, macOS 26.7.3, Node 26.13.0, npm 11.20.0. Two builds from separate output folders gave the same sha256. `shasum -a 256 -c` on the sidecar and the per-file check of `RELEASE-MANIFEST.txt` both pass. The tarball is 11,282 bytes larger than RC-6 (10,680,445 against 10,669,163 bytes) |
| Store version and migrations | 11 and 11, unchanged (FP-26 added no migration) |
| UI bundle cap | 367,000 characters, unchanged (`ui/src/build-output.test.ts`) |
| RC-4 per-step result and RC-7 sitting result | pending: `docs/release/oa-5-result.md`, written after the sitting in `docs/release/oa-5-runbook.md` (RC-7 steps R1 to R8, B1, B2, G0 to G12) |

## 10. RC-8

RC-8 is the candidate built from `main` after FP-27 (#219: minions about 30% larger, each hero keeps one lane or jungle spot at every visit) and FP-28 (#220: the prebuilt `release` branch for the registry install, with `app-registry.json` removed from `main`). Permissions, version and store version are unchanged. It is built with `npm run package -- --commit 3895df06d69cf14e9e78ea59bf3458cefb6894df` from a clean clone, before the RC-8 docs PR, so the tarball's own docs are those of `3895df06`. The `release` branch published by the owner (`a496ac21…`) was built from the same commit. The RELEASE window fills every cell below except the sitting result, from that run's output and from the quality-gate verdict files only. Nothing here is filled from memory.

| Item | Value |
|---|---|
| Commit | pending |
| Artifact name | pending |
| Bytes | pending |
| sha256 | pending |
| File count | pending |
| Paths that must be absent from the artifact (`avatar-packs/`, `docs/images/`, `agents/`, `app-registry.json`) and present (`store/hero.png`, four `store/screenshot-*.png`) | pending |
| `app.json` `displayName` and `ui.pages[0].label` | pending |
| Tarball against the `release` branch tree | pending |
| Host | Kiro Crew 0.13.1 (as given by the owner; not read by the agent) |
| App version | 0.1.0 |
| Gates (`gate-requirements`, `gate-fit`: head approved and verdict file) | pending |
| Build | pending |
| Store version and migrations | 11 and 11, unchanged |
| UI bundle cap | 367,000 characters, unchanged (`ui/src/build-output.test.ts`) |
| Registry install attempts | attempt 1 on `main`, 2026-11-24: FAIL (no `ui/dist/`; the gateway had no npm). Attempt 2 on `release` (`a496ac2167ee3b98bcceb3a4d2797b23be0a70cc`, built from `3895df06`), 2026-11-25: partial PASS (G2, G4, G5 pass at 321,125 bytes with no `package.json`; page loads; the other rows are not reported). Detail in `docs/release/oa-5-runbook.md`, "Registry results so far" |
| RC-4 per-step result and RC-8 sitting result | pending: `docs/release/oa-5-result.md`, written after the sitting in `docs/release/oa-5-runbook.md` (RC-8 steps R1 to R8, B1, B2, G0 to G12) |
