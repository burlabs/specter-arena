# FP-06+07 tasks

> Superseded by FP-16 (program amendment PA-2, 2026-11-19): summoning, the `/api/chat` grant, the summoner agent and `agents/` were removed. This folder is kept as history; `.kiro/specs/fp-16-heroes-parity/` is current.

Shared single-writer files change in one open PR at a time. FP-06+07 changes none of root `package.json`, any lockfile, `requirements.txt` or `.github/workflows/`. `contracts/OWNERS.md` changes in PR-A (rows) and PR-C (flips, last commit). `ui/src/contracts/contracts.test.ts` changes in PR-A (`BACKEND_ONLY`) and PR-C (`TYPED`). `ui/src/build-output.test.ts` changes in PR-C.

## PR-A: shell, contracts and store
- [x] T1 delivery: `spec/ids.md` rows, this folder, B11 fix in `tests/e2e/monitoring.spec.ts`, producer meta-test count of fifteen (FP0607-DEL-01, FP0607-DEL-02, FP0607-DEL-03, FP0607-DEL-07)
- [x] T2 specter-identity: five schemas, cases, OWNERS DRAFT rows, guard exemptions (FP0607-REQ-12, FP0607-REQ-16)
- [x] T3 work-ledger: migration 0005, `store/specters.py`, isolation and invariant tests (FP0607-WL-01 to FP0607-WL-08)
- [x] T4 experience: Roster and Specters tab shell, `BACKEND_ONLY` rows (FP0607-REQ-15)

## PR-B: backend generation and assets
- [x] T5 crew-integration: `app.json` grant, `agents/specter-summoner.json`, `summoner/`, `specter_routes.py`, `app.py` wiring, manifest tests (FP0607-CI-01 to FP0607-CI-05)
- [x] T6 specter-identity: `specters/` package, PNG re-encode, bundled art, `SpecterService`, fixed prompt (FP0607-REQ-01 to FP0607-REQ-06, FP0607-REQ-09, FP0607-REQ-13, FP0607-REQ-14)
- [x] T7 delivery: check-fixtures grant and agent guard, probe staging, monitoring-scope paragraph, provenance and dependency disclosure (FP0607-DEL-04, FP0607-DEL-05, FP0607-DEL-06, FP0607-DEL-09)

## PR-C: UI
- [x] T8 experience: `ui/src/specters/`, roster portraits, fixtures, types, scoped CSS (FP0607-REQ-07, FP0607-REQ-08, FP0607-REQ-11, FP0607-REQ-15)
- [x] T9 delivery: bundle budget, `tests/e2e/specters.spec.ts`, provenance rows for the Figma Make files, doc upkeep (FP0607-DEL-06, FP0607-DEL-08, FP0607-DEL-11, FP0607-DEL-12)
- [x] T10 specter-identity: FROZEN flips, last commit (FP0607-REQ-16)

## Owner step
- [ ] OA-3: approve the staged grant update on the installed app and run one live summoning (FP0607-REQ-01). Crew stages added grants until the owner approves them.
