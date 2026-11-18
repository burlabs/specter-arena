# FP-10+11 requirements: live arena and encounter inspector

One session, one design, one plan, three PRs (batching approved by Eric on 2026-11-15, limits in the program context §3). PR-A is provenance, art and the scene-asset contract, PR-B the arena, PR-C the inspector, handoffs and the performance record. Requirement ids are registered in `spec/ids.md`. Decisions are recorded in `design.md`.

Under program amendment PA-1, read every "agent" that anchors a Specter, a binding, XP, a level or a condition as bot. The arena is a read-only projection of the FROZEN reads of FP-04, FP-06+07 and FP-08+09. It adds no write route and no Crew grant. Approval signals are untested, so "waiting on you" is never shown. FD-31 bot-dashboard summary records are skipped.

## Acceptance criteria (verbatim from the intake)

- **FP-10-AC01:** A real observed task appears as an enemy, a real blocker changes its condition, and only acceptance defeats it and reveals committed XP.
- **FP-10-AC02:** The arena and roster agree on active work, status, acceptance, contributors, and progression.
- **FP-10-AC03:** Pausing, seeking an optional replay, resizing, refreshing, or disabling animation changes no work/identity/reward state.
  - Reading: there is no replay player (FP-12 cut), so pausing and seeking are not offered; resizing, refreshing and disabling animation are tested.
- **FP-10-AC04:** Several concurrent attempts remain inspectable without implying one agent is several unrelated Specters.
- **FP-10-AC05:** Returning after a long gap shows current state, explicit coverage, and no avalanche of old XP celebrations.
- **FP-10-AC06:** A labeled fixture demo cannot create production rewards or appear to be live Crew activity.
- **FP-11-AC01:** A user can identify a genuine blocker from the arena and reach the supported Crew surface needed to address it.
  - Reading: "supported Crew surface" is a route recorded as allowed for Crew 0.12.2 in the handoff record, or the copy-diagnostic-summary fallback when none is.
- **FP-11-AC02:** Every defeat/XP entry links to attributable acceptance evidence rather than just a final chat message.
- **FP-11-AC03:** Missing permissions, deleted source sessions, and stale links have clear fallbacks with no authorization bypass.
- **FP-11-AC04:** Diagnostic text and exports exclude credentials and unnecessary private conversation data.
- **FP-11-AC05:** Keyboard-only operation can select a Specter, inspect a task, and open a supported source action.
- **FP-11-AC06:** The app cannot execute or auto-approve a tool action simply because a visual condition is clicked.

## Requirements

