# Evidence checklist

Draft for Eric's review. The agent does not submit.

Last verified commit: `65e0f549691af2c6f4c9425f021d4b17b6b76a82` (`main` after FP-16 PR-B #149; the changes of FP-16 PR-C were re-read at that PR's head)

This file maps each FP-14 acceptance criterion to the evidence for it, and each failure scenario to a test. Cells that need a run on RC-1 (the head of commit C1 of FP-14 PR-C) or the OA-5 sitting read `pending` and are filled in the commit that records the result. A cell is never filled from memory: a number comes from a run, with its environment.

## 1. Criterion table

| ID | Criterion (verbatim from the FP-14 intake) | Evidence | Result | SHA | Date | Who | Environment |
|---|---|---|---|---|---|---|---|
| FP-14-AC01 | All selected required capabilities pass on a fresh supported Crew installation and across the agreed restart/reconnect cases. | `docs/release/oa-5-result.md` (steps 1 to 12, and Part B if run); restart and reconnect tests in section 2 | pending (OA-5) | pending | pending | Eric (owner sitting) | pending |
| FP-14-AC02 | No acceptance/XP invariant fails in property-based and concurrency tests; unresolved authorization or cross-scope data exposure is release-blocking. | `backend/tests/test_store_xp_properties.py`; `backend/tests/test_store_work_concurrency.py`; `docs/release/threat-model.md`; `docs/release/blockers.md` | pending, measured at RC-1 | pending | pending | agent | pending |
| FP-14-AC03 | The agreed new-code coverage threshold is met and both independent quality gates approve the committed release candidate. | Coverage rows below; the two gate verdict files | pending (BLK-02) | pending | pending | orchestrator (gates run as sub-agents) | pending |
| FP-14-AC04 | Backup/restore and retention tests retain correct identity/progression and report intentionally unavailable historical details. | `backend/tests/test_store_release_hardening.py` (restore tests); `docs/release/data-and-recovery.md` sections 2, 5 and 6 | pending, measured at RC-1 | pending | pending | agent | pending |
| FP-14-AC05 | Keyboard/reduced-motion operation works end to end; performance results name workload and environment instead of unsupported claims. | `tests/e2e/a11y.spec.ts`; `docs/release/a11y-checklist.md`; the performance record added with the result; `.kiro/specs/fp-16-heroes-parity/performance.md` (FIXTURE preview, FP-16 PR-C) | pending, measured at RC-1; manual items pending (OA-5) | pending | pending | agent, then Eric | pending |
| FP-14-AC06 | The integrated journey uses real generation and observed work, with explicit fixture/recorded-mode separation. | OA-5 steps 7 to 9; the release build must carry no fixture marker and exactly the release grants (`npm run check:fixtures`) | pending (OA-5) | pending | pending | Eric | pending |

"New-code threshold" means the repository's existing 90 percent gate per tool. No separate diff-coverage gate exists.

### Coverage at RC-1

| Tool | Measure | Gate | Result |
|---|---|---|---|
| Node scripts (`npm run coverage`) | lines | 90 percent | pending, measured at RC-1 |
| UI (vitest) | statements, branches, lines | 90 percent | pending, measured at RC-1 |
| Backend (pytest-cov) | total | 90 percent | pending, measured at RC-1 |

### Quality gates

| Gate | Head it approved | Verdict | Verdict file |
|---|---|---|---|
| `gate-requirements` | pending | pending | pending |
| `gate-fit` | pending | pending | pending |

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
| Concurrent acceptance | `backend/tests/test_store_work_concurrency.py::test_eight_concurrent_accepts_with_distinct_tokens_make_one_award`, `::test_four_handles_accepting_at_once_make_one_award`; `backend/tests/test_store_xp_properties.py` | existing |
| Restore keeps identity and XP | `backend/tests/test_store_release_hardening.py::test_a_restored_backup_keeps_identity_heroes_avatars_and_xp`, `::test_a_backup_taken_before_acceptance_restores_without_the_later_award` | new in PR-A (#141) |
| Oversize or unauthenticated body | `backend/tests/test_proxy_auth_body_cap.py` (8 test functions) | new in PR-A (#141) |
| Hero assignment and avatar changes | `backend/tests/test_store_heroes.py`; `backend/tests/test_heroes.py`; `tests/e2e/specters.spec.ts` (`a keyboard-only journey changes the avatar and lands on the hero heading`) | new in FP-16 PR-A |
| Scrubber shapes | `ui/src/arena/diagnosticSummary.test.ts` (`removes a %s from every free-text field`, `keeps %s readable`, `removes the whole quoted value, not just its first word`) | new in PR-B (#142) |
| Keyboard, reduced motion, forced colors, axe | `tests/e2e/a11y.spec.ts` AX-1 to AX-6 | new in PR-B (#142) |
| Fresh installation, real generation, real observed work | none automated | manual, OA-5 only (KL-20) |

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
