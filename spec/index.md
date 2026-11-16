# Spec index

The spec source for `burlabs/specter-arena` (see `docs/development/adapters.md`, `docs.specSource`).

## State

Greenfield. There is no application code graph to index: the repository holds tooling, checks, CI, docs, a backend liveness probe, a UI stub, and the FP-01 probe. FP-01 added the first feature spec and closed on 2026-11-13; FP-02+03 adds the second. Beyond them, read the docs and code directly. Spec-id prefixes are reserved in `spec/ids.md`.

## Components

Work is owned by five logical components. Details are in `docs/architecture/component-index.md`.

| Component | First feature session with real code |
|---|---|
| delivery | FP-00 |
| crew-integration | FP-00 (stub), FP-01 (live install probe), FP-02+03 (slice 1 probe, store wiring) |
| work-ledger | FP-02+03 (store) |
| specter-identity | later |
| experience | later |

## Feature specs

| Feature | Folder | Status |
|---|---|---|
| FP-01 Installed Crew shell and bot telemetry capability proof | `.kiro/specs/fp-01-crew-integration-probe/` | Complete (closed 2026-11-13); capability matrix and host facts in `docs/compatibility/` |
| FP-02+03 Domain contracts, durable state, and continuous observation | `.kiro/specs/fp-02-03-contracts-and-observation/` | Pass 1 complete (#38-#50 closed); Pass 2 (bot binding, observation, coverage, collector, roster read route) planned 2026-11-16, implementation in progress |

Feature sessions add folders under `.kiro/specs/` and link them here.
