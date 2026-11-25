# L3 phase v1 rerun (main c997914) — run 20261111T230641Z-4f743d, captured 2026-11-11T23:25:32Z

All cells APP-TOKEN. Counts: ALLOWED 7, DENIED 9, UNTESTED 30. Dropped frames: 0.

ALLOWED:
- app-owned-token-exchange (token 258 chars, value not recorded); app-owned-ws-token-transport (query; 16 frames)
- user-slots-visible (up to 34 rows with slots:user)
- bot-id-observable: DM slot key `member-specter-probe-bot` present (actual key carries the `.memory-…` suffix; confirms the #33 fix)
- bot-own-session-attribution: DM slot carries key and agent fields
- bot-list-via-agents: `/api/agents` 200 with the grant; probe bot row fields: avatar, description, display_name, kiro_agent, memory_store, model, name, owns_mate_file, reasoning_effort, scope, session_color, source, triggers, workspace (no member id/slug field)
- bot-name-avatar: name/display_name and avatar fields present

DENIED (all 403):
- `/api/members`, `/api/members/<slug>/activity|goals|goals/key-results|projections|notes`: `code="forbidden"; error="app token not permitted for this endpoint"` (token scope check; no grant declared for /api/members)
- `/api/config`: same scope refusal
- `/api/chat/slots` WITH the approved grant: `code="forbidden"; error="Forbidden"` — a different refusal than the scope check, so the handler (or another layer) refuses app tokens even when granted
- app-owned-unsigned-direct-rejected: 401 `error="unauthorized"`

Attempts: 1 bot-turn on the DM slot, signals `removed` x4, no start/progress/terminal/approval signals, outcome evidence null. No worker attempt recognised.
Open: did the bot dispatch a worker; why the DM row is repeatedly reported removed (likely frames where the row is absent from the filtered snapshot, e.g. incremental frames).
