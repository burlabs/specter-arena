# Spec index

The spec source for `burlabs/specter-arena` (see `docs/development/adapters.md`, `docs.specSource`).

## State

Greenfield. There is no application code graph to index: the repository holds tooling, checks, CI, docs, a backend with the collector, store and roster routes, a UI with the bot roster view, and the FP-01 probe. FP-01 added the first feature spec and closed on 2026-11-13; FP-02+03 added the second; FP-04 added the third; FP-06+07 added the fourth; FP-08+09 added the fifth; FP-10+11 adds the sixth. Beyond them, read the docs and code directly. Spec-id prefixes are reserved in `spec/ids.md`.

## Components

Work is owned by five logical components. Details are in `docs/architecture/component-index.md`.

| Component | First feature session with real code |
|---|---|
| delivery | FP-00 |
| crew-integration | FP-00 (stub), FP-01 (live install probe), FP-02+03 (slice 1 probe, store wiring) |
| work-ledger | FP-02+03 (store); FP-08+09 (work items, XP ledger) |
| specter-identity | FP-06+07 |
| experience | FP-04 |

## Feature specs

| Feature | Folder | Status |
|---|---|---|
| FP-01 Installed Crew shell and bot telemetry capability proof | `.kiro/specs/fp-01-crew-integration-probe/` | Complete (closed 2026-11-13); capability matrix and host facts in `docs/compatibility/` |
| FP-02+03 Domain contracts, durable state, and continuous observation | `.kiro/specs/fp-02-03-contracts-and-observation/` | Complete: Pass 1 (#38-#50 closed) and Pass 2 (bot binding, observation, coverage, collector, roster read route); acceptance sitting OA-1 passed 2026-11-16 |
| FP-04 Bot roster and operational monitoring baseline | `.kiro/specs/fp-04-bot-roster/` | Complete when PR-3 merges: roster, attempts route, monitoring view; waiting and blocked deferred (FP4-D1) |
| FP-06+07 Summoning, persistent Specters, and safe visuals | `.kiro/specs/fp-06-07-summoning-visuals/` | Complete: PR-A shell, contracts and store; PR-B generation and assets; PR-C UI; live generation owner step OA-3 open |
| FP-08+09 Work encounters, acceptance and the XP ledger | `.kiro/specs/fp-08-09-work-encounters-xp/` | Complete with PR-C: PR-A spec, contracts, store and policy (merged); PR-B service and routes (merged); PR-C UI (this PR); live check of Work and XP on the installed app is an owner step (OA-4), open |
| FP-10+11 Live arena and encounter inspector | `.kiro/specs/fp-10-11-live-arena/` | Planned: PR-A provenance, art and scene-asset contract; PR-B arena; PR-C inspector, handoffs, performance record |

Feature sessions add folders under `.kiro/specs/` and link them here.
