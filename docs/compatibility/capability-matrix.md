# Capability matrix

Hosts: Kiro Crew 0.12.0 (FP-01) and 0.12.2 (FP-02+03 slice 1). A cell with `hostVersion` 0.12.2 was decided in slice 1; a cell without it is FP-01 evidence from 0.12.0 (authoritative FP-01 run `20261111T230641Z-4f743d`, L3-v1b, closed by Eric on 2026-11-12 under the A7 timebox). Slice 1 ran on 2026-11-15: phase v0 `20261115T205118Z-a923f2` (S1-v0, own api entry only) and the grant run `20261115T215658Z-8625d7` (S1-v1). **S1-v1 ran under Eric's broad owner grant (api `/api/*`, every event declaration), not the D-P1 set**, so an ALLOWED 0.12.2 cell shows what a fully granted app can reach, not what a D-P1 app can. Unanswered cells are UNTESTED with the reason. Details: `crew-0.12.2.md`.

Inaccessible information is marked inaccessible, not guessed. A completed model turn is not accepted work.

ALLOWED requires APP-TOKEN evidence in every scope. DENIED and UNSUPPORTED require an existing evidence file. UNTESTED cells carry a reason.

Evidence by run: 17 cells cite `evidence/S1-v1/export.json` and 8 cite `evidence/S1-v0/export.json` (Crew 0.12.2, slice 1; see the run logs in those folders). 1 cell still cites FP-01's `evidence/L3-v1b/export.json` (Crew 0.12.0). In each case the cell id after `#` names the entry. Screenshots were reported to the coordinator as pasted images or text in chat and are not committed as files.

