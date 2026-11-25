# Kiro Crew 0.13.0 compatibility record (source reading)

**Source reading, not live-proven. The owner sitting was skipped by Eric on 2026-11-21.** Nothing here was observed on a running gateway with an app token. Every statement comes from reading the installed Crew 0.13.0 Python source (`kiro_crew/` under `/Applications/KiroCrew.app/Contents/Resources/backend-dist/kirocrew-backend-arm64/lib/python3.12/site-packages/`), cited as `kiro_crew/<path>:<line>`. Every FP-20 matrix cell stays `UNTESTED`; its note points here. A cell moves only when a probe run produces APP-TOKEN evidence. The probe that would do it is in the repo (phase v3, `fp20-sitting-runbook.md`) and was not run.

Specter Arena's release behaviour that rests on this record fails closed: a flag Crew does not send reads as "Not collected" or leaves the condition unchanged.

## What shipped on this reading (FP-20 PR-B, no new grant)

| Behaviour | Depends on | Grant used |
|---|---|---|
| `waiting` condition ("Waiting on you") from `pendingApproval` and `needsInput`, `GET /api/roster?view=signals` | rows 1 and 2 below | `slots:user` (release) |
| `tokenReading`, "Context in use" per bot | row 3 | `slots:user` (release) |

Not shipped, with the reason: subagent attribution (PR-B-2), "Blocked", the member-record writer, the usage endpoints, history reconstruction. See the last section.

## Cell by cell

| Cell | Status | What the source says | Where |
|---|---|---|---|
| `user-signal-approval` | UNTESTED | A pending native tool approval registers a future on the slot and calls `push_slots_update`. The slot row then carries `pending_approval: true`. `needs_input` is true while a question card is open. Both ride the `slots` frame, which `slots:user` admits for user-origin slots. `waiting_for_input` is true for any bot whose last row is an assistant reply, so it is not a "waiting on you" signal. | `kiro_crew/dashboard/chat_turn/permission_prompt.py:352-366`; `dashboard/slot_projection.py:381-382`, `:415-420`, `:422`, `:586-591`; `dashboard/ws_event_scope.py:690-700`, `:1445-1470` |
| `user-signal-approval-resolved` | UNTESTED | A native approval ends with `approval_resolved {id, approved, slot, origin: "native", mid}`. A coordinator approval adds `instance`, and `decision: "expired"` when nobody answered. The frame is slot-scoped (`slots:user`). | `dashboard/chat_turn/permission_prompt.py:818-826`; `dashboard/interaction_coordinator.py:33-37`, `:290-320`; `dashboard/ws_event_scope.py:243-244` |
| `user-signal-blocked-distinct` | UNTESTED | No durable blocked state is on the wire. A person's Deny, a host timeout (7200 s attended, 180 s unattended) and a host auto-reject all end as `approval_resolved` with `approved: false`; the cause goes to the crew log only. A deny-rule refusal emits one `activity_event` whose text starts `Blocked:`. Source predicts UNSUPPORTED, so "Blocked" stays "not observable yet". | `dashboard/chat_turn/permission_prompt.py:757-770`; `dashboard/state_parts/dashboard_state.py:1050`, `:1056`; `dashboard/chat_turn/tool_approval.py:1727-1730` |
| `user-signal-tool-error` | UNTESTED | The 0.12.2 capture shows `tool_result` frames with no error field; nothing in 0.13.0 source changes that for app tokens. Not re-read in detail. | `tests/recorded/crew-0.12.2/s1-v1-event-capture.json` |
| `subagent-events-visible` | UNTESTED | `spawn_run` runs send `subagent_spawn`, `subagent_done` and the other `subagent_*` frames with `{id, slot}`; `slot` is the parent's tab key (the root's for nested runs). `subagent:user` admits user-origin slots. Without it, `_subagent_visible` falls back to ordinary slot visibility, so `slots:user` alone should admit them. Above 8 active subagents Crew sends `subagent_batch_update` with per-item slots. | `slack/gateway_runtime/subagent_wiring.py:436-460`; `subagent_manager/turn_session.py:587-603`; `subagent_manager/terminal.py:458-480`; `dashboard/ws_event_scope.py:263-288`, `:1050-1090` (fallback at `:1086`) |
| `bot-worker-session-attribution-subagent` | UNTESTED | Frame `slot` equals the bot's DM slot key, which Crew derives as `member-<slug>.memory-<store>`. No `created_by` is involved. A bot has a `spawn_run` tool only if its session mounts `kirocrew-core`; which bot templates do is not established from source. | `members_parts/member_sessions.py:437-452`; `agent_sdk/tool_search.py:284-290`; `agent_sdk/backends_members.py:79-88` |
| `bot-token-usage-per-bot` | ALLOWED (0.12.2, names only) | Source reading: `/api/usage` returns account-wide analytics (sessions per day, billing, token history by provider and model, the OS username). `/api/sessions/usage` returns the signed-in account's credit reading. Neither is grouped per bot. The 0.12.2 "per-bot field names" came from a key-name heuristic and is not a per-bot figure. | `dashboard/handlers/usage.py:707-768`; `dashboard/handlers/sessions.py:1806-1875` |
| `bot-token-usage-turns-app-scoped` | UNTESTED | `/api/usage/turns?slot=` is the only per-slot reader. For an app caller it returns only rows stamped with that app at write time, so a bot slot the app does not own answers 200 with no rows. It needs its own grant. | `dashboard/handlers/telemetry.py:1647-1715`; `dashboard/handlers/usage_spend.py:254-283` |
| `bot-token-context-usage` | UNTESTED | `context_usage` frames carry `{slot, used_tokens, window_tokens, pct}` and are slot-scoped (`slots:user`). They gauge the context window in use on the live turn. They are not cumulative spend. | `dashboard/dashboard_persistence.py:548`; `dashboard/ws_event_scope.py:229`; `tests/recorded/crew-0.12.2/s1-v1-event-capture.json` (`keysSeen.context_usage`) |
| `bot-dashboard-member-record` | UNTESTED | `POST /api/member-records/{slug}` takes `{"type": name, "data": object, "max_age_s"?: int}`. Stored under `specter_arena__<type>`; the type is letters, digits and single underscores, 64 characters at most with the prefix. `data`: depth 8, 8 KiB. 30 records a minute per app, counted before the body is read. A page shows it only if the owner binds `custom.latest.specter_arena__<type>`. The 0.12.2 400 `bad_record_type` was a probe body defect. Grant: `/api/member-records/*`. | `dashboard/handlers/agent_panel_record_app.py:102-107`, `:185-260`; `dashboard/handlers/agent_panel_record.py:76`, `:357-395`; `crew_log/entry_types_surfaces.py:184-191`; `builtin_skills/dashboard/SKILL.md:254` |
| `bot-dashboard-record-ungranted` | UNTESTED | An app token without the grant is refused by the deny-by-default scope check before the handler runs. | `dashboard/token_auth_app_scope.py:246-291` |
| `gateway-restart-reconnect` | UNTESTED | On connect an app's socket gets a `slots` snapshot filtered to its scopes first, then `dashboard` frames on an interval. There is no sequence number, cursor or "since" parameter. | `dashboard/ws.py:991-1038`, `:1086-1100` |
| `bot-attribution-survives-restart` | UNTESTED | The DM key is derived from slug and store, so it is stable. After a restart `lineage_minted` is not restored, and `created_by` is restored only when the crew log's creation record names the same creator; otherwise it becomes `unverified:creator`. Specter Arena attributes a worker only when `created_by` equals a bound DM key, so such a worker stays unattributed (counted in `other_rows`). In-memory approval futures do not survive a restart. | `dashboard/slot_persistence/metadata_codec.py:575-607`; `dashboard/session_control_parts/session_revive.py:282`; `dashboard/slot_projection.py:666`; `backend/specter_arena/collector/parse.py` (`parse_slots`) |
| `reconnect-cursor-history` | UNTESTED | No cursor and no history API an app token can call. The only replay available to an app is subagent replay after `subscribe_subagents` / `subagent_replay`, and finished-run replay needs the crew log on. Chat history needs `/api/chat/*`, which the release grants and CI forbid. | `dashboard/ws.py:1391-1470`, `:1829-1833` |
| `subagent-replay-after-reconnect` | UNTESTED | Same replay path as the row above: running native cards replay as `subagent_snapshot`, finished ones as `subagent_done`. | `dashboard/ws.py:1391-1470` |
| `user-chat-slot-history` | UNTESTED | Not probed in phase v3: it needs `/api/chat/*`. | none |

