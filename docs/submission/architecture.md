# Architecture

Draft for Eric's review. The agent does not submit.

Last verified commit: `3895df06d69cf14e9e78ea59bf3458cefb6894df` (`main` after FP-28 #220; re-read for release candidate RC-8)

## One installable Crew app

Specters of the Abyss is one Kiro Crew app. Crew copies the app folder, serves the UI bundle in its dashboard and starts the backend (`app.json`). `docs/architecture/component-index.md` names the five logical components used for planning and review: delivery, crew-integration, work-ledger, specter-identity and experience.

## UI

A React bundle, `ui/dist/index.mjs`, built by Vite as a library. Host-provided modules stay external (`ui/host-modules.ts`, `HOST_EXTERNALS`). Crew does not build apps, so a release ships the built file. Art does not live in the bundle: portraits and scene images come from the backend, and a build guard fails if a raster ends up in `ui/dist`. A second guard caps the bundle at 367,000 characters (`ui/src/build-output.test.ts`). The cap was 419,000 after the Arena attack effects (FP-21) and was lowered when FP-22 deleted the Work tab and its review flow (the build was 293,115 characters then, and 307.49 kB after FP-23, per the FP-23 report).

## Backend

A Starlette ASGI app (`app.json` `backend.entryPoint` is `backend/app.py`) that Crew starts on its bundled Python 3.12 with only the packages in `requirements.txt`. Imports are package-relative for that reason (`AGENTS.md`). `GET /health` is the liveness probe (`app.json` `backend.healthCheck`).

## Requests

The UI calls `/apps/specter-arena/api/*`. The Crew gateway proxies those to the backend's `/api/*` and signs each request; the backend checks the signature (`backend/specter_arena/proxy_auth.py`). The manifest declares only these grants: the app's own API prefix, `/api/agents` and the event `slots:user`. It declares no agent.

## Data

SQLite in the app's Crew data directory, `data/store/specter-arena.db`, with checksummed migrations 0001 to 0011 (`backend/specter_arena/store/`). The store version is 11. The app copies the database to `data/store/backups/` before a migration and keeps three copies. A collector records bot attempts observed through Crew. Tasks are built from those attempts and closed by a sweep inside the ingest transaction; `task` and `task_xp_entry` (migration 0010) hold them and their single award each. The earlier work ledger (work items, decisions, `xp_entry`) stays as history. The Specter tables hold hero assignments, avatar revisions and assets; migration 0011 rebuilt `hero_assignment` so that a bot can have no hero and the owner picks one.

Automatic tasks and XP (FP-22, migration 0010). Every bot-started worker attempt is one task, and a bot's own turn becomes a task once it has run 60 seconds. The task id is a hash of the attempt id, so a reopened worker slot is the same task and a projection rebuild changes nothing. The sweep runs on every heartbeat and once at boot, and does nothing while collection is paused. A task whose attempt has ended is credited when the end signal is known, no coverage gap overlaps the attempt and the last stored row of the slot shows no pending approval or question. Otherwise it is not credited, with the first failing reason (`unknown-terminal`, `coverage-gap`, `waiting-at-end`). `xp-policy-2` pays 10 XP plus 1 per full 2 minutes, at most 30, to the task's own bot, with no split. Triggers on `task_xp_entry` keep it append-only and one award per task. The signed read routes are `GET /api/tasks`, `GET /api/tasks/{taskId}` and `GET /api/xp?view=tasks`.

Hero assignment (FP-23, migration 0011). A new binding has no hero. `POST /api/specters/{bindingId}/hero` assigns one of the 11 (or a random one, chosen with `secrets.choice` among the least held) and is final. `GET /api/specters?view=assignment` returns the assigned heroes and the ids of the unassigned bots. Placement on the map is seeded by a per-visit random value and the binding id, in the UI only.

Data lifecycle (FP-19, migration 0009). The Data tab and its signed routes (`GET /api/data`, `POST /api/data/retention`, `/purge`, `/export`, `/asset-cleanup`, and `POST /api/collector`) let the owner set a retention window, run an explicit purge of old observations, quarantine rows and ended unlinked attempts, export the database to `data/exports/`, remove unused uploads and pause or resume collection (`backend/specter_arena/lifecycle/`, `ui/src/lifecycle/`). Nothing runs on a schedule. A purge or cleanup takes a verified backup first. Deletes pass only inside a running `lifecycle_run`, enforced by SQL triggers, and identity, heroes, work items, decisions and the XP ledger can never be deleted. A store sweep removes orphan temp files at start. The routes sit under the existing `/apps/specter-arena/api/*` grant, so no grant was added.

## Contracts

Wire shapes are JSON Schema draft-07 files in `contracts/schemas/`, owned per `contracts/OWNERS.md`. A schema that the UI already consumes is marked FROZEN, and changing it needs a new version. `npm run check:schema` validates them offline.

## Read-only arena

The arena is a pure function of the polled reads (roster, specters, tasks, XP). Selection, camera, panel collapse, hero placement and animation state live in React state only. It makes no write. Hero placement picks spots on the map's lanes and jungle clearings from a fixed seed and the sorted binding ids, so a hero stands on the same spot at every visit (FP-24, `ui/src/arena/laneSlots.ts`), and a task's minion stands beside its hero. Attacks, casts and strikes (FP-21) and the minion's strike back and the hero's flinch (FP-24) are drawn from the same polled reads and never change a number. The UI writes only on an explicit click: a hero assignment (walkthrough, Roster or bot detail), an avatar choice, and the Data tab's actions.

## Invariants

- Tokens, session length and animation never become XP.
- XP is credited automatically, once per task, when a task the app observed ends cleanly. It reflects observed activity, not verified outcomes, and the UI and docs say so. This replaced the earlier rule that a human accepted each work item (PA-3, 2026-11-22). A credited task's XP is never corrected.
- A Crew tool approval is not an outcome. A task that ended while an approval or question was pending is not credited.
- XP lives on the bot binding, not on a Specter, and level is derived at read time.
- Hero assignment never earns XP. Minion size and hero position are presentation only.

Sources: `docs/architecture/component-index.md`, `docs/compatibility/monitoring-scope.md`, `docs/compatibility/handoff-routes.md`, `.kiro/specs/*/design.md`.
