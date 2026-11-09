# Spec index

The spec source for `burlabs/specter-arena` (see `docs/development/adapters.md`, `docs.specSource`).

## State

Greenfield. As of FP-00 there is no application code graph to index: the repository holds tooling, checks, CI, and docs, followed by a backend liveness probe and a UI stub. FP-01 adds the first feature spec. Beyond it, read the docs and code directly.

## Components

Work is owned by five logical components. Details are in `docs/architecture/component-index.md`.

| Component | First feature session with real code |
|---|---|
| delivery | FP-00 |
| crew-integration | FP-00 (stub), FP-01 (live install probe) |
| work-ledger | later |
| specter-identity | later |
| experience | later |

## Feature specs

| Feature | Folder | Status |
|---|---|---|
| FP-01 Installed Crew shell and bot telemetry capability proof | `.kiro/specs/fp-01-crew-integration-probe/` | In progress; capability matrix and host facts in `docs/compatibility/` |

Feature sessions add folders under `.kiro/specs/` and link them here.