| Id | Requirement | Acceptance criteria / source | Slice |
|---|---|---|---|
| FP1011-REQ-01 | Every on-field state (`open`, `awaiting-review`, `blocked`, `reopened`) of a WorkItem read from `GET /api/work` is an enemy; `blocked` shows a blocked condition; only `accepted` shows the defeated state, and its XP is the sum of the awards already recorded on the item, never recomputed. | FP-10-AC01 | PR-B |
| FP1011-REQ-02 | The arena, its list view and the roster are built from the same polled inputs. The list view shows every Specter and every enemy; counts of active work, states, contributors and XP in the arena equal those of the Work tab and the roster for the same snapshot. | FP-10-AC02 | PR-B |
| FP1011-REQ-03 | Selection, camera, zoom and animation state live in React state only. Resizing, refreshing, toggling reduced motion and selecting an item send no request other than the polled GET reads, and change no work, identity or reward state. A test records every client call. | FP-10-AC03, FP-11-AC06 | PR-B, PR-C |
| FP1011-REQ-04 | One Specter per bot binding appears exactly once; concurrent attempts show as a count and one engagement line per engaged WorkItem; the inspector lists every attempt. | FP-10-AC04 | PR-B |
| FP1011-REQ-05 | A defeat animation plays only for a WorkItem observed turning `accepted` between two consecutive polls while the page stayed visible and the gap was at most twice the poll interval, at most three per poll. First load, tab return and a longer gap re-baseline silently and show the current state and the coverage line. Nothing is written. | FP-10-AC05 | PR-C |
| FP1011-REQ-06 | The arena header and list view carry a visible mode label: `LIVE`, or `FIXTURE — demo data, not Crew activity`. `RECORDED` exists as a type value only. Fixture data lives only in the fixture SDK and preview build and never in `ui/dist`. | FP-10-AC06 | PR-B |
| FP1011-REQ-07 | The scene model is a pure function of its inputs and produces no number that could be read as health: progress is "N of M milestones" or unknown. Decorative effects change no state. | FP-10-AC01, FP-10-AC03 | PR-B |
| FP1011-REQ-08 | The scene draws at most 160 sprite nodes (80 enemies, 20 Specters, markers); overflow collapses into a "+N more" count per region and stays listed in the list view. With 20 bots, 100 open WorkItems, 30 open attempts the first arena render is within 500 ms of data and a poll update within 50 ms of scripting; with reduced motion no animation frame callback runs and `document.getAnimations()` is empty. | FP-10-AC03 | PR-B, PR-C |
| FP1011-REQ-09 | The inspector opens on click or keyboard selection of a Specter or an enemy and shows attempts, decisions with `evidenceRevision`, contributors, XP history and coverage from the existing work, attempts and XP reads. Each defeat and XP entry links to its accepting decision. | FP-11-AC02 | PR-C |
| FP1011-REQ-10 | A 404, 403 or network failure on an inspector read shows "This item is no longer available" or "Not permitted" and clears the evidence previously shown for that item. | FP-11-AC03 | PR-C |
| FP1011-REQ-11 | The diagnostic summary is plain text of at most 4,000 characters with ids, states, ISO times, counts, `evidenceRevision`, contract versions and the mode label; it excludes tokens, auth headers, URLs with query strings, profile prose, titles beyond 120 characters and any message text. Copy falls back to a read-only textarea when the clipboard is refused. | FP-11-AC04 | PR-C |
| FP1011-REQ-12 | Select Specter, inspect task, open a supported source action, and copy the summary all work with the keyboard alone, with visible focus and labelled controls; status changes are announced in a `role="status"` region. | FP-11-AC05 | PR-B, PR-C |
| FP1011-REQ-13 | No arena control approves, retries, stops or edits anything in Crew. The only write is the existing signed decision route reused by the Work review component, labelled "In-app acceptance (not a Crew tool approval)". "Waiting on you" appears nowhere. | FP-11-AC06, FP-11-AC01 | PR-C |
| FP1011-REQ-14 | Handoff links into Crew exist only for routes the handoff record marks `allowed` for Crew 0.12.2 with an evidence path; the list may be empty, and then the copy-summary fallback is the only handoff. | FP-11-AC01 | PR-C |
| FP1011-REQ-15 | "Arena" is the fourth tab of the Roster, Specters, Work shell; the shell is not restructured and the existing keyboard order is unchanged. | FP-10-AC02 | PR-B |
| FP1011-REQ-16 | The gallery gains eight portraits (ember, rattle, shard, lume, moss, tide, bur, poly), each validated, stored byte for byte and pinned by sha256; existing asset ids do not change. The gallery is never a class. | art release (K-4) | PR-A |
| FP1011-REQ-17 | `GET /api/scene-assets/{key}` serves only keys on a hash-pinned list as `scene-asset.v1`; an unknown or malformed key is 404 `unknown_scene_asset`; a file whose hash does not match is never served; there is no list, write or storage path. | SC10-1 | PR-A |
| FP1011-CI-01 | The route is signed, read only, JSON-only, returns `api-error.v1` errors (404 code `unknown_scene_asset`) and sets `X-Content-Type-Options: nosniff`, following `specter_routes.py`. | SC10-1 | PR-A |
| FP1011-CI-02 | The fixture SDK serves `GET /api/scene-assets/{key}` and the arena scenarios (`arena`, `arena-no-art`, `arena-perf-1`, `arena-stale`, `arena-empty`), marks fixture mode, and records every client call on `window` in the preview harness. | SC10-8, SC10-9 | PR-A, PR-B |
| FP1011-CI-03 | A handoff record in `docs/compatibility/` lists each Crew 0.12.2 route candidate as allowed, denied, unsupported or untested with its evidence. | FP-11-AC01 | PR-C |
| FP1011-CI-04 | `app.json` and `agents/` are unchanged; `backend/tests/test_manifest.py` and `scripts/check-fixtures.mjs` pass without edits, which proves no Crew grant was added. | FP-10-AC06 | PR-A to PR-C |
| FP1011-CI-05 | The real SDK throws `ApiError`, not `HostApiError`; `useHostApi` maps a thrown error with an integer HTTP status and a JSON body to `HostApiError`, so the stale, gone and denied fallbacks run on the installed host. | FP-11-AC03 | PR-A |
| FP1011-DEL-01 | The prefixes `FP-10-AC`, `FP-11-AC`, `FP1011-REQ`, `FP1011-CI` and `FP1011-DEL` are registered in `spec/ids.md` before this file uses them. No infix is added to the grammar in `scripts/check-spec-ids.mjs`. | none | PR-A |
| FP1011-DEL-02 | This folder holds `requirements.md`, `design.md` and `tasks.md`, and `npm run check:schema` passes the spec-id check on them. | none | PR-A |
| FP1011-DEL-03 | `docs/provenance.md` states that all shipped art was created by Eric Jeffers using ChatGPT (OpenAI) image generation, has one row per file with repo path, export file, pixels, bytes and sha256, names the QA files that do not ship, notes the OpenAI-terms recheck before FP-15, and no longer carries the retired wording. `DEPENDENCIES.md` agrees. | art release (K-4), B13 | PR-A |
| FP1011-DEL-04 | `npm run check:provenance` fails a tracked image with no row for its exact path and sha256, a tracked QA art file, a missing creation statement, the retired wording, and a Figma Make row that names an untracked `ui/src/` path. Each is proved by a unit test. | B13 | PR-A |
| FP1011-DEL-05 | `docs/provenance.md` lists every export file ported by this feature (PR-B arena files, PR-C inspector) with what changed, and lists the scene SVGs as Figma Make-authored vector code ported as TSX. | K-3 | PR-B, PR-C |
| FP1011-DEL-06 | `contracts/OWNERS.md` has a `scene-asset` row owned by specter-identity, DRAFT in PR-A and FROZEN in the last commit of PR-C. | FP-02-AC04 | PR-A, PR-C |
| FP1011-DEL-07 | The producer meta-test counts twenty-one schemas and the `scene-asset` `$id` is named next to `compile_schema` in a producer test; `contracts.test.ts` lists the schema. | FP-02-AC04 | PR-A |
| FP1011-DEL-08 | The bundle cap in `ui/src/build-output.test.ts` stays a measured budget (measured size plus 25%, rounded up to 1,000), set in PR-B and restated in PR-C; the bundle carries no base64 image payload, no PNG header and no raster file-name literal; `ui/dist` stays exactly `index.mjs`. | K-3 | PR-B, PR-C |
| FP1011-DEL-09 | `tests/e2e/arena.spec.ts` drives the preview harness through the Arena tab, mode label, parity, concurrency, blocked and awaiting-review conditions, accept and defeat, return after a gap, stale and permission fallbacks, keyboard use, no-write recording and reduced motion. | FP-10-AC01 to FP-10-AC06, FP-11-AC01 to FP-11-AC06 | PR-B, PR-C |
| FP1011-DEL-10 | The profile `arena-perf-1` (20 bots, 100 open WorkItems including 10 containers, 30 working attempts, 12 recently accepted) is measured on a named machine; the numbers, five runs, the machine profile and the method are committed in `performance.md` in this folder. | FP-10 human decision | PR-C |
| FP1011-DEL-11 | `docs/compatibility/monitoring-scope.md` records that the bot-dashboard summary records (FD-31) are skipped and that no grant was added; its status lines and decisions are unchanged. | K-6 | PR-C |
| FP1011-DEL-12 | No change to `.github/workflows/`, root `package.json`, any lockfile, `requirements.txt`, `backend/pyproject.toml`, `app.json` or `agents/`. No new dependency of any kind. | escalation list | PR-A to PR-C |
| FP1011-DEL-13 | `spec/index.md`, `.kiro/specs/README.md` and `docs/architecture/component-index.md` are current in the PR that changes each status. | none | PR-A, PR-B, PR-C |

## Exclusions

No replay player, no recorded-data ingestion, no bot-dashboard summary records, no manual combat controls, no multiplayer, no game server, no pathfinding, no NPC farming, no canvas-only UI, no autonomous remediation, no session control, no transcript indexing, no performance grading, no new Crew grant, no new dependency, no new write route, no migration, no change to a FROZEN schema. From the export: no replay screens, `EnvironmentAssetLab`, `EffectsGallery`, `CampaignsPage`, `DemoScenarioControls`, map calibration editor.
