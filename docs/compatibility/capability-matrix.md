# Capability matrix

Host: Kiro Crew 0.12.0. Authoritative run: `20261111T230641Z-4f743d` (L3-v1b), captured 2026-11-11, after PR #34. Closed by Eric on 2026-11-12 under the A7 timebox; unanswered cells are UNTESTED with the reason. No other host version was probed.

Inaccessible information is marked inaccessible, not guessed. A completed model turn is not accepted work.

ALLOWED requires APP-TOKEN evidence in every scope. DENIED and UNSUPPORTED require an existing evidence file. UNTESTED cells carry a reason.

Evidence for 16 cells is `evidence/L3-v1b/export.json` (the sanitised diagnostic export of run `20261111T230641Z-4f743d`); the cell id after `#` names the entry. `user-slots-no-grant-denied` rests on `evidence/L3-v0/run-log.md` (phase v0, no export saved). Screenshots were reported to the coordinator as pasted images or text in chat and are not committed as files.

| Id | State | Credential | Scope | Evidence |
|---|---|---|---|---|
| `app-owned-grant-staging` | UNTESTED | none | app-owned | none |
| `app-owned-slots-visible` | UNTESTED | none | app-owned | none |
| `app-owned-token-exchange` | ALLOWED | APP-TOKEN | app-owned | evidence/L3-v1b/export.json#app-owned-token-exchange |
| `app-owned-token-lifetime` | UNTESTED | none | app-owned | none |
| `app-owned-unsigned-direct-rejected` | DENIED | APP-TOKEN | app-owned | evidence/L3-v1b/export.json#app-owned-unsigned-direct-rejected |
| `app-owned-ws-token-transport` | ALLOWED | APP-TOKEN | app-owned | evidence/L3-v1b/export.json#app-owned-ws-token-transport |
| `bot-activity-read` | DENIED | APP-TOKEN | bot | evidence/L3-v1b/export.json#bot-activity-read |
| `bot-attribution-survives-restart` | UNTESTED | none | bot | none |
| `bot-dashboard-member-record` | UNTESTED | none | bot | none |
| `bot-dashboard-record-ungranted` | UNTESTED | none | bot | none |
| `bot-dashboard-webview-hook` | UNTESTED | none | bot | none |
| `bot-delete-behaviour` | UNTESTED | none | bot | none |
| `bot-fresh-start` | UNTESTED | none | bot | none |
| `bot-goals-read` | DENIED | APP-TOKEN | bot | evidence/L3-v1b/export.json#bot-goals-read |
| `bot-id-observable` | ALLOWED | APP-TOKEN | bot | evidence/L3-v1b/export.json#bot-id-observable |
| `bot-id-stable-across-rename` | UNTESTED | none | bot | none |
| `bot-key-results-read` | DENIED | APP-TOKEN | bot | evidence/L3-v1b/export.json#bot-key-results-read |
| `bot-ledger-read` | DENIED | APP-TOKEN | bot | evidence/L3-v1b/export.json#bot-ledger-read |
| `bot-list-members-denied` | DENIED | APP-TOKEN | bot | evidence/L3-v1b/export.json#bot-list-members-denied |
| `bot-list-via-agents` | ALLOWED | APP-TOKEN | bot | evidence/L3-v1b/export.json#bot-list-via-agents |
| `bot-name-avatar` | ALLOWED | APP-TOKEN | bot | evidence/L3-v1b/export.json#bot-name-avatar |
| `bot-notes-memory-private` | DENIED | APP-TOKEN | bot | evidence/L3-v1b/export.json#bot-notes-memory-private |
| `bot-own-session-attribution` | ALLOWED | APP-TOKEN | bot | evidence/L3-v1b/export.json#bot-own-session-attribution |
| `bot-per-bot-opt-in` | UNTESTED | none | bot | none |
| `bot-reimport-kirobot` | UNTESTED | none | bot | none |
| `bot-scheduled-turn-origin` | UNTESTED | none | bot | none |
| `bot-worker-session-attribution` | UNTESTED | none | bot | none |
| `closed-tab-collection` | UNTESTED | none | app-owned | none |
| `external-cli-slot-appears` | UNTESTED | none | external-cli | none |
| `gateway-restart-reconnect` | UNTESTED | none | app-owned | none |
| `other-app-api-denied` | DENIED | APP-TOKEN | other-app | evidence/L3-v1b/export.json#other-app-api-denied |
| `other-app-proxy-denied` | UNTESTED | none | other-app | none |
| `other-app-slots-absent` | UNTESTED | none | other-app | none |
| `reconnect-cursor-history` | UNTESTED | none | app-owned | none |
| `reconnect-snapshot` | UNTESTED | none | app-owned | none |
| `user-chat-slot-history` | UNTESTED | none | user-owned | none |
| `user-chat-slots-api` | DENIED | APP-TOKEN | user-owned | evidence/L3-v1b/export.json#user-chat-slots-api |
| `user-outcome-evidence` | UNTESTED | none | user-owned | none |
| `user-signal-approval` | UNTESTED | none | user-owned | none |
| `user-signal-progress` | UNTESTED | none | user-owned | none |
| `user-signal-start` | UNTESTED | none | user-owned | none |
| `user-signal-terminal` | UNTESTED | none | user-owned | none |
| `user-signal-tool-error` | UNTESTED | none | user-owned | none |
| `user-slots-no-grant-denied` | DENIED | APP-TOKEN | user-owned | evidence/L3-v0/run-log.md |
| `user-slots-visible` | ALLOWED | APP-TOKEN | user-owned | evidence/L3-v1b/export.json#user-slots-visible |
| `user-source-links` | UNTESTED | none | user-owned | none |

