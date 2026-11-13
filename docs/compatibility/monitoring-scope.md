# Monitoring scope (FP-01-AC05)

Status: APPROVED

Approved by: Eric
Approved on: 2026-11-13

FP-03 monitoring work was blocked until the status line above read `Status: APPROVED` with an `Approved by:` line and an `Approved on:` line. `node scripts/check-matrix.mjs` enforces the format. FP-03 is unblocked within the scope below only; anything outside it needs a new scope decision.

## Inputs

- `docs/compatibility/capability-matrix.md` and `capability-matrix.json`: what the app may read, per scope, with the credential that proved it.
- `docs/compatibility/host-facts.json` and `crew-0.12.0.md`: how the host behaves (not permissions).
- `docs/compatibility/evidence/<runId>/`: the run evidence the cells cite.

The live probe run is closed (A7 timebox, 2026-11-12). The matrix records 7 ALLOWED, 10 DENIED and 29 UNTESTED cells. Every id below is a cell id in `capability-matrix.json`. This decision rests on those cells and cites no other evidence.

## Decisions

### 1. AC05 monitoring scope: native, bot-level (FD-28)

The app monitors through the host's native paths only: the `slots:user` feed and `GET /api/agents`. It adds no authorized observer, bridge or app-owned mode.

Product scope, narrowed by Eric on 2026-11-13, is three things per bot: the bot's name, the tokens the bot used, and the tasks or spawned work it has done.

Proven (ALLOWED, `APP-TOKEN` evidence):

- `bot-id-observable`: the bot's own thread appears in `slots:user` rows under a key of the form `member-<slug>`, which identifies the bot. Stability across a rename is not proven (`bot-id-stable-across-rename` is UNTESTED).
- `bot-own-session-attribution`: that thread's row carries the key and an `agent` field, so the thread is attributable to the bot.
- `bot-list-via-agents`: `GET /api/agents` returns the bot's row.
- `bot-name-avatar`: that row carries `name`, `display_name` and `avatar`, which covers the bot-name part of the scope.
- `user-slots-visible`: user-origin slot rows are delivered once `slots:user` is granted.
- `app-owned-token-exchange` and `app-owned-ws-token-transport`: the app can exchange its own token and read the WebSocket feed with the token in the query string.

Closed (DENIED). The app cannot use these paths and the design must not depend on them:

- `bot-list-members-denied`: `/api/members` is refused to app tokens.
- `bot-activity-read`, `bot-goals-read`, `bot-key-results-read`, `bot-ledger-read`, `bot-notes-memory-private`: bot activity, goals, key results, ledger projections and notes are refused to app tokens.
- `user-chat-slots-api`: `GET /api/chat/slots` answers `Forbidden` even with an approved grant. The slots feed is the only supported source of session rows.
- `user-slots-no-grant-denied`: without the `slots:user` grant no user-origin rows arrive.

Not proven (UNTESTED). Nothing in the product may rely on these until a probe settles them:

- `bot-worker-session-attribution`: no worker row was seen, and whether the probe bot ever dispatched a worker is unknown.
- `user-signal-start`, `user-signal-progress`, `user-signal-terminal`, `user-signal-approval`, `user-signal-tool-error`: no lifecycle signal was observed. The bot thread produced only `removed` signals.
- `user-outcome-evidence`, `user-source-links`, `user-chat-slot-history`: not probed.

Token usage is unproven and likely unavailable to apps. No matrix cell covers a per-bot token path. The design findings behind this (FD-28) are that `/api/usage/turns` returns only rows stamped with the calling app, and `/api/usage/series` refuses app callers. Token data is therefore an operational stat only, shown if and only if a supported path is proven (see decision 2).

Required first step for FP-03: open with a focused probe before building on worker, spawn or token data. The probe must:

1. Add the `subagent:user` event declaration. Subagent events default to the app's own slots unless it is declared, and the FP-01 overlay never declared it, so spawned work was never in view.
2. Try `/api/sessions/usage` and `/api/usage` with an app token. App access to both is unread.
3. Record each result as a new matrix cell or an update to `bot-worker-session-attribution`, with `APP-TOKEN` evidence.

If the probe shows a path is closed, that part of the scope is dropped and the product shows only what is proven. It does not fall back to an unapproved mechanism.

Caveat, acknowledged by Eric: the `slots:user` grant exposes every chat of the user, not only bot threads (`user-slots-visible`). Decision 3 limits what the app keeps.

### 2. XP basis (FD-29)

XP stays tied to attributable accepted outcomes (product invariant 3, unchanged). Tokens are never XP. If a supported app path to token usage is ever proven, tokens may appear only as an operational stat.

### 3. Unbound sessions (PA1-D2, FD-30)

Bots only. The app keeps a bot's own thread (key `member-<slug>`, optionally with a `.memory-` suffix; see `bot-id-observable`) and sessions whose `created_by` chain reaches one. Every other session received through `slots:user` is dropped at collection time and is never stored or shown. Plain chats and agents with no bot are out of scope.

### 4. Arena on a bot dashboard (PA1-D5, FD-31)

The arena UI lives at `/apps/specter-arena`. The app may also write a small per-bot summary record (for example the Specter name and condition) with `POST /api/member-records/{slug}` for a bot dashboard page to bind. No app UI is embedded in bot dashboards: the host does not support it, and `bot-dashboard-webview-hook` is UNTESTED.

This is untested live. `bot-dashboard-member-record` is UNTESTED: the one attempt answered `400 bad_record_type`, a defect in the probe request, not a host answer. `bot-dashboard-record-ungranted` is UNTESTED, so the refusal without a grant is also unknown.

FP-10 owns the live probe of both the write and the ungranted refusal, and owns adding `/api/member-records/*` to the release manifest at that point. The manifest does not include it before then.

## Result

The approved scope is native, bot-level monitoring of bot name, tasks or spawned work, and (only if proven) tokens as an operational stat, restricted to bots. It supports a demo built on bot identity and name today (`bot-id-observable`, `bot-name-avatar`). Task and spawned-work display depends on the FP-03 opening probe above.

FP-03 monitoring implementation is UNBLOCKED within this scope only.
