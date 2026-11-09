# Monitoring scope (FP-01-AC05)

Status: NOT APPROVED

FP-03 monitoring work is blocked until the status line above reads `Status: APPROVED` with an `Approved by:` line and an `Approved on:` line below it. `node scripts/check-matrix.mjs` enforces the format.

Approved by:
Approved on:

## Inputs

- `docs/compatibility/capability-matrix.md` and `capability-matrix.json`: what the app may read, per scope, with the credential that proved it.
- `docs/compatibility/host-facts.json` and `crew-0.12.0.md`: how the host behaves (not permissions).
- `docs/compatibility/evidence/<runId>/`: the run evidence the cells cite.

Both stay all-UNTESTED until the live probe run (`docs/ops/crew-probe-runbook.md`).

## Decision to make with Eric after the live run

1. Monitoring scope and collection mechanism. The options, to be judged against the matrix:
   - native visibility as is (the user-slots path);
   - a narrower, newly authored, authorized observer or bridge;
   - a bounded app-owned mode.
2. PA1-D2: plain chats and agents that have no bot.
3. PA1-D5: showing the arena on a bot's dashboard. Cite the member-record cells; the Webview drawer hook is not probed (FD-6).

Each decision cites the matrix cell ids and host fact ids it rests on. If the approved scope cannot support a real demo, monitoring implementation stays blocked pending a real scope decision.

## Decisions

None recorded.
