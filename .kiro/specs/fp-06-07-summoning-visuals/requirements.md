# FP-06+07 requirements: summoning, persistent Specters, and safe visuals

> Superseded by FP-16 (program amendment PA-2, 2026-11-19): summoning, the `/api/chat` grant, the summoner agent and `agents/` were removed. This folder is kept as history; `.kiro/specs/fp-16-heroes-parity/` is current.

One session, one design, one plan, at most three PRs (batching approved by Eric on 2026-11-15, limits in the program context §3). PR-A is the shell, contracts and store, PR-B the backend generation and assets, PR-C the UI. Requirement ids are registered in `spec/ids.md`. Decisions are recorded in `design.md`.

Under program amendment PA-1, read every "agent" below that anchors a Specter, a binding or a roster entry as bot. The Grimoire is cut (Eric, 2026-11-17): this feature owns the classless `specter-profile.v1` contract, a minimal creative brief and one fixed generation prompt. Where a criterion mentions FP-05 contracts, read the specter-identity contracts of this feature instead.

## Acceptance criteria (verbatim from the intake)

- **FP-06-AC01:** A real authorized generation creates an original named Specter and the accepted result persists after refresh, restart, and agent rename.
- **FP-06-AC02:** Similar agents can receive different identities without passing through a hidden classifier.
- **FP-06-AC03:** Rename, visual reroll, and targeted revision preserve agent configuration, tools, permissions, accepted work, and XP history.
- **FP-06-AC04:** Malformed output, unsupported capability references, refusal, timeout, duplicate request, and stale-result races are handled without overwriting good state.
  - Reading (Q2, 2026-11-18): the profile has no capability reference field, so "unsupported capability references" has no input to reject. A generated `signatureAction` is flavor only. The other five cases are tested.
- **FP-06-AC05:** A malicious agent description cannot obtain new tool rights or cause arbitrary application actions.
- **FP-06-AC06:** Generation is bounded and internal generation tasks are tagged so the app does not reward itself for generating more Specters.
- **FP-07-AC01:** Distinct original accepted identities can display distinct assets in one consistent visual system; no class selection is introduced.
- **FP-07-AC02:** The UI works with no image-service key and clearly distinguishes a fallback token from generated portrait art.
- **FP-07-AC03:** Bad MIME data, oversized images, unsafe active content, missing assets, and path traversal are rejected safely.
- **FP-07-AC04:** Changing a portrait leaves agent binding, identity history, and XP unchanged.
- **FP-07-AC05:** Reduced-motion and keyboard-accessible equivalents work; visual effects do not change domain state.
- **FP-07-AC06:** If the optional provider is included, a real bounded generation is verified, failure/cancel does not replace the current asset, and a late result cannot overwrite a newer revision.
  - NOT APPLICABLE. Cut by Eric on 2026-11-17: the optional external image-generation adapter is out of scope for this feature. No requirement row, task or test maps to it. It is defined here only so the intake text keeps one home.

## Requirements

One `FP0607-REQ` row per criterion, then the cross-cutting rules of specter-identity and experience. The id grammar has no infix for those two components, so they use `REQ` (see `spec/ids.md`).

