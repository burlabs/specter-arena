# FP-08+09 tasks

Shared single-writer files change in one open PR at a time. FP-08+09 changes none of root `package.json`, any lockfile, `requirements.txt` or `.github/workflows/`. `contracts/OWNERS.md` changes in PR-A (rows) and PR-C (flips, last commit). `ui/src/contracts/contracts.test.ts` changes in PR-A (`BACKEND_ONLY`) and PR-C (`TYPED`). `ui/src/build-output.test.ts` changes in PR-C. `backend/app.py` changes in PR-B only.

## PR-A: spec, contracts, store and policy
- [x] T1 delivery: `spec/ids.md` rows, this folder, `spec/index.md`, `.kiro/specs/README.md`, `component-index.md`, `DEPENDENCIES.md` line, producer meta-test count of twenty (FP0809-DEL-01, FP0809-DEL-02, FP0809-DEL-04, FP0809-DEL-07)
- [x] T2 work-ledger: five schemas, cases, OWNERS DRAFT rows, `BACKEND_ONLY` rows (FP0809-REQ-13, FP0809-REQ-18, FP0809-DEL-03, FP0809-DEL-05)
- [x] T3 work-ledger: migration 0006, `store/xp_policy.py`, `store/work.py`, `store/xp.py`, store errors, `schema-v6.sql` (FP0809-WL-01 to FP0809-WL-08, FP0809-WL-10)
- [x] T4 work-ledger: transition, concurrency, seeded property, isolation and source-guard tests, and the store-level producer test of the five contracts (FP0809-REQ-01 to FP0809-REQ-12, FP0809-WL-09)

## PR-B: service, routes and docs
- [x] T5 crew-integration: `work/service.py`, `work_routes.py`, `app.py` wiring, route tests, producer test on real service bodies (FP0809-CI-01 to FP0809-CI-05)
- [x] T6 delivery: monitoring-scope paragraph, doc upkeep (FP0809-DEL-06, FP0809-DEL-07)

## PR-C: UI
- [x] T7 experience: `ui/src/work/`, Work tab entry, XP in roster detail, Progression panel, types, fixtures, scoped CSS (FP0809-REQ-15 to FP0809-REQ-17, FP0809-DEL-11)
- [x] T8 delivery: provenance rows, bundle budget, `tests/e2e/work.spec.ts`, doc upkeep (FP0809-DEL-08 to FP0809-DEL-10, FP0809-DEL-07)
- [x] T9 work-ledger: FROZEN flips and the `TYPED` rows, last commit (FP0809-REQ-18, FP0809-DEL-05)
