# FP-04 tasks

Shared single-writer files change in one open PR at a time. FP-04 changes none of root `package.json`, any lockfile or `.github/workflows/ci.yml`. `ui/src/contracts/types.ts` and `contracts.test.ts` change only in PR-1. `ui/src/build-output.test.ts` changes in PR-2 and PR-3. `contracts/OWNERS.md` changes in PR-1 (rows) and PR-3 (flips, last commit).

## PR-1: backend and contracts (one window)
- [x] T1 work-ledger: `store/attempts.py`, shared `feed_coverage` and `staleness_cut`, parity test (FP04-WL-1 to FP04-WL-6)
- [x] T2 crew-integration: `attempt-item.v1`, `attempts.v1`, `roster-item.v1.workers.unknown`, cases, route, `attempts_view.py`, producer test (FP04-CI-1 to FP04-CI-4)
- [x] T3 crew-integration: UI types and `contracts.test.ts` rows (FP04-CI-5)
- [x] T4 delivery: `spec/ids.md` rows, this folder, producer meta-test count, OWNERS DRAFT rows (FP04-DEL-1, FP04-DEL-2, FP04-DEL-3, FP04-DEL-5)
- [x] T5 crew-integration and work-ledger: real-source backend test over `tests/recorded/crew-0.12.2/` (FP04-REQ-16)

## PR-2: UI foundation (one window)
- [ ] T6 host seam, fixtures SDK scenarios, `?inline` CSS and its rooted-selector test, mount swap, `StubShell` removal (FP04-CI-5, FP04-CI-6, FP04-REQ-12)
- [ ] T7 observatory data layer, roster list, Watched and search, legend, banners, initials (FP04-REQ-1, FP04-REQ-2, FP04-REQ-7, FP04-REQ-8, FP04-REQ-10, FP04-REQ-11)
- [ ] T8 delivery guard: bundle budget (FP04-DEL-4)

## PR-3: UI detail and finish (same UI window)
- [ ] T9 `BotDetail`, `AttemptsList`, `ActivityPanel`, `SourcePanel`, chips, keyboard completion (FP04-REQ-3 to FP04-REQ-6, FP04-REQ-9)
- [ ] T10 Playwright scenario suite and CSS leak check (FP04-REQ-16)
- [ ] T11 delivery: re-measure the bundle budget (FP04-DEL-4)
- [ ] T12 delivery: provenance section, doc upkeep (FP04-DEL-6, FP04-DEL-7)
- [ ] T13 delivery: FROZEN flips, last commit (FP04-REQ-15, FP04-DEL-5)

## Owner step
- [ ] OA-2 (optional): live check on the installed app, run by Eric or the Master Session (FP04-REQ-16)