| Id | Requirement | Acceptance criteria / source | Slice |
|---|---|---|---|
| FP0607-REQ-01 | One real generation runs through the approved Crew grant (`/api/chat` and the app agent `specter-summoner`) and returns a profile validated against `specter-profile.v1`. A user accepts it, and the accepted profile is stored as an immutable revision, not a seed. After a browser refresh, a backend restart and a bot display-name change, the same Specter is shown for the same `bindingId`. | FP-06-AC01 | PR-B, PR-C |
| FP0607-REQ-02 | The generator input is the bot display name from the store plus the optional purpose and style text the user typed for this request. It carries no memory, notes, goals, ledger, transcript, slot or attempt data and no field of any other bot, so two similar bots can receive different identities and no classifier exists. | FP-06-AC02 | PR-B |
| FP0607-REQ-03 | Rename, reroll with `keep`, manual entry, portrait change and archive write only `specter` and `specter_revision` rows. They never write binding, display-revision, observation, attempt, coverage or projection rows, and never touch the bot's agent configuration, tools or permissions. | FP-06-AC03 | PR-A, PR-B |
| FP0607-REQ-04 | Malformed JSON, an unknown key, an over-long field, a refusal text, a timeout, a duplicate `requestId` and a stale or late result each end in a typed failure or the existing record. None of them changes the active Specter. Accept needs a `ready` request and the current `expectedVersion`. | FP-06-AC04 | PR-A, PR-B |
| FP0607-REQ-05 | The prompt places user text in a delimited data block marked untrusted. The summoner agent has no tools, no MCP servers and no `.mcp.json`. Output is parsed as data only: no field is executed, followed as a link or used as a path, tool name or permission. A hostile description yields at most a profile that fails validation. | FP-06-AC05 | PR-B |
| FP0607-REQ-06 | Generation is bounded: one request in flight per install, 5 per bot and 20 per install in a rolling 24 hours, 90 seconds per request, one retry only on malformed JSON. Every `generation_request` row carries `internal_tag = 'summoning'`, and a test proves a full summoning writes no observation or attempt row. | FP-06-AC06 | PR-A, PR-B |
| FP0607-REQ-07 | Distinct accepted Specters show distinct portraits (bundled A01 art or an uploaded PNG) in one shared treatment. No class, archetype or selector exists in any contract, route, store column or UI control. | FP-07-AC01 | PR-B, PR-C |
| FP0607-REQ-08 | The app needs no image-service key. A bot with no portrait shows a placeholder token (initials on a colour derived from `specterId`) labelled "Placeholder token, not a portrait". A bundled or uploaded image is labelled with its origin. | FP-07-AC02 | PR-C |
| FP0607-REQ-09 | An upload is accepted only as PNG up to 1 MiB, at most 1024 by 1024 pixels, 8-bit RGB or RGBA, not interlaced, and is re-encoded with only IHDR, one IDAT and IEND. Wrong signature, bad CRC, oversize, active content, truncated or bomb data, an unknown asset id and a path-shaped id return typed errors and store nothing. Assets are served by store id only. | FP-07-AC03 | PR-B |
| FP0607-REQ-10 | A portrait change appends one revision on the same `specterId` and `bindingId`. Binding, earlier revisions and every other table are unchanged; a test compares row counts and hashes before and after. XP does not exist yet, so the test names the tables an XP feature will add. | FP-07-AC04 | PR-A, PR-B |
| FP0607-REQ-11 | Every Specter view has a keyboard-operable list or form counterpart and readable text. Idle and active effects are CSS only, are off under `prefers-reduced-motion`, and never read or write domain state. | FP-07-AC05 | PR-C |
| FP0607-REQ-12 | `specter-profile.v1` is closed prose: name, epithet, personality, appearance, mannerism, signature action, assignment rationale and art brief. It has no class, archetype, species, role, tier, rank, score or capability field, and `npm run check:schema` passes the no-class guard with only reviewed exemptions for provenance and lifecycle fields. | FP-02-AC06 | PR-A |
| FP0607-REQ-13 | One fixed prompt is kept in code with `SUMMON_PROMPT_VERSION`. The version is recorded on each generation. Neither the prompt text nor the raw model reply is stored. There is no registry, snippet library or evaluation corpus. | FP-06-AC01, FP-06-AC05 | PR-B |
| FP0607-REQ-14 | A manual profile, typed by the user when generation fails, is saved with `source = "manual"`. It is never labelled as AI generated and never counts against the generation budget. | FP-06-AC04 | PR-B, PR-C |
| FP0607-REQ-15 | The UI adds a Specters tab beside the roster and shows each Specter's portrait or token beside the bot initials in roster rows. It shows the remaining generation budget, a visible failure state with the existing Specter kept, and Accept, Reroll, Discard, Rename, portrait choice, manual entry and archive. | FP-06-AC01, FP-06-AC03, FP-06-AC04 | PR-A, PR-C |
| FP0607-REQ-16 | The five new contracts (`specter-profile`, `specter`, `specters`, `summoning`, `portrait-asset`) are `DRAFT` in `contracts/OWNERS.md` in PR-A and `FROZEN` in the last commit of PR-C, the first UI consumer. | FP-02-AC04 | PR-A, PR-C |
| FP0607-CI-01 | `app.json` gains `"/api/chat"` in `permissions.api` and a top-level `agents` list naming `agents/specter-summoner.json`. The agent file sets `tools` to `[]`, `mcpServers` to `{}`, `includeMcpJson` to false and `model` to `auto`. No event, `spawn`, `jobs`, `network` or `sessionApproval` is added. | FP-06-AC05, FP-06-AC06 | PR-B |
| FP0607-CI-02 | The summoner client uses only the app token and `POST /api/chat` on an app-owned slot of `specter-arena--specter-summoner`. It never names another agent, never reads a slot it did not create, and closes the slot after the result. A unit test asserts the agent string and the paths used. | FP-06-AC05, FP-06-AC06 | PR-B |
| FP0607-CI-03 | The routes of the shared contract (SC6-5) are signed, JSON-only, cap the body at 1.5 MB, return `api-error.v1` bodies, and return the same 404 for an unknown and a malformed id. Their bodies validate against the five schemas in producer tests. | FP-06-AC04, FP-07-AC03 | PR-B |
| FP0607-CI-04 | `backend/app.py` builds `SpecterService` in the lifespan with lazy imports, so importing the app loads neither the store, the specters package nor the summoner. A missing gateway environment leaves generation unavailable (`generation_unavailable`) and the rest of the app running. | FP-06-AC04 | PR-B |
| FP0607-CI-05 | `backend/tests/test_manifest.py` and `scripts/check-fixtures.mjs` are updated for the one approved grant and the one agent, and still prove the other denied paths stay ungranted. | FP-06-AC05 | PR-B |
| FP0607-WL-01 | Migration 0005 creates `asset`, `generation_request`, `specter`, `specter_revision` (STRICT, CHECKs, indexes, triggers) and no statement touches an earlier table. | FP-02-AC06, FP-06-AC03 | PR-A |
| FP0607-WL-02 | `accept_request` stores the accepted profile text in an immutable revision in one write transaction, only for a `ready` request and the current `version`. | FP-06-AC01, FP-06-AC04 | PR-A |
| FP0607-WL-03 | `create_request` returns the existing record for a repeated request id, allows one queued or running request per install, and enforces 5 per binding and 20 per install per rolling 24 hours counted from `running`. | FP-06-AC04, FP-06-AC06 | PR-A |
| FP0607-WL-04 | Status changes are conditional (`queued` to `running` to `ready`, `failed` or `cancelled`; `ready` to `accepted`, `superseded` or `cancelled`); a late result changes nothing; the startup sweep fails leftovers with `interrupted`. | FP-06-AC04 | PR-A |
| FP0607-WL-05 | Rename, manual edit, portrait change and archive append revisions with an optimistic `version`; rename cannot change any field except name and epithet. | FP-06-AC03, FP-07-AC04 | PR-A |
| FP0607-WL-06 | `insert_asset` is idempotent by sha256, content addressed, PNG-signature checked, and the bytes stay in the database. | FP-07-AC03 | PR-A |
| FP0607-WL-07 | No store function or trigger of this feature writes observation, attempt, coverage, projection or binding tables (full-flow invariant test). | FP-06-AC03, FP-06-AC06, FP-07-AC04 | PR-A |
| FP0607-WL-08 | No denied token appears in any 0005 identifier or column name; a fixture upgrade from schema 4 and a downgrade guard are tested. | FP-02-AC06 | PR-A |
| FP0607-DEL-01 | The prefixes `FP-06-AC`, `FP-07-AC`, `FP0607-REQ`, `FP0607-CI`, `FP0607-WL` and `FP0607-DEL` are registered in `spec/ids.md` before this file uses them. No new infix is added to the grammar in `scripts/check-spec-ids.mjs`. | FP-02-AC04 | PR-A |
| FP0607-DEL-02 | This folder holds `requirements.md`, `design.md` and `tasks.md`, and `npm run check:schema` passes the spec-id check on them. | FP-02-AC04 | PR-A |
| FP0607-DEL-03 | The producer meta-test counts fifteen schemas, and each of the five new `$id`s is named next to `compile_schema` in a producer test. | FP-02-AC04 | PR-A, PR-B |
| FP0607-DEL-04 | `scripts/check-fixtures.mjs` allows exactly the release grants plus `/api/chat`, and fails a release manifest whose `agents` list differs from the one summoner file or whose agent file grants tools, MCP servers or `.mcp.json`. Its tests cover both. | FP-06-AC05 | PR-B |
| FP0607-DEL-05 | `docs/compatibility/monitoring-scope.md` states that the generation grant is not monitoring, that app-owned generation slots are invisible to the `slots:user` collector, and what the grant does not widen. Its status lines are unchanged. | FP-06-AC06 | PR-B |
| FP0607-DEL-06 | `docs/provenance.md` lists the three A01 portraits with their sha256 and the Figma Make files ported by this feature. `DEPENDENCIES.md` gains a bundled-assets table and no package entry. | FP-07-AC01 | PR-B, PR-C |
| FP0607-DEL-07 | `tests/e2e/monitoring.spec.ts` waits for 21 list items before counting them (B11), so the all-reasons test is not flaky. | none | PR-A |
| FP0607-DEL-08 | The bundle cap in `ui/src/build-output.test.ts` is a measured budget (measured size plus 25%, rounded up to 1 kB), stated with its measurement in PR-C. `ui/dist` stays exactly `index.mjs`. | FP-07-AC05 | PR-C |
| FP0607-DEL-09 | `scripts/stage-probe-app.mjs` does not carry the release `agents` key into a staged probe manifest, and its test says so. | FP-06-AC05 | PR-B |
| FP0607-DEL-10 | No change to `.github/workflows/`, root `package.json`, any lockfile, `requirements.txt` or `backend/pyproject.toml`. No new dependency of any kind. | FP-02-AC04 | PR-A to PR-C |
| FP0607-DEL-11 | `spec/index.md`, `.kiro/specs/README.md` and `docs/architecture/component-index.md` are current in the PR that changes each status. | none | PR-A, PR-C |
| FP0607-DEL-12 | `tests/e2e/specters.spec.ts` drives the preview harness through summon, accept, rename, portrait choice, failure and reduced motion. | FP-06-AC04, FP-07-AC05 | PR-C |

## Exclusions

No external image generation, no Grimoire or registry, no class or archetype, no operational-prompt rewriting, no level-based unlock, no bulk generation, no JPEG, WebP or SVG, no sprite sheet, no XP, level or accepted work (FP-08+09), no use of `/api/members/*`, no change to the monitoring scope, no migration 0006.