## Grant syntax on 0.13.0

An `api` entry that starts with `=` matches that one path only; `<base>/*` matches the base and any child; a bare entry matches itself and children. A host below App Kit seam level 7 reads an `=` entry as a literal that matches nothing, so it fails closed there. Source: `dashboard/token_auth_app_scope.py:186-213`. The repo's `Grants.has_api` models `=` and keeps the older children-only reading of `/*`.

## App icons on 0.13.0

Read from the installed 0.13.0 bundle (`static/dist/assets/main-*.js`, `first-load-1-*.js`) and backend (`apps/manifest_sections.py`, `apps/routes_static.py`, `apps/routes_art.py`), 2026-11-21. Source reading, not yet checked live; the RC-3 owner sitting checks it.

- A third-party app's `ui.pages[].icon` glyph name is ignored (`glyphAllowed` is false), which is why the default box showed.
- The sidebar uses, in order: the top-level `iconPath`/`iconPathDark` when set, then `ui.pages[0].iconUrl`, then the default box, all at 20 x 20. `ui.pages[0].iconInactiveUrl` replaces the icon while the row is not selected.
- `iconPath`/`iconPathDark` are relative to the app root and served by `GET /apps/<name>/art/<path>` for any installed app, local installs included, but only for paths the manifest declares (image types, at most 8 MiB). `iconUrl`/`iconInactiveUrl` are relative to `ui/` and served by `GET /apps/<name>/ui/<path>` (unauthenticated, image types allowed).
- `UIPage.from_dict` reads `route`, `label`, `icon`, `iconUrl`, `iconInactiveUrl`, `entryPoint` and `mountFunction`; any other page key is dropped without an error.

Specter Arena sets all four: `iconPath` and `iconPathDark` to `ui/icons/logo-active@3x.png`, `iconUrl` to `icons/logo-active@2x.png`, and `iconInactiveUrl` to `icons/logo-inactive@2x.png`.

## Not shipped on this reading

- **Subagent attribution (PR-B-2).** It needs a new collector frame path, new stored event types, a new attempt kind and end signal, `attempt-item.v2`, and a liveness rule for a `subagent:<id>` slot that has no row. That puts the PR well past the ~1,000-line limit, and the frames could not be checked on a live gateway. It stays in the probe.
- **"Blocked".** No durable source signal.
- **Member-record writer, usage endpoints.** Each needs a new grant line, which Eric has not approved.
- **History reconstruction.** Crew offers no cursor or history API to an app token; a restart stays a recorded coverage gap.
