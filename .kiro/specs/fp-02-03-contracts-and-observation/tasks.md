# FP-02+03 tasks

Shared single-writer files (root `package.json` and lock, `.github/workflows/ci.yml`, `backend/uv.lock`, `requirements.txt`, `backend/pyproject.toml` dependencies) change in one open PR at a time. In Pass 1 only D-3 changes them. `backend/app.py` changes only in W-1b. `scripts/check-*.mjs` change in D-2, then D-3.

## Pass 1

- [x] D-1 delivery (#38): stale-doc fixes, this spec folder, `spec/ids.md` and `scripts/check-spec-ids.mjs`, `spec/index.md` row (no lock, no CI file)
- [x] D-2 delivery (#39, PR #51): matrix host-version policy and event-frame capture rules in `scripts/check-matrix.mjs` and `scripts/check-recorded.mjs`, with tests
- [x] C-1 crew-integration (#43 to #46; PRs #54, #56, #57, #59, and the sitting fix #60): slice 1 probe code, overlay, regenerated question list and matrix skeleton, runbook
- [x] W-1a work-ledger (#40 to #42; PRs #52, #53, #55): store package, migrations, backup and restore, isolation layers 1 and 2
- [x] W-1b crew-integration and work-ledger (#47, PR #62): store lifespan, signed `GET /api/ready`, `contractVersion` on signed errors, isolation layer 3
- [x] D-3 delivery (#48, PR #64): `contracts/` tooling, seed schemas and cases, Ajv and `fastjsonschema` dev dependencies, `npm run check:schema`, one `fixtures` job step
- [x] Follow-up (#49, PR #65): real `/api/ready` bodies and `Page.to_wire` validated against the contracts (after D-3)
- [x] C-3 crew-integration (#50, PR #61): slice 1 evidence on Crew 0.12.2. Neither S1 nor S2 fired; the `spawn_run` gap is Eric's accepted coverage limit (`docs/compatibility/crew-0.12.2.md`)

## Pass 2

Planned 2026-11-16 (parent #66). Slices in dependency order; each is one reviewable PR in its lane. Long chain: WL-5, CI-7c, WL-6, CI-8.

- [x] WL-4 work-ledger (#67, PR #81): store test baseline split, `0002_bot_binding`, store API types
- [x] DEL-7a delivery (#68, PR #83): contract tooling (future-major case rule, denylist parity), seed schemas `FROZEN`, `bot-binding.v1`, `quarantine-record.v1`
- [x] CI-7a crew-integration (#69, PRs #82, #86): collector vocabulary, accounting, lanes, identity and frame parser
- [x] DEL-7b delivery (#70, PR #85): `observation.v1`, `roster-item.v1`, `roster.v1`, UI roster types
- [x] CI-6 crew-integration (#71, PR #87): condition rules, roster view, wire readers
- [x] WL-5 work-ledger (#72, PR #84): `0003` observations and coverage, ingest, runs, coverage marks, pause flag
- [x] CI-7b crew-integration (#73, PR #88): gateway client, grant self-check, collector fakes, no-fallback guard
- [x] CI-7c crew-integration (#74, PR #91): collector supervisor, auth and stop, coverage marks, real-store contract test
- [x] WL-6 work-ledger (#75, PR #90): `0004` projection and attempt, fold, rebuild, roster read, bot-binding and quarantine-record wire entries
- [x] DEL-8 delivery (#76, PR #93): collector load and limits tests, fixtures, reader parity
- [x] CI-8 crew-integration (#77, PR #92): collector boot, lifespan wiring, roster route, release grants, monitoring scope
- [x] DEL-6 delivery (#78, PR #89): Pass 2 spec rows and doc upkeep
- [x] DEL-9 delivery (#79): producer meta-test and closeout (this change)
- [ ] OA-1 owner (#80): acceptance sitting for FP-03-AC01 and FP-03-AC05 with the collector merged

Deferred (D-P8): `spawn_run` attribution, approval frames, history reconstruction after a gap, the 30-minute soak and the Python 3.12 store re-measure.
