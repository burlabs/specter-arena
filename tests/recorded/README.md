# Recorded captures

Real payloads observed from an installed Kiro Crew, one directory per host version: `crew-<version>/`. A directory needs `docs/compatibility/crew-<version>.md`, and every file in it must name the same version in `_meta.hostVersion`. `scripts/check-recorded.mjs` (run by `npm run probe:check`) enforces both. The sanitised value grammar and the row rules are in `crew-0.12.0/README.md`.

## Event-frame captures

A file with `"_meta": { "capture": "event-frames", ... }` holds one row per WebSocket frame instead of one row per entity:

- Every row has `frameSeq`, a non-negative integer unique within the file. It replaces `id`, `key` and `attemptId` as the identity, because a frame stream repeats those on purpose.
- Every row has `receivedAtMs`, the receive time as an integer count of epoch milliseconds. An ISO timestamp string would fail the sanitised grammar in a non-probe row; `_meta.capturedAt` may stay ISO because `_meta` is not grammar-checked.
- Every row has a top-level `eventType` that appears in `docs/compatibility/event-vocabulary.json`. It is the only string a non-probe row may carry outside the sanitised grammar. A nested `eventType` is still held to the grammar.
- Everything else follows the existing rules: `rowKind`, the grammar for non-probe rows, the credential check for probe rows, and no `outcomeEvidence` that says accepted.

`docs/compatibility/event-vocabulary.json` (`{"version": 1, "eventTypes": [...]}`) is the controlled vocabulary. The crew-integration component owns its content and extends it in the same PR that starts recording a new frame type; delivery owns the validator. Until that file exists no event-frame capture can pass.

Release code never reads this tree, and never reads `contracts/cases` either (`scripts/check-recorded.mjs`).
