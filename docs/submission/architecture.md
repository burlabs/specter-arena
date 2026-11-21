# Architecture

Draft for Eric's review. The agent does not submit.

Last verified commit: `d53b16ea6373094cb0835352adf68c255a9e1398` (`main` after the logo PR #181; re-read for release candidate RC-3)

## One installable Crew app

Specter Arena is one Kiro Crew app. Crew copies the app folder, serves the UI bundle in its dashboard and starts the backend (`app.json`). `docs/architecture/component-index.md` names the five logical components used for planning and review: delivery, crew-integration, work-ledger, specter-identity and experience.

## UI

A React bundle, `ui/dist/index.mjs`, built by Vite as a library. Host-provided modules stay external (`ui/host-modules.ts`, `HOST_EXTERNALS`). Crew does not build apps, so a release ships the built file. Art does not live in the bundle: portraits and scene images come from the backend, and a build guard fails if a raster ends up in `ui/dist`. A second guard caps the bundle at 419,000 characters (`ui/src/build-output.test.ts`); the cap was raised from 305,000 for the Arena attack effects (FP-21).

## Backend

A Starlette ASGI app (`app.json` `backend.entryPoint` is `backend/app.py`) that Crew starts on its bundled Python 3.12 with only the packages in `requirements.txt`. Imports are package-relative for that reason (`AGENTS.md`). `GET /health` is the liveness probe (`app.json` `backend.healthCheck`).

## Requests

The UI calls `/apps/specter-arena/api/*`. The Crew gateway proxies those to the backend's `/api/*` and signs each request; the backend checks the signature (`backend/specter_arena/proxy_auth.py`). The manifest declares only these grants: the app's own API prefix, `/api/agents` and the event `slots:user`. It declares no agent.

## Data

SQLite in the app's Crew data directory, `data/store/specter-arena.db`, with checksummed migrations 0001 to 0009 (`backend/specter_arena/store/`). The store version is 9. The app copies the database to `data/store/backups/` before a migration and keeps three copies. A collector records bot attempts observed through Crew; the work ledger holds work items, decisions and XP entries; the Specter tables hold identities and assets.

Data lifecycle (FP-19, migration 0009). The Data tab and its signed routes (`GET /api/data`, `POST /api/data/retention`, `/purge`, `/export`, `/asset-cleanup`, and `POST /api/collector`) let the owner set a retention window, run an explicit purge of old observations, quarantine rows and ended unlinked attempts, export the database to `data/exports/`, remove unused uploads and pause or resume collection (`backend/specter_arena/lifecycle/`, `ui/src/lifecycle/`). Nothing runs on a schedule. A purge or cleanup takes a verified backup first. Deletes pass only inside a running `lifecycle_run`, enforced by SQL triggers, and identity, heroes, work items, decisions and the XP ledger can never be deleted. A store sweep removes orphan temp files at start. The routes sit under the existing `/apps/specter-arena/api/*` grant, so no grant was added.

## Contracts

Wire shapes are JSON Schema draft-07 files in `contracts/schemas/`, owned per `contracts/OWNERS.md`. A schema that the UI already consumes is marked FROZEN, and changing it needs a new version. `npm run check:schema` validates them offline.

## Read-only arena

The arena is a pure function of the polled reads (roster, specters, work, XP). Selection, camera and animation state live in React state only. Its one write is the Work tab's decision route, reached by an explicit click. Attacks, casts and strikes (FP-21) are drawn from the same polled reads and never change a number.

## Invariants

- Tokens, session length and animation never become XP.
- Acceptance is a human click. A Crew tool approval is not acceptance, and the UI labels in-app acceptance as such.
- XP lives on the bot binding, not on a Specter, and level is derived at read time.
- Hero assignment never earns XP.

Sources: `docs/architecture/component-index.md`, `docs/compatibility/monitoring-scope.md`, `docs/compatibility/handoff-routes.md`, `.kiro/specs/*/design.md`.
