# S1-v1: slice-1 grant run on Crew 0.12.2 (main 533a314)

Run `20261115T215658Z-8625d7`, exported 2026-11-15T22:12:26Z, window 900 s with a deliberate reconnect 5 s after the first start. Staged app `0.0.0-probe.4` under **Eric's broad owner grant** (api `/api/*`, every event declaration; see `crew-0.12.2.md`). Cells are APP-TOKEN. Frames seen: 2,436, with no rows dropped by the cap. `frames.jsonl` (4 MB) is kept outside the repo, like FP-01's.

Owner steps (OWNER-SESSION, Eric, reported in chat):
- Installed with `kirocrew app install .probe-app` and approved the new grants on the app's detail page.
- Saved the probe slug `specter-probe-bot` and clicked "Run probe steps".
- Sent prompts A, B and C in the bot's own DM. A and B completed, and Eric saw the worker for B. For C, the bot replied that `spawn_run` is not in its tool list and that a spawn from its session is refused, so nothing was started.
- D, E and F and the gateway restart were skipped (Eric shortened the sitting).

Decided here: `app-owned-token-exchange`, `app-owned-ws-token-transport`, `bot-id-observable`, `bot-list-via-agents`, `bot-name-avatar`, `bot-own-session-attribution`, `bot-token-usage-per-bot`, `bot-worker-session-attribution`, `reconnect-snapshot`, `sessions-usage-api-app-token`, `usage-api-app-token`, `user-outcome-evidence`, `user-signal-progress`, `user-signal-start`, `user-signal-terminal`, `user-slots-visible` (ALLOWED); `app-owned-unsigned-direct-rejected`, `bot-activity-read`, `bot-goals-read`, `bot-ledger-read`, `bot-list-members-denied` (DENIED). The excerpts are in `export.json` under `snapshot.cells`.

The code also marked `closed-tab-collection` ALLOWED from a 900 s gap with no page request. It is committed as UNTESTED, because the tab was not closed (F skipped) and that cell needs the owner to attest the closed interval.
