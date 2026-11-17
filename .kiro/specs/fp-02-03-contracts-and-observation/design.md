# FP-02+03 design

Status: Pass 1 complete; Pass 2 planned. The three seed wire schemas are `FROZEN`; the five Pass 2 schemas are `DRAFT` in `contracts/OWNERS.md` until their first consumer merges.

## Shape of the work

| Component | Pass 1 |
|---|---|
| crew-integration | Slice 1 probe (APP-TOKEN scenarios), store wiring in `backend/app.py`, `GET /api/ready` |
| work-ledger | `backend/specter_arena/store/` (SQLite, migrations, backup/restore, paging primitives) |
| delivery | Spec folder and ids, validators for the new evidence shapes, `contracts/` tooling and CI step |

specter-identity and experience are not impacted in Pass 1. FP-05 owns the Specter profile envelope; this session reserves only a bot-binding reference.

## Contract tooling (delivery)

- Source of truth: JSON Schema (draft-07) files in `contracts/schemas/`. Validators are dev dependencies (Ajv for TypeScript, `fastjsonschema` for Python); `requirements.txt` and `ui/dist/index.mjs` do not change. See `contracts/VERSIONING.md` and `contracts/OWNERS.md`.
- One set of cases (`contracts/cases/`) is read by `ui/src/contracts/contracts.test.ts` and `backend/tests/test_contracts.py`. `npm run check:schema` (slice D-3) checks the schema rules, the cases layout, the owner table, the FP-02-AC06 denylist, and the spec-id registry.
- FP-05 plugs in by adding a schema file, its cases, and an `OWNERS.md` row, and by `$ref`-ing the bot-binding id as a property value.

## Host versions

The matrix and recorded captures name the Crew version they were observed on. FP-01 evidence stays at 0.12.0; slice 1 evidence is 0.12.2. See `docs/compatibility/` and `scripts/check-matrix.mjs`.

## Known limit

`docs/compatibility/monitoring-scope.md` status is enforced only for its format. Nothing mechanical ties FP-03 code to an APPROVED status; the block is a planning and review rule.

## Pass 2 carry-forward: load-test bounds for FP-03-AC06

These bounds were approved in Pass 2 at the starting values below (G2-1..G2-28 in the planning record) and are implemented in the collector (`backend/specter_arena/collector/vocabulary.py`) and exercised by the load and limits tests (`backend/tests/test_collector_load.py`, `test_collector_limits.py`).

1. **Bounded queue with an explicit overflow policy.** One bounded queue between the WebSocket reader and the writer; `maxsize` is configurable (starting value 1,000 frames; element type: filtered event items; the row-state lane is latest-wins per binding and never queues raw frames). The chosen policy is drop-oldest on the event lane with one `overflow` coverage gap per flush (G2-10). The policy writes a coverage-gap record with the dropped count and the source-time and receive-time range, and must set coverage for that interval to gap or unknown, never full.
2. **Accounting invariant.** For any run, received equals ignored plus coalesced plus persisted plus deduplicated plus quarantined plus rejected plus dropped-with-gap-record. `ignored` is a closed list of known high-volume frame types (`IGNORED_TYPES`) that must be a subset of `docs/compatibility/event-vocabulary.json` plus the type names in `backend/tests/fixtures/collector/frame-types-0.12.2.json`; an unknown type is quarantined, never ignored. `coalesced` counts `slots` snapshots superseded by a later one. A test with a deliberately slow writer asserts the equality and asserts that any drop implies coverage other than full.
3. **Burst test.** Inject N frames (starting value 10,000 filtered items in under 5 seconds of fake time) against a writer slower than the producer (starting value 50 ms per batch). Assert queue length never exceeds `maxsize`, memory growth stays within a stated budget (starting value 50 MB peak delta under `tracemalloc`), and no unbounded task or thread growth.
4. **Frame size cap.** A maximum size per frame before persistence (starting value 64 KiB, measured on the raw bot row or event frame before the allow-list reduces it). An oversize frame is quarantined with a redacted summary (length and hash) and counted, never truncated into a valid row.
5. **Duplicate storm.** The same source-id frame 1,000 times yields one stored row. Two equal-looking frames with different source ids yield two rows; deduplication never rests on body text alone.
6. **Reconnect loop.** 100 simulated disconnects on a fake clock. Backoff grows to a cap (starting value 30 s) with jitter, never loops tight (the minimum sleep is at least the first backoff step), and every reconnect records an overlap or gap record.
7. **Authentication and permission failure.** A 403 triggers at most one fresh token exchange with the same app secret. A 403 after that, an exchange failure, or a WebSocket close 1008 stops collection with coverage reason `auth-stopped` or `app-disabled`. A test double fails if a second credential source is read or a second exchange is attempted, in the style of `backend/tests/test_no_privileged_fallback.py`.
8. **Diagnostics redaction.** Diagnostics for dropped or quarantined frames hold only type, size, hash, counts, and time ranges. A test searches the output for seeded secrets and prompt text.
9. **Store throughput is not the bottleneck on a development Mac.** About 700k rows per second batched and about 99k single-row transactions per second with WAL were measured on Python 3.15.2 (not the pinned 3.12). The re-measure on 3.12 is deferred (D-P8). Bounds are set by queue policy and memory; the writer batches (starting value at most 100 rows per transaction).
10. **Determinism and cost.** Fake clock and an in-process fake source only; each load test finishes in a few seconds in the existing `test` job; no real Crew. A 30-minute soak with the probe bot is an owner step, not CI.

Slice 1 supplied the inputs: per scenario, frame counts and byte sizes by event type (p50, p95, max) and burst lengths, counts only.
