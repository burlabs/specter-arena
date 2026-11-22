# Evidence checklist

Draft for Eric's review. The agent does not submit.

Last verified commit: `232629b65ceffb127675e7bd321fc901fcc5cd08` (`main` after the avatar packs PR #196; re-read for release candidate RC-4)

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
5. Heroes on the field get random positions (presentation only).
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

RC-4 is the candidate built from `main` after FP-22 (#186, #187), FP-23 (#192 to #194) and the avatar packs PR (#196). It is built with `npm run package -- --commit <RC-4 SHA>` from a clean clone after the RC-4 docs PR merges. The RELEASE window fills every `pending` cell below from that run's output and from the quality-gate verdict files only. Nothing here is filled from memory.

| Item | Value |
|---|---|
| Commit | pending |
| Artifact name | pending |
| Bytes | pending |
| sha256 | pending |
| File count | pending |
| Paths that must be absent from the artifact (`avatar-packs/`, `docs/images/`, `agents/`) | pending |
| Host | Kiro Crew 0.13.1 |
| App version | 0.1.0 |
| Coverage (Node scripts, UI, backend) | pending |
| Gates (`gate-requirements`, `gate-fit`: head approved and verdict file) | pending |
| Store version and migrations | 11 and 11 (`npm run check:schema`: 37 schemas, 11 migrations, read at `232629b6`) |
| UI bundle cap | 367,000 characters (`ui/src/build-output.test.ts`; the build was 307.49 kB at the FP-23 PR-C head, per the FP-23 report) |
| OA-5 and OA-6 result | `docs/release/oa-5-result.md`, written after the sitting in `docs/release/oa-5-runbook.md` (steps 1 to 18; the optional avatar-pack step 19 is recorded there if it was run) |
