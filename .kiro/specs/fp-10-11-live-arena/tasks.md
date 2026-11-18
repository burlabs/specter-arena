# FP-10+11 tasks

Shared single-writer files change in one open PR at a time. FP-10+11 changes none of root `package.json`, any lockfile, `requirements.txt`, `app.json`, `agents/` or `.github/workflows/`. `docs/provenance.md` and `contracts/OWNERS.md` change in PR-A (rows), PR-B and PR-C (provenance rows) and PR-C (the FROZEN flip, last commit). `ui/src/build-output.test.ts` changes in PR-B (first budget) and PR-C (restated). `ui/src/observatory/ObservatoryPage.tsx` changes in PR-B only.

## PR-A: provenance, art and the scene-asset contract
- [x] T1 delivery: `spec/ids.md` rows, this folder, `spec/index.md`, `.kiro/specs/README.md`, `component-index.md` (FP1011-DEL-01, FP1011-DEL-02, FP1011-DEL-13)
- [x] T2 delivery: B13 rewrite of `docs/provenance.md` and `DEPENDENCIES.md`, `check-provenance.mjs` rules and tests (FP1011-DEL-03, FP1011-DEL-04)
- [x] T3 specter-identity: eight gallery portraits, scene rasters, `scene-asset.v1` schema and cases, OWNERS DRAFT row, producer test and count of twenty-one (FP1011-REQ-16, FP1011-REQ-17, FP1011-DEL-06, FP1011-DEL-07)
- [x] T4 crew-integration: `GET /api/scene-assets/{key}` route, `ApiError` mapping, fixture SDK scene assets (FP1011-CI-01, FP1011-CI-02, FP1011-CI-04, FP1011-CI-05)

## PR-B: the arena
- [x] T5 experience: scene view model, effect map, scene, rail, minimap, list view, minions, cue layer, Arena tab, scoped `arena.css`, marks (FP1011-REQ-01 to FP1011-REQ-08, FP1011-REQ-12, FP1011-REQ-15)
- [x] T6 crew-integration: arena fixture scenarios incl. `arena-perf-1`, fixture call log (FP1011-CI-02)
- [x] T7 delivery: Figma Make rows, measured bundle budget and raster guard, `tests/e2e/arena.spec.ts` smoke part (FP1011-DEL-05, FP1011-DEL-08, FP1011-DEL-09)

## PR-C: the inspector, handoffs and the performance record
- [x] T8 experience: inspector, handoffs, diagnostic summary, celebrations and re-baseline, mode labels (FP1011-REQ-05, FP1011-REQ-09 to FP1011-REQ-14)
- [x] T9 crew-integration: handoff route record (FP1011-CI-03)
- [x] T10 delivery: inspector e2e, `arena-perf-1` run and `performance.md`, restated budget, monitoring-scope section, doc upkeep (FP1011-DEL-09, FP1011-DEL-10, FP1011-DEL-11, FP1011-DEL-13)
- [x] T11 specter-identity: FROZEN flip of `scene-asset`, last commit (FP1011-DEL-06)
