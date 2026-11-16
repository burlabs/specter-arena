# FP-02+03 tasks

Shared single-writer files (root `package.json` and lock, `.github/workflows/ci.yml`, `backend/uv.lock`, `requirements.txt`, `backend/pyproject.toml` dependencies) change in one open PR at a time. In Pass 1 only D-3 changes them. `backend/app.py` changes only in W-1b. `scripts/check-*.mjs` change in D-2, then D-3.

## Pass 1

- [x] D-1 delivery (#38): stale-doc fixes, this spec folder, `spec/ids.md` and `scripts/check-spec-ids.mjs`, `spec/index.md` row (no lock, no CI file)
- [x] D-2 delivery (#39, PR #51): matrix host-version policy and event-frame capture rules in `scripts/check-matrix.mjs` and `scripts/check-recorded.mjs`, with tests
- [x] C-1 crew-integration (#43 to #46; PRs #54, #56, #57, #59, and the sitting fix #60): slice 1 probe code, overlay, regenerated question list and matrix skeleton, runbook
- [x] W-1a work-ledger (#40 to #42; PRs #52, #53, #55): store package, migrations, backup and restore, isolation layers 1 and 2
- [x] W-1b crew-integration and work-ledger (#47, PR #62): store lifespan, signed `GET /api/ready`, `contractVersion` on signed errors, isolation layer 3
- [ ] D-3 delivery (#48): `contracts/` tooling, seed schemas and cases, Ajv and `fastjsonschema` dev dependencies, `npm run check:schema`, one `fixtures` job step
- [ ] Follow-up (#49): real `/api/ready` bodies and `Page.to_wire` validated against the contracts (after D-3)
- [x] C-3 crew-integration (#50, PR #61): slice 1 evidence on Crew 0.12.2. Neither S1 nor S2 fired; the `spawn_run` gap is Eric's accepted coverage limit (`docs/compatibility/crew-0.12.2.md`)

## Pass 2

Designed after C-3 merges and Eric has read the results (decision D-P2). Bot binding, observation envelope, Attempt, WorkItem, coverage and gap records, collector lifecycle, the ordering and history gate, and the load tests listed in `design.md`.
