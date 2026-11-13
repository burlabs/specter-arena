# L3 phase v1 (probe grants: /api/agents, /api/chat/slots, /api/member-records/*, events slots:user) — 2026-11-10

Diagnostic page summary as pasted by Eric (SOURCE: LIVE, APP-TOKEN). Counts: ALLOWED 3, DENIED 4, UNSUPPORTED 0, UNTESTED 39.

Changes vs v0:
- user-slots-visible: ALLOWED (slots:user delivers user-origin slot rows).
- user-slots-no-grant-denied: UNTESTED (correct: grant declared; v0 holds the DENIED evidence).
- bot-list-via-agents, bot-name-avatar: DENIED -> UNTESTED (the /api/agents grant changed the outcome; body did not match the expected shape — needs the evidence excerpt).
- user-chat-slots-api: still DENIED with the /api/chat/slots grant declared — needs the status code (scope 403, handler refusal, or grant not approved).
- No bot attribution or session signal cell concluded (bot-id-observable, bot-own/worker-session-attribution, user-signal-*): no probe-bot rows recognised. Probe recognises the bot DM as slot key `member-<slug>` and workers by `created_by`. Possible causes: slug mismatch, DM slot keyed differently, or capture finished before the task ran.
Raw export not yet saved (folder did not exist). Export route: GET /apps/specter-arena/api/probe/export (proxy-signed; open in the signed-in browser).

## Export analysis (export.json, run 20261110T013502Z-d9acb2)
- Feed: token via query transport, 17 frames; snapshots held up to 37 rows (slots:user works). attempts: 0.
- Approved grants (kirocrew app info): api [/apps/specter-arena/api/*, /api/agents, /api/chat/slots, /api/member-records/*], events [slots:user] — so the grants WERE approved.
- GET /api/chat/slots → 403 {code, error} despite the approved grant; GET /api/members → 403; GET /api/config → 403. The code/error values were not recorded (excerpt keeps only field names), so a grant-specific refusal cannot be told apart from a generic token rejection on HTTP. Probe gap.
- /api/agents: no evidence item (UNTESTED) — outcome not captured. Probe gap.
- Probe bot not recognised. Eric's bot URL: /members?member=specter-probe-bot. The probe matches the DM slot key by exact equality `member-<slug>`; Crew 0.12.0 appends `.memory-<store>` to a member's DM slot key when the bot has its own memory store (DM_SLOT_KEY_PREFIX / MEMORY_STORE_SLOT_SUFFIX in kiro_crew/members_parts/member_space.py). Bots have private memory, so the key is probably `member-specter-probe-bot.memory-<store>`. Probe gap: match the prefix and strip the suffix.
