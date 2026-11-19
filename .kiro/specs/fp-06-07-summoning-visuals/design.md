# FP-06+07 design

> Superseded by FP-16 (program amendment PA-2, 2026-11-19): summoning, the `/api/chat` grant, the summoner agent and `agents/` were removed. This folder is kept as history; `.kiro/specs/fp-16-heroes-parity/` is current.

Status: planned. The five wire contracts `specter-profile`, `specter`, `specters`, `summoning` and `portrait-asset` are `DRAFT` in `contracts/OWNERS.md` until their first UI consumer merges (PR-C).

## Shape of the work

| Component | PR-A | PR-B | PR-C |
|---|---|---|---|
| crew-integration | none | `app.json` grant, `agents/specter-summoner.json`, `summoner/`, `specter_routes.py`, `app.py` wiring, manifest tests | none |
| work-ledger | migration 0005, `store/specters.py`, isolation tests | none | none |
| specter-identity | five contracts, cases, OWNERS rows, guard exemptions | `specters/` package, bundled A01 art, PNG re-encode, `SpecterService` | OWNERS freeze flips |
| experience | Roster and Specters tab shell, `BACKEND_ONLY` rows in `contracts.test.ts` | none | `ui/src/specters/`, roster portraits, fixtures, types |
| delivery | spec ids, this folder, B11 fix, producer meta-test count | check-fixtures grant, monitoring-scope paragraph, provenance, probe staging | bundle budget, e2e spec, doc upkeep |

## Decisions

| Id | Decision |
|---|---|
| FP67-D1 | Generation uses the app token, `POST /api/chat` and one app agent with no tools (grant A, approved by Eric on 2026-11-18). Nothing else is granted. |
| FP67-D2 | The generation grant is not monitoring. App-owned slots are not delivered by `slots:user`, so the collector never sees them and they never become attempts. |
| FP67-D3 | Spec ids: `FP0607-CI`, `FP0607-WL` and `FP0607-DEL` follow the component infixes. specter-identity and experience requirements use `FP0607-REQ`, as FP-04 did for experience. The id grammar in `scripts/check-spec-ids.mjs` is not changed. |
| FP67-D4 | `/api/chat` is the first release grant beyond `/api/agents`. `scripts/check-fixtures.mjs` and `test_manifest.py` change to name it, and a guard keeps the agent file tool-free. |
| FP67-D5 | The A01 portraits are a bundled gallery. Their provenance is disclosed in `docs/provenance.md` and listed in `DEPENDENCIES.md` as assets, not packages. |
| FP67-D6 | Spec folder, docs and checks land in PR-A (ids, folder, B11, meta-test) and PR-B (grant docs, provenance, guards), so each PR carries its own documentation. |

## Boundaries that stay as they are

No workflow, lockfile, `requirements.txt` or `backend/pyproject.toml` edit. `scripts/check-spec-ids.mjs`, `scripts/check-schema.mjs` and `scripts/check-provenance.mjs` are not edited. The monitoring scope in `docs/compatibility/monitoring-scope.md` keeps its decisions; one section is added.
