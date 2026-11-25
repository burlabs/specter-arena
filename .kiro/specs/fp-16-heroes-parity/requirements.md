# FP-16 requirements: fixed hero roster, auto-assignment and Figma parity

One session, one design, one plan, three PRs. PR-A (this folder's first PR) carries heroes, assignment, removal of summoning, the narrowed grant set, migration 0007 and the v2 contracts. PR-B adds sprites, thumbnails, structures and idle motion. PR-C closes the remaining parity gaps and records performance. Batching the five component tasks into one PR-A was approved by Eric on 2026-11-15 (program context section 3); the PR body gives the size reason.

Under program amendment PA-2 (2026-11-19) Specters are no longer summoned. Every bot binding gets one of 11 authored heroes when it first appears, and the avatar is the only thing a user can change.

## Acceptance criteria

- **FP-16-AC01:** A bot binding gets its hero on first sight and keeps it; assignment n gets hero n mod 11 at ordinal n div 11 + 1.
- **FP-16-AC02:** The user changes only the avatar (gallery, PNG upload, reset to the hero portrait); no control edits a hero's text.
- **FP-16-AC03:** Summoning is removed and the grant set narrows to `/apps/specter-arena/api/*`, `/api/agents` and `slots:user`.
- **FP-16-AC04:** The arena draws hero sprites and shows the three structures, `AnimatedSpecter` and an open minimap (PR-B, PR-C).
- **FP-16-AC05:** Every gap-list item is ported or recorded with a reason (PR-C).
- **FP-16-AC06:** The performance record is re-run after the last code PR (PR-C).
- **FP-16-AC07:** Provenance and the third-party check are complete for every ported or added file.
- **FP-16-AC08:** No doc outside the history allowlist describes summoning.

## Requirements

| Id | Requirement | Acceptance check |
|---|---|---|
| FP16-REQ-01 | The roster is exactly Vell, Stitch, Reeve, Rattle, Ember, Shard, Poly, Tide, Lume, Moss, bur in that order, with authored name, epithet, personality, appearance, portrait, sprite and thumbnail keys; no role, capability or lane | `backend/tests/test_heroes.py`: `test_names_are_pinned`, `test_hero_text_has_no_denied_token_or_role_word` |
| FP16-REQ-02 | Assignment n gets hero `n mod 11` at ordinal `n div 11 + 1`, ordinal 2 and up shown as a Roman numeral; it never reads bot memory, prompts or behaviour and never changes on rename | FP16-WL-02, FP16-WL-03 tests; `ui/fixtures/specter-bodies.test.ts` (`gives binding n hero (n-1) mod 11 at ordinal (n-1) div 11 + 1`) |
| FP16-REQ-03 | The avatar is the only user control: gallery pick, PNG upload under the existing rules, reset to the hero portrait; it changes no hero text, binding or XP | FP16-WL-04 tests; `tests/e2e/specters.spec.ts` avatar journey |
| FP16-REQ-04 | Summoning is gone: no generation, reroll, accept, rename, manual entry or archive route, no summoner module or agent file | `backend/tests/test_specter_routes.py::test_removed_routes_answer_404_even_when_signed`; `git ls-files agents backend/specter_arena/summoner` empty |
| FP16-REQ-05 | `specter.v2` and `specters.v2` are FROZEN; the four v1 identity contracts are RETIRED with files, cases and exemptions kept; `heroId` has a reviewed exemption | `npm run check:schema`; FP16-DEL-01, FP16-DEL-02 |
| FP16-REQ-06 | Hero sprites (512 px) and thumbnails (96 px) are served by `GET /api/scene-assets/{key}` from hash-pinned files (PR-B) | `backend/tests/test_specter_scene_art.py` (PR-B) |
| FP16-REQ-07 | Structures are inline SVG; `AnimatedSpecter` idles and stops under reduced motion; the minimap is open on first render (PR-B, PR-C) | `tests/e2e/arena.spec.ts` (PR-B, PR-C) |
| FP16-REQ-08 | The Specters view follows the export's presentation over the app's own data (PR-C) | experience tests (PR-C) |
| FP16-REQ-09 | The map renders in a Chromium host above 2 MiB (PR-B) | `tests/e2e/arena.spec.ts` (PR-B) |
| FP16-REQ-10 | The gap list from export-versus-FIXTURE screenshots exists, each gap ported or recorded out of scope with a reason (PR-C) | PR-C body and handoff |
| FP16-REQ-11 | Small icons show the hero thumbnail unless the user chose an avatar; the arena token is always the hero sprite (PR-B) | experience tests (PR-B) |
| FP16-REQ-12 | The Specters view and docs never present a hero as a class, role or lane | `ui/src/specters/copy.test.ts` (`has no summoning, generation, rename, manual-entry or archive wording left`) |
| FP16-CI-01 | `app.json` `permissions.api` is `["/apps/specter-arena/api/*", "/api/agents"]`, `permissions.events` is `["slots:user"]`, and there is no `agents` key | `backend/tests/test_manifest.py` |
| FP16-CI-02 | `scripts/check-fixtures.mjs` rejects `/api/chat` and its children, any `agents` key and any file under `agents/` | `scanManifest agents` and `/api/chat` tests in `scripts/__tests__/check-fixtures.test.mjs` |
| FP16-CI-03 | The FIXTURE SDK serves `specter.v2`, `specters.v2` in the backend's shapes and rejects any `/api/chat` call | `ui/fixtures/app-sdk.test.ts`, `ui/fixtures/specter-bodies.test.ts` |
| FP16-WL-01 | `hero_assignment` holds one append-only row per binding; the database derives `hero_id` and `ordinal` from `assignment_no`; numbers are gapless | `test_the_table_rejects_a_row_that_breaks_the_roster_rule`, `test_assignments_and_avatar_revisions_are_append_only` |
| FP16-WL-02 | The row is written in the transaction and savepoint that creates the binding, on the creation path only; it reads no observation, roster or presence table; it never changes on rename | `test_a_failed_assignment_rolls_the_binding_back_with_it`, `test_assignment_reads_no_observation_roster_or_presence_table`, `test_a_rename_never_changes_the_hero`, `test_a_repeat_sight_of_a_known_binding_adds_no_assignment` |
| FP16-WL-03 | Assignment n gets hero `n mod 11` at ordinal `n div 11 + 1`; heroes are never reclaimed | `test_twenty_three_bindings_walk_the_roster_twice_then_start_a_third_lap` |
| FP16-WL-04 | The avatar is an append-only revision history; NULL means the hero portrait; choosing changes no hero, binding or XP row; a repeat choice appends nothing | `test_choosing_an_avatar_appends_one_revision_and_changes_nothing_else`, `test_choosing_the_current_avatar_again_appends_nothing`, `test_resetting_to_the_hero_portrait_appends_a_null_revision` |
| FP16-WL-05 | Migration 0007 backfills heroes in `(first_seen_ms, binding_seq)` order and keeps the newest Specter's newest portrait | `test_thirteen_bindings_are_assigned_in_first_seen_order_with_ordinals`, `test_only_the_newest_specters_newest_portrait_is_kept` |
| FP16-WL-06 | Migration 0007 drops `specter_revision`, `specter`, `generation_request`; generated text is absent from every table; copies may remain in free pages and the pre-migrate backup, and the docs say so | `test_no_generated_text_remains_in_any_table_but_survives_in_the_backup`, `test_the_migration_file_passes_the_runner_validation_and_drops_in_child_first_order` |
| FP16-WL-07 | The upgrade is backed up first, rolls back whole on failure, and a v7 file is refused by v6 code | `test_a_failing_0007_rolls_back_whole_and_leaves_v6_with_its_backup`, `test_a_v7_store_is_refused_by_code_that_knows_only_six` |
| FP16-WL-08 | XP, work and attempt rows are untouched; FP-02-AC06 passes; store coverage stays at or above 90% | `test_work_and_xp_rows_and_bindings_are_untouched_by_the_migration`, `test_store_no_classifier.py`, the CI coverage job |
| FP16-DEL-01 | `check:schema` accepts RETIRED and rejects any other status | `accepts a RETIRED row and rejects any other status (FP-16)` in `scripts/__tests__/check-schema.test.mjs` |
| FP16-DEL-02 | The producer meta-test counts 23 schemas and skips only the four RETIRED v1 identity contracts | `test_exactly_the_four_pa_2_identity_contracts_are_retired` and the count test |
| FP16-DEL-03 | OWNERS.md, `guard-exemptions.json` and `VERSIONING.md` carry the v2 rows, the `heroId` exemption and the RETIRED rule | `npm run check:schema` |
| FP16-DEL-04 | A release manifest or tree that re-adds `/api/chat`, an `agents` key or an `agents/` file fails `npm run check:fixtures` | the RED probes recorded in the PR body |
| FP16-DEL-05 | Every tracked raster has a provenance row with path and sha256 (PR-B adds the 22 hero files and 3 structures) | `npm run check:provenance` |
| FP16-DEL-06 | Each PR records the third-party check for every file it ports | grep output in each PR body |
| FP16-DEL-07 | The bundle cap is restated by the rule (measured x 1.25, rounded up to 1,000) with its measurement in each PR that changes the bundle | `ui/src/build-output.test.ts` |
| FP16-DEL-08 | No preview art reaches `ui/dist` (PR-B) | `scripts/__tests__/fixture-art-isolation.test.mjs` (PR-B) |
| FP16-DEL-09 | No doc outside the history allowlist mentions summoning, `/api/chat` or the summoner agent | the grep output in the PR body |
| FP16-DEL-10 | The OA-5 runbook describes the update to the narrowed grants, v7 and the hero and avatar checks | `docs/release/oa-5-runbook.md` |
| FP16-DEL-11 | The spec folder, registry rows and three indexes list FP-16 | `npm run check:schema` (runs `check-spec-ids`) |
| FP16-DEL-12 | `arena-perf-1` is re-run after FP-16 and recorded (PR-C) | `.kiro/specs/fp-16-heroes-parity/performance.md` (PR-C) |
| FP16-DEL-13 | The packaged artifact contains `0007_hero_roster.sql` and `heroes.json` and no `agents/` | `npm run package` file list in the PR body |
| FP16-DEL-14 | `Last verified commit` lines name the FP-16 merge commit (PR-C) | `grep -n "Last verified commit"` (PR-C) |