| Id | State | Credential | Scope | Evidence |
|---|---|---|---|---|
| `app-owned-grant-staging` | UNTESTED | none | app-owned | none |
| `app-owned-slots-visible` | UNTESTED | none | app-owned | none |
| `app-owned-token-exchange` | ALLOWED | APP-TOKEN | app-owned | evidence/S1-v1/export.json#app-owned-token-exchange |
| `app-owned-token-lifetime` | UNTESTED | none | app-owned | none |
| `app-owned-unsigned-direct-rejected` | DENIED | APP-TOKEN | app-owned | evidence/S1-v1/export.json#app-owned-unsigned-direct-rejected |
| `app-owned-ws-token-transport` | ALLOWED | APP-TOKEN | app-owned | evidence/S1-v1/export.json#app-owned-ws-token-transport |
| `bot-activity-read` | DENIED | APP-TOKEN | bot | evidence/S1-v0/export.json#bot-activity-read |
| `bot-attribution-survives-restart` | UNTESTED | none | bot | none |
| `bot-dashboard-member-record` | UNTESTED | none | bot | none |
| `bot-dashboard-record-ungranted` | UNTESTED | none | bot | none |
| `bot-dashboard-webview-hook` | UNTESTED | none | bot | none |
| `bot-delete-behaviour` | UNTESTED | none | bot | none |
| `bot-fresh-start` | UNTESTED | none | bot | none |
| `bot-goals-read` | DENIED | APP-TOKEN | bot | evidence/S1-v0/export.json#bot-goals-read |
| `bot-id-observable` | ALLOWED | APP-TOKEN | bot | evidence/S1-v1/export.json#bot-id-observable |
| `bot-id-stable-across-rename` | UNTESTED | none | bot | none |
| `bot-key-results-read` | DENIED | APP-TOKEN | bot | evidence/S1-v0/export.json#bot-key-results-read |
| `bot-ledger-read` | DENIED | APP-TOKEN | bot | evidence/S1-v0/export.json#bot-ledger-read |
| `bot-list-members-denied` | DENIED | APP-TOKEN | bot | evidence/S1-v0/export.json#bot-list-members-denied |
| `bot-list-via-agents` | ALLOWED | APP-TOKEN | bot | evidence/S1-v1/export.json#bot-list-via-agents |
| `bot-name-avatar` | ALLOWED | APP-TOKEN | bot | evidence/S1-v1/export.json#bot-name-avatar |
| `bot-notes-memory-private` | DENIED | APP-TOKEN | bot | evidence/S1-v0/export.json#bot-notes-memory-private |
| `bot-own-session-attribution` | ALLOWED | APP-TOKEN | bot | evidence/S1-v1/export.json#bot-own-session-attribution |
| `bot-per-bot-opt-in` | UNTESTED | none | bot | none |
| `bot-reimport-kirobot` | UNTESTED | none | bot | none |
| `bot-scheduled-turn-origin` | UNTESTED | none | bot | none |
| `bot-token-context-usage` | UNTESTED | none | bot | none |
| `bot-token-usage-per-bot` | ALLOWED | APP-TOKEN | bot | evidence/S1-v1/export.json#bot-token-usage-per-bot |
| `bot-token-usage-turns-app-scoped` | UNTESTED | none | bot | none |
| `bot-worker-session-attribution` | ALLOWED | APP-TOKEN | bot | evidence/S1-v1/export.json#bot-worker-session-attribution |
| `bot-worker-session-attribution-subagent` | UNTESTED | none | bot | none |
| `closed-tab-collection` | UNTESTED | none | app-owned | none |
| `external-cli-slot-appears` | UNTESTED | none | external-cli | none |
| `gateway-restart-reconnect` | UNTESTED | none | app-owned | none |
| `other-app-api-denied` | DENIED | APP-TOKEN | other-app | evidence/S1-v0/export.json#other-app-api-denied |
| `other-app-proxy-denied` | UNTESTED | none | other-app | none |
| `other-app-slots-absent` | UNTESTED | none | other-app | none |
| `reconnect-cursor-history` | UNTESTED | none | app-owned | none |
| `reconnect-snapshot` | ALLOWED | APP-TOKEN | app-owned | evidence/S1-v1/export.json#reconnect-snapshot |
| `sessions-usage-api-app-token` | ALLOWED | APP-TOKEN | user-owned | evidence/S1-v1/export.json#sessions-usage-api-app-token |
| `subagent-events-visible` | UNTESTED | none | user-owned | none |
| `subagent-replay-after-reconnect` | UNTESTED | none | bot | none |
| `usage-api-app-token` | ALLOWED | APP-TOKEN | user-owned | evidence/S1-v1/export.json#usage-api-app-token |
| `user-chat-slot-history` | UNTESTED | none | user-owned | none |
| `user-chat-slots-api` | DENIED | APP-TOKEN | user-owned | evidence/L3-v1b/export.json#user-chat-slots-api |
| `user-outcome-evidence` | ALLOWED | APP-TOKEN | user-owned | evidence/S1-v1/export.json#user-outcome-evidence |
| `user-signal-approval` | UNTESTED | none | user-owned | none |
| `user-signal-approval-resolved` | UNTESTED | none | user-owned | none |
| `user-signal-blocked-distinct` | UNTESTED | none | user-owned | none |
| `user-signal-progress` | ALLOWED | APP-TOKEN | user-owned | evidence/S1-v1/export.json#user-signal-progress |
| `user-signal-start` | ALLOWED | APP-TOKEN | user-owned | evidence/S1-v1/export.json#user-signal-start |
| `user-signal-terminal` | ALLOWED | APP-TOKEN | user-owned | evidence/S1-v1/export.json#user-signal-terminal |
| `user-signal-tool-error` | UNTESTED | none | user-owned | none |
| `user-slots-no-grant-denied` | DENIED | APP-TOKEN | user-owned | evidence/S1-v0/export.json#user-slots-no-grant-denied |
| `user-slots-visible` | ALLOWED | APP-TOKEN | user-owned | evidence/S1-v1/export.json#user-slots-visible |
| `user-source-links` | UNTESTED | none | user-owned | none |

## Counts

- ALLOWED: 16
- DENIED: 10
- UNSUPPORTED: 0
- UNTESTED: 25

## Notes per cell