## Counts

- ALLOWED: 7
- DENIED: 10
- UNSUPPORTED: 0
- UNTESTED: 29

## Notes per cell

| Id | Note |
|---|---|
| `app-owned-grant-staging` | Phase v2 (staged-approval check) was never run. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `app-owned-slots-visible` | Needs the no-grant phase v0 to conclude it; the L3-v0 run did not. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `app-owned-token-exchange` | token received (258 characters, value not recorded) (export.json run 20261111T230641Z-4f743d) |
| `app-owned-token-lifetime` | No long-lived WS observed across a token expiry. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `app-owned-unsigned-direct-rejected` | GET /api/ping (unsigned, backend loopback) answered 401; object with fields error; error="unauthorized" (export.json run 20261111T230641Z-4f743d) |
| `app-owned-ws-token-transport` | feed opened with token via query; 16 frames (export.json run 20261111T230641Z-4f743d) |
| `bot-activity-read` | GET /api/members/specter-probe-bot/activity answered 403; object with fields code, error; code="forbidden"; error="app token not permitted for this endpoint" (export.json run 20261111T230641Z-4f743d) |
| `bot-attribution-survives-restart` | Needs a gateway restart, which needs Eric's go-ahead at run time (FD-21); not run. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-dashboard-member-record` | The one attempt (L3-v1b) was not decisive: POST /api/member-records/<bot> answered 400 code="bad_record_type" (the record type did not meet the host's name rules), a probe request defect, not a host answer. Not retried. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-dashboard-record-ungranted` | The refusal is probed in phase v0, and the L3-v0 run did not conclude it. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-dashboard-webview-hook` | Not probed by design (FD-6): the Webview drawer hook is out of scope for FP-01. |
| `bot-delete-behaviour` | Probe bot was not deleted during the run. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-fresh-start` | Not run. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-goals-read` | GET /api/members/specter-probe-bot/goals answered 403; object with fields code, error; code="forbidden"; error="app token not permitted for this endpoint" (export.json run 20261111T230641Z-4f743d) |
| `bot-id-observable` | DM slot key member-specter-probe-bot present (export.json run 20261111T230641Z-4f743d) |
| `bot-id-stable-across-rename` | Probe bot was not renamed during the run. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-key-results-read` | GET /api/members/specter-probe-bot/goals/key-results answered 403; object with fields code, error; code="forbidden"; error="app token not permitted for this endpoint" (export.json run 20261111T230641Z-4f743d) |
| `bot-ledger-read` | GET /api/members/specter-probe-bot/projections answered 403; object with fields code, error; code="forbidden"; error="app token not permitted for this endpoint" (export.json run 20261111T230641Z-4f743d) |
| `bot-list-members-denied` | GET /api/members answered 403; object with fields code, error; code="forbidden"; error="app token not permitted for this endpoint" (export.json run 20261111T230641Z-4f743d) |
| `bot-list-via-agents` | /api/agents answered 200; probe bot row fields avatar, description, display_name, kiro_agent, memory_store, model, name, owns_mate_file, reasoning_effort, scope, session_color, source, triggers, workspace (export.json run 20261111T230641Z-4f743d) |
| `bot-name-avatar` | probe bot row has name-like and avatar-like fields: avatar, description, display_name, kiro_agent, memory_store, model, name, owns_mate_file, reasoning_effort, scope, session_color, source, triggers, workspace (export.json run 20261111T230641Z-4f743d) |
| `bot-notes-memory-private` | GET /api/members/specter-probe-bot/notes answered 403; object with fields code, error; code="forbidden"; error="app token not permitted for this endpoint" (export.json run 20261111T230641Z-4f743d) |
| `bot-own-session-attribution` | DM slot carries key and agent fields (export.json run 20261111T230641Z-4f743d) |
| `bot-per-bot-opt-in` | Not probed. Source reading expects UNSUPPORTED, but no evidence file backs that, so the cell stays UNTESTED. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-reimport-kirobot` | Not run. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-scheduled-turn-origin` | No scheduled bot turn was triggered. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-worker-session-attribution` | No worker slot row was observed, and it is unknown whether the probe bot dispatched a worker. The targeted rerun with explicit delegation (L3-v1c) was skipped. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `closed-tab-collection` | Not run. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `external-cli-slot-appears` | No external CLI session was started and no slot key was supplied. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `gateway-restart-reconnect` | Needs a gateway restart, which needs Eric's go-ahead at run time (FD-21); not run. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `other-app-api-denied` | GET /api/config answered 403; object with fields code, error; code="forbidden"; error="app token not permitted for this endpoint" (export.json run 20261111T230641Z-4f743d) |
| `other-app-proxy-denied` | The one attempt (L3-v1b) was not decisive: GET /apps/specter-other/api/ping answered 403 with a body that was not valid JSON. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `other-app-slots-absent` | No second app was installed to compare slots. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `reconnect-cursor-history` | Not run. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `reconnect-snapshot` | Not run. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `user-chat-slot-history` | No worker slot was observed, so there was no history to fetch. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `user-chat-slots-api` | GET /api/chat/slots answered 403; object with fields code, error; code="forbidden"; error="Forbidden" (export.json run 20261111T230641Z-4f743d) |
| `user-outcome-evidence` | No terminal signal in the capture window. The bot DM row produced only "removed" signals (4 in L3-v1b); the cause is open. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `user-signal-approval` | Signal not observed in the capture window (L3-v1b); no approval was requested of the probe bot. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `user-signal-progress` | Signal not observed in the capture window (L3-v1b). The bot DM row produced only "removed" signals; the cause is open. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `user-signal-start` | Signal not observed in the capture window (L3-v1b). The bot DM row produced only "removed" signals; the cause is open. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `user-signal-terminal` | Signal not observed in the capture window (L3-v1b). The bot DM row produced only "removed" signals; the cause is open. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `user-signal-tool-error` | No tool error was provoked. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `user-slots-no-grant-denied` | Phase v0 (no slots:user grant): evidence/SUMMARY.md records 0 user-origin rows delivered. The cited L3-v0 run log is the diagnostic-page summary Eric pasted; the raw export was not saved and the time of day is not recorded. |
| `user-slots-visible` | snapshots held up to 34 rows (export.json run 20261111T230641Z-4f743d) |
| `user-source-links` | No probe slot carried source_links in the capture (L3-v1b). A7 two-day timebox reached; Eric closed the run on 2026-11-12. |

## Open questions that bear on issue #21

- The bot DM row was reported `removed` four times in L3-v1b with no start, progress, terminal or approval signal. Full-list frames to app sockets match the probe parser, so the row was genuinely absent from some filtered frames. Root cause open.
- Whether the probe bot dispatched a worker is unknown, so worker attribution is unobserved.
- `GET /api/chat/slots` answers 403 with code "forbidden" and error "Forbidden" even with an approved grant, which differs from the scope refusal ("app token not permitted for this endpoint"). A handler or another layer refuses app tokens there.
