# Spec index

The spec source for `burlabs/specter-arena` (see `docs/development/adapters.md`, `docs.specSource`).

## State

Greenfield. There is no application code graph to index: the repository holds tooling, checks, CI, docs, a backend with the collector, store and roster routes, a UI with the bot roster view, and the FP-01 probe. FP-01 added the first feature spec and closed on 2026-11-13; FP-02+03 added the second; FP-04 added the third; FP-06+07 added the fourth; FP-08+09 added the fifth; FP-10+11 added the sixth. FP-16 to FP-21 followed (see the table). Beyond them, read the docs and code directly. Spec-id prefixes are reserved in `spec/ids.md`.

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
| FP-06+07 Summoning, persistent Specters, and safe visuals | `.kiro/specs/fp-06-07-summoning-visuals/` | Complete: PR-A shell, contracts and store; PR-B generation and assets; PR-C UI; live generation owner step OA-3 open; superseded by FP-16 (summoning removed, PA-2); history kept |
| FP-08+09 Work encounters, acceptance and the XP ledger | `.kiro/specs/fp-08-09-work-encounters-xp/` | Complete with PR-C: PR-A spec, contracts, store and policy (merged); PR-B service and routes (merged); PR-C UI (this PR); live check of Work and XP on the installed app is an owner step (OA-4), open |
| FP-10+11 Live arena and encounter inspector | `.kiro/specs/fp-10-11-live-arena/` | Complete: PR-A provenance, art and scene-asset contract; PR-B arena; PR-C inspector, handoffs and performance record (numbers in performance.md); FD-31 skipped; live check on the installed app is an owner step, open |
| FP-16 Fixed hero roster and Figma parity | `.kiro/specs/fp-16-heroes-parity/` | Complete: PR-A (#148) heroes, assignment, removal of summoning, narrowed grants, migration 0007 and contracts; PR-B (#149) sprites, thumbnails, structures and idle motion; PR-C (#150) remaining parity gaps, docs and the performance record; all merged (`5e1e1638`). Live check on the installed app is the owner sitting OA-5, open |
| FP-17 Specters collection | `.kiro/specs/fp-17-specters-collection/` | Complete: PR-A (#156) `heroes.v1` and `GET /api/heroes`; PR-B (#157) search, filter, sort and unassigned hero cards on the Specters tab; all merged. Not in RC-2. Owner re-check of the Specters tab at 1440 and 390 px (B14) is part of the RC-3 sitting |
| FP-18 Work and XP read correctness | `.kiro/specs/fp-18-work-xp-read-correctness/` | Complete: PR-A (#161) update-ordered work list read (`GET /api/work?view=list`), paged XP summaries (`GET /api/xp?view=paged`), migration 0008 and contracts; PR-B (#162) the arena and Work tab on the new reads, contracts FROZEN; all merged. Not in RC-2 |
| FP-19 Data lifecycle and collection control | `.kiro/specs/fp-19-data-lifecycle/` | Complete: PR-A (#166) migration 0009, retention, purge, export, startup sweep, upload cap and cleanup, `POST /api/collector`; PR-B (#167) Data tab, contracts `data-lifecycle` and `collector-control` FROZEN; all merged. Not in RC-2. Pause and resume on a live collector is checked in the RC-3 sitting |
| FP-20 Crew signal expansion | `docs/compatibility/crew-0.13.0.md` (no spec folder) | Complete: PR-A (#172) probe v3 and runbook; PR-B (#173) "Waiting on you" condition and "Context in use" reading, contracts `roster.v2` and `roster-item.v2` FROZEN, no new grant; PR-C (#174) UI; all merged. Built from a source reading of Crew 0.13.0, not a live probe (KL-21) |
| FP-21 Battle animations | `.kiro/specs/fp-21-battle-animations/` | Complete: PR-A (#178) exchanges, hero attack and cast, travelling strike, minion hit, paused plate; PR-B (#179) XP loading state, awaiting-approval marker, legend, e2e A-20 to A-24; all merged. UI bundle cap now 419,000 characters. Not live-checked (RC-3 sitting) |

Feature sessions add folders under `.kiro/specs/` and link them here.