| Id | Note |
|---|---|
| `app-owned-grant-staging` | Phase v2 (staged-approval check) was never run. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `app-owned-slots-visible` | Needs the no-grant phase v0 to conclude it; the L3-v0 run did not. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `app-owned-token-exchange` | token received (258 characters, value not recorded) (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `app-owned-token-lifetime` | No long-lived WS observed across a token expiry. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `app-owned-unsigned-direct-rejected` | GET /api/ping (unsigned, backend loopback) answered 401; object with fields error; error="unauthorized" (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `app-owned-ws-token-transport` | feed opened with token via query; 2388 frames (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `bot-activity-read` | GET /api/members/specter-probe-bot/activity answered 403; object with fields code, error; code="forbidden"; error="app token not permitted for this endpoint" (export.json run 20261115T205118Z-a923f2; phase v0, own api entry only). Under the broad grant in S1-v1 the same route answered 404 not_found. |
| `bot-attribution-survives-restart` | Needs a gateway restart, which needs Eric's go-ahead at run time (FD-21); not run. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-dashboard-member-record` | The one attempt (L3-v1b) was not decisive: POST /api/member-records/<bot> answered 400 code="bad_record_type" (the record type did not meet the host's name rules), a probe request defect, not a host answer. Not retried. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-dashboard-record-ungranted` | The refusal is probed in phase v0, and the L3-v0 run did not conclude it. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-dashboard-webview-hook` | Not probed by design (FD-6): the Webview drawer hook is out of scope for FP-01. |
| `bot-delete-behaviour` | Probe bot was not deleted during the run. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-fresh-start` | Not run. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-goals-read` | GET /api/members/specter-probe-bot/goals answered 403; object with fields code, error; code="forbidden"; error="app token not permitted for this endpoint" (export.json run 20261115T205118Z-a923f2; phase v0, own api entry only). Under the broad grant in S1-v1 the same route answered 404 not_found. |
| `bot-id-observable` | probe bot slot present: DM slot key member-specter-probe-bot; a slot whose agent field is the probe slug (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `bot-id-stable-across-rename` | Not exercised: prompt E (rename) was skipped in the shortened slice-1 sitting; display_name did not change across the roster reads. Run S1-v1, 2026-11-15. |
| `bot-key-results-read` | GET /api/members/specter-probe-bot/goals/key-results answered 403; object with fields code, error; code="forbidden"; error="app token not permitted for this endpoint" (export.json run 20261115T205118Z-a923f2; phase v0, own api entry only) |
| `bot-ledger-read` | GET /api/members/specter-probe-bot/projections answered 403; object with fields code, error; code="forbidden"; error="app token not permitted for this endpoint" (export.json run 20261115T205118Z-a923f2; phase v0, own api entry only). Under the broad grant in S1-v1 the same route answered 404 not_found. |
| `bot-list-members-denied` | GET /api/members answered 403; object with fields code, error; code="forbidden"; error="app token not permitted for this endpoint" (export.json run 20261115T205118Z-a923f2; phase v0, own api entry only). Under the broad grant in S1-v1 the same route answered 404 not_found. |
| `bot-list-via-agents` | /api/agents answered 200; probe bot row fields avatar, description, display_name, kiro_agent, memory_store, model, name, owns_mate_file, reasoning_effort, scope, session_color, source, triggers, workspace (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `bot-name-avatar` | probe bot row has name-like and avatar-like fields: avatar, description, display_name, kiro_agent, memory_store, model, name, owns_mate_file, reasoning_effort, scope, session_color, source, triggers, workspace (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `bot-notes-memory-private` | GET /api/members/specter-probe-bot/notes answered 403; object with fields code, error; code="forbidden"; error="app token not permitted for this endpoint" (export.json run 20261115T205118Z-a923f2; phase v0, own api entry only) |
| `bot-own-session-attribution` | DM slot carries key and agent fields (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `bot-per-bot-opt-in` | Not probed. Source reading expects UNSUPPORTED, but no evidence file backs that, so the cell stays UNTESTED. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-reimport-kirobot` | Not run. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-scheduled-turn-origin` | No scheduled bot turn was triggered. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `bot-token-context-usage` | Not yet probed on Crew 0.13.0. FP-20 PR-A adds the probe step; the owner sitting decides it. |
| `bot-token-usage-per-bot` | /api/usage, /api/sessions/usage: per-slot or per-bot field names present (session); what the figures mean is not concluded here; capture so far: context_usage rows 0, subagent_done rows 0 (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `bot-token-usage-turns-app-scoped` | Not yet probed on Crew 0.13.0. FP-20 PR-A adds the probe step; the owner sitting decides it. |
| `bot-worker-session-attribution` | created_by chain reaches the probe bot; lineage_minted=True (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `bot-worker-session-attribution-subagent` | Not exercised: the probe bot has no spawn_run tool on Crew 0.12.2 and refused prompt C, so no subagent was started. Eric accepted this as a coverage limit on 2026-11-15. Run S1-v1. |
| `closed-tab-collection` | Not exercised: the arena tab was not closed in the slice-1 sitting (step F skipped). The capture saw a 900 s gap with no page request, but the cell needs the owner to attest the tab was closed. Run S1-v1, 2026-11-15. |
| `external-cli-slot-appears` | No external CLI session was started and no slot key was supplied. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `gateway-restart-reconnect` | Needs a gateway restart, which needs Eric's go-ahead at run time (FD-21); not run. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `other-app-api-denied` | GET /api/config answered 403; object with fields code, error; code="forbidden"; error="app token not permitted for this endpoint" (export.json run 20261115T205118Z-a923f2; phase v0, own api entry only) |
| `other-app-proxy-denied` | The one attempt (L3-v1b) was not decisive: GET /apps/specter-other/api/ping answered 403 with a body that was not valid JSON. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `other-app-slots-absent` | No second app was installed to compare slots. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `reconnect-cursor-history` | Not observed: no history frames arrived after the deliberate reconnect, and the code never writes DENIED for a quiet stream (run S1-v1 20261115T215658Z-8625d7; owner broad grant). |
| `reconnect-snapshot` | 1 reconnect(s); probe rows before 2, after 2, present in both 2; running state carried over for 2 of 2; replayed within 10 s: none (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `sessions-usage-api-app-token` | GET /api/sessions/usage answered 200; object with fields usage (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `subagent-events-visible` | Not exercised: no spawn_run subagent was started (the probe bot has no spawn_run tool); subagent:user and subagent:all were granted. Run S1-v1, 2026-11-15. |
| `subagent-replay-after-reconnect` | Not yet probed on Crew 0.13.0. FP-20 PR-A adds the probe step; the owner sitting decides it. |
| `usage-api-app-token` | GET /api/usage answered 200; object with fields billing, refreshing, sessions, username (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `user-chat-slot-history` | No worker slot was observed, so there was no history to fetch. A7 two-day timebox reached; Eric closed the run on 2026-11-12. |
| `user-chat-slots-api` | GET /api/chat/slots answered 403; object with fields code, error; code="forbidden"; error="Forbidden" (export.json run 20261111T230641Z-4f743d) |
| `user-outcome-evidence` | outcome text: I ran echo b, and it printed b with exit code 0. I called work_brief first. Then… (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `user-signal-approval` | Not exercised: prompt D (approval) was skipped in the shortened slice-1 sitting; question_card frames: 0. Run S1-v1, 2026-11-15. |
| `user-signal-approval-resolved` | Not yet probed on Crew 0.13.0. FP-20 PR-A adds the probe step; the owner sitting decides it. |
| `user-signal-blocked-distinct` | Not yet probed on Crew 0.13.0. FP-20 PR-A adds the probe step; the owner sitting decides it. |
| `user-signal-progress` | signal observed on a probe slot: context-usage, progress, tool-call, tool-result; last_activity_ts is JSON str (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `user-signal-start` | signal observed on a probe slot: chat-status, start (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `user-signal-terminal` | signal observed on a probe slot: chat-done, terminal; a turn boundary, not an outcome (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `user-signal-tool-error` | Not observed: no tool error was provoked, and the 5 tool_result frames on the probe slot carried no error field (run S1-v1 20261115T215658Z-8625d7; owner broad grant). |
| `user-slots-no-grant-denied` | first slots frame held 0 rows without a slots grant (export.json run 20261115T205118Z-a923f2; phase v0, own api entry only) |
| `user-slots-visible` | snapshots held up to 42 rows (export.json run 20261115T215658Z-8625d7; owner broad grant: api /api/*, every event declaration (not the D-P1 set)) |
| `user-source-links` | No probe slot carried source_links in the capture (L3-v1b). A7 two-day timebox reached; Eric closed the run on 2026-11-12. |

## FP-01 open questions (issue #21), as answered on Crew 0.12.2

- FP-01 saw the bot DM row reported `removed` four times, with no start, progress, terminal or approval signal. Slice 1 traced the `removed` signals to probe defects H1 to H3 (#54). On 0.12.2 the live DM key also carries an id after the slug, so the derived `member-<slug>` form no longer finds the active DM (#60). With those fixed (#54, #60), S1-v1 observed start, progress and terminal on the bot's own slot.
- FP-01 did not know whether the probe bot dispatched a worker. In S1-v1 a session-create worker was observed and attributed through `created_by` (`lineage_minted=True`). A `spawn_run` subagent was not exercised: the bot has no `spawn_run` tool on 0.12.2. Eric accepted that as a coverage limit on 2026-11-15.
- `GET /api/chat/slots` answering 403 `Forbidden` with an approved grant is still FP-01 evidence. Slice 1 did not run the `chat-slots` step, which is out of the default run (FD2-G1).
