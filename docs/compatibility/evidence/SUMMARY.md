# FP-01 live evidence summary (closed 2026-11-12 by Eric: "Skip it, mark the rest UNTESTED"; A7 timebox)

Host Crew 0.12.0. Runs: L1 (stub), L2 (release, after #30), L3-v0 (no grants), L3-v1 (grants, pre-#34), L3-v1b (grants, after #34; run 20261111T230641Z-4f743d, authoritative for v1 cells).

## Host facts (OWNER-SESSION unless noted)
| id | status | evidence |
|---|---|---|
| host-ui-stub-failure | OBSERVED | L1: FP-00 named-`mount` stub → host boundary "App crashed", React #306 (lazy default undefined) |
| host-react-version | OBSERVED | L1: `window.__kirocrew_modules.react.version` = 18.3.1 |
| host-install-validates | OBSERVED | L1 stub manifest; L2 release manifest incl. `minKiroCrewVersion` 0.12.0 + own-namespace permission |
| host-ui-default-export-renders | OBSERVED | L2: release page renders |
| host-backend-spawn | OBSERVED | L2: backend serves `/api/ping` with `websockets` from requirements.txt; duration not measured |
| host-proxy-path | OBSERVED | L2: `/apps/specter-arena/api/ping` → backend `/api/ping`; `backend.routes` unused |
| host-roundtrip-signed | OBSERVED | L2: "Backend reachable at 2026-11-10T00:59:29Z" (backend answers 200 only to a valid v2 HMAC) |
| host-disable-reenable | OBSERVED | L2: disabled → "Enable this app from Apps to use it." (page not mounted); re-enabled → reachable 01:01:21Z |
| host-dev-diagnostic-only | OBSERVED | Staged probe app renders DIAGNOSTIC page; release tree has no diagnostic entry (CI-proven, #25) |
| host-import-map-sdk | OBSERVED | `@kirocrew/app-sdk` resolves (useAppApi works in L2/L3) |
| host-consent-screen | UNTESTED | no screenshot provided |
| NEW host-third-party-trust-gate | OBSERVED | L1: CLI enable refused ("third-party app execution is disabled"); enable via App Store Library per-app trust |
| NEW host-library-not-discover | OBSERVED | locally installed apps appear under `/apps/library`, not Discover |
| NEW host-sdk-own-namespace-not-implicit | OBSERVED | L2 first try: browser SDK refused `/api/ping` with `Declared: []`; own backend path must be in `permissions.api` (FD-27) |
| NEW host-single-page-route | OBSERVED | L3: `/apps/specter-arena/diagnostic` → Crew home; router has only `/apps/:name` |
| NEW host-agent-owner-steps-refused | OBSERVED | agents: browser tool refuses dashboard port; `kirocrew app install` from agent shell refused |

## Capability matrix (APP-TOKEN)
ALLOWED: app-owned-token-exchange; app-owned-ws-token-transport (query; 16 frames); user-slots-visible (slots:user, up to 34-37 rows); bot-id-observable (DM key `member-<slug>.memory-…`); bot-own-session-attribution (DM slot carries key + agent); bot-list-via-agents (`/api/agents` 200 with grant; probe row fields avatar, description, display_name, kiro_agent, memory_store, model, name, owns_mate_file, reasoning_effort, scope, session_color, source, triggers, workspace; no member id); bot-name-avatar.
DENIED: app-owned-unsigned-direct-rejected (401 unauthorized); user-slots-no-grant-denied (v0: 0 user rows without slots:user); bot-list-members-denied, bot-activity-read, bot-goals-read, bot-key-results-read, bot-ledger-read, bot-notes-memory-private (403 forbidden "app token not permitted for this endpoint"); other-app-api-denied (`/api/config` same 403); user-chat-slots-api (403 "Forbidden" WITH approved grant — handler-level refusal).
UNTESTED (reason: A7 timebox reached; Eric closed the run 2026-11-12) — all others, incl.: bot-worker-session-attribution (no worker row observed; unknown whether the bot dispatched one), user-signal-start/progress/terminal/approval/tool-error, user-outcome-evidence (DM row only produced `removed` signals; cause not found), closed-tab-collection, reconnect-*, gateway-restart-reconnect, bot-id-stable-across-rename, bot-delete-behaviour, bot-reimport-kirobot, bot-fresh-start, bot-scheduled-turn-origin, bot-attribution-survives-restart, bot-dashboard-member-record, bot-dashboard-record-ungranted, app-owned-grant-staging (v2 not run), app-owned-slots-visible, app-owned-token-lifetime, other-app-proxy-denied, other-app-slots-absent, user-chat-slot-history, user-source-links, external-cli-slot-appears, bot-per-bot-opt-in (expected UNSUPPORTED by source; not probed), bot-dashboard-webview-hook (FD-6, not probed).

## Known probe issue
Bot DM row reported `removed` x4 with no other signals in v1b; full-list frames to app sockets (`websocket_hub._serialize_for_client` → `filter_slots_for_app`) match the probe's parser, so the row was genuinely absent from some filtered frames. Root cause open.
