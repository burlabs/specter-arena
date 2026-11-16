# FP-02+03 requirements: domain contracts, durable state, and continuous observation

One merged session, one design, one plan. Pass 1 builds the focused APP-TOKEN probe (slice 1) and the probe-independent foundations. Pass 2 is designed after slice 1 merges and Eric has read its results, by re-entering the planner through its material-change path; it extends this folder rather than creating a second one (decision D-P2). Requirement ids are registered in `spec/ids.md`.

## Acceptance criteria (verbatim from the intake)

### FP-02

- **FP-02-AC01:** Persisted identity and observations survive service restart; migrations apply to an empty store and the previous test schema.
- **FP-02-AC02:** The same source identity in two installations cannot collide; rename and concurrent-session cases do not create duplicate permanent agents.
- **FP-02-AC03:** Malformed or cross-scope records are rejected; unknown event variants are quarantined or reported without crashing ingestion.
- **FP-02-AC04:** Frontend/backend contract tests consume the same versioned fixtures and reject incompatible payloads.
- **FP-02-AC05:** A projection rebuild reproduces the expected fixture state without issuing external calls or generating new rewards.
- **FP-02-AC06:** The schema contains no required Specter class, archetype, species category, capability score, or hidden agent classifier.

### FP-03

- **FP-03-AC01:** Tracked real work updates durable state while the arena tab is closed.
- **FP-03-AC02:** Duplicate delivery, reconnect overlap, out-of-order messages, source restart, and two simultaneous sessions have explicit tested behavior.
- **FP-03-AC03:** An unrecoverable disconnect produces a visible coverage gap and never falsely marks an agent healthy or a task accepted.
- **FP-03-AC04:** Revoked permission, disabled app, and authentication failure stop collection safely; no broad credential fallback occurs.
- **FP-03-AC05:** Agent rename, replacement, deletion, and reappearance preserve history without unintended identity merges.
- **FP-03-AC06:** Bounded load tests show queue behavior and redacted diagnostics; failures cannot silently drop observations while reporting full coverage.

Under program amendment PA-1, read every "agent" above that anchors a Specter, a binding, XP, level, or health as bot.

## Requirements per criterion

Pass 1 delivers the parts marked "Pass 1". The rest are designed in Pass 2 against proven signals only.

| Id | Requirement | Acceptance criteria | Pass |
|---|---|---|---|
| FP02-REQ-01 | The store persists across restart and reinstall and applies forward migrations to an empty store and to the previous test schema. | FP-02-AC01 | 1 (store, empty and restart parts) |
| FP02-REQ-02 | Source identities are scoped by installation and workspace; renames and concurrent sessions never create a second permanent bot. | FP-02-AC02 | 2 |
| FP02-REQ-03 | Malformed and cross-scope records are rejected; unknown event variants are quarantined or reported. | FP-02-AC03 | 2 |
| FP02-REQ-04 | Backend and frontend contract tests read the same versioned cases from `contracts/` and reject incompatible payloads. | FP-02-AC04 | 1 |
| FP02-REQ-05 | A projection rebuild from stored observations reproduces fixture state with no external call and no reward. | FP-02-AC05 | 2 |
| FP02-REQ-06 | No schema or migration carries a required class, archetype, species, category, score, rating, or hidden classifier field; `npm run check:schema` proves the guard can fail. | FP-02-AC06 | 1 |
| FP03-REQ-01 | Collection runs in the backend while the app is enabled, with the tab closed. | FP-03-AC01 | 2 |
| FP03-REQ-02 | Duplicate, overlap, out-of-order, restart, and two-session behavior is explicit and tested. | FP-03-AC02 | 2 |
| FP03-REQ-03 | An unrecoverable gap is a stored, visible coverage gap; it never marks a bot healthy or work accepted. | FP-03-AC03 | 2 |
| FP03-REQ-04 | Revoked permission, a disabled app, and an authentication failure stop collection with no credential fallback. | FP-03-AC04 | 2 |
| FP03-REQ-05 | Rename, replacement, deletion, and reappearance keep history without unintended merges. | FP-03-AC05 | 2 |
| FP03-REQ-06 | Bounded load tests show queue behavior and redacted diagnostics; no silent drop under full coverage. | FP-03-AC06 | 2 (bounds carried in `design.md`) |

## Refined session requirements (RS-1 to RS-14)

| Id | Requirement | Source | Pass |
|---|---|---|---|
| FP0203-DEL-1 | Two passes in one project directory (D-P2). Pass 1: research all impacted components; design and plan slice 1 (probe) and the probe-independent foundations; issues for those only. Pass 2: after slice 1 merges and Eric reads the results, re-enter through the SOP's material-change path for bot binding, observation envelope, Attempt, WorkItem, coverage/gap records, collector lifecycle, and the ordering/history gate. | RS-1 | 1 |
| FP0203-CI-1 | Overlay grants (D-P1): events `slots:user`, `subagent:user`; api `/apps/specter-arena/api/*`, `/api/agents`, `/api/usage`, `/api/sessions/usage`. Release `app.json` unchanged. | RS-2 | 1 |
| FP0203-CI-2 | The probe records per-slot event frames (`chat_status`, `chat_done`, `approval*`, `question_card`, `tool_*`, `subagent_*`, `context_usage`) for bot-rooted slots, in addition to slot-list diffs (R1, R2). | RS-3 | 1 |
| FP0203-CI-3 | Required scenarios: bot turn with lifecycle signals; bot dispatches a worker; approval request; bot rename; arena tab closed while the bot works (backend keeps collecting); app-side WS close/reopen during a running turn (D-P3); `/api/usage` and `/api/sessions/usage` with an app token. Optional final scenario: gateway restart, on Eric's go-ahead (FD-21). | RS-4 | 1 |
| FP0203-CI-4 | Every result is a matrix cell (new or updated) with APP-TOKEN evidence; non-bot frames shape-only (A2); `capability-questions.json`, `capability-matrix.json/.md` and counts updated in the same PR. | RS-5 | 1 |
| FP0203-DEL-2 | The matrix and recorded-capture validators accept the new cells, per-cell host versions, and event-frame captures (companion to FP0203-CI-4). | RS-5 | 1 |
| FP0203-CI-5 | Run logistics (D-P4): one hands-on sitting of about 30-45 minutes; Eric installs the staged probe app from the slice 1 PR branch before merge; 1 working day ceiling from install; unanswered cells become UNTESTED with reason. Owner steps get exact written instructions. | RS-6 | 1 |
| FP0203-CI-6 | Stop triggers (D-P5): S1 no lifecycle signal of any kind for a bot-rooted slot across a completed bot turn; S2 bot-dispatched worker not observed or not attributable. Either stops Pass 2 for Eric's scope decision. No fixture, private-store, or broad-token fallback. | RS-7 | 1 |
| FP0203-WL-1 | SQLite store in the app's own data directory, kept across reinstall; forward migrations on open; explicit purge only (D-P6). | RS-8 | 1 |
| FP0203-WL-2 | Migration baseline, transactions, health/readiness, basic backup/restore, pagination primitives (FP-02-AC01 restart and empty-store parts). | RS-9 | 1 |
| FP0203-DEL-3 | One authoritative wire-schema source with backend and frontend validation and shared versioned fixtures (FP-02-AC04); FP-05's profile schema must plug into it (read FP-05's design dir before freezing). | RS-10 | 1 |
| FP0203-DEL-4 | Versioning and compatibility rules; namespaced spec IDs reserved centrally; contract owners recorded. | RS-11 | 1 |
| FP0203-WL-3 | The probe never opens the store; product state cannot receive probe or fixture data (invariant 11). | RS-12 | 1 |
| FP0203-DEL-5 | No Specter class, archetype, species, capability score, or hidden classifier anywhere in the schema (FP-02-AC06); only a bot-binding reference is reserved for FP-05. | RS-13 | 1 |
| FP0203-DEL-6 | Pass 2 (designed after slice 1; listed so Pass 1 does not preclude them): FP-02-AC02, AC03, AC05 and FP-03-AC01..AC06 against proven signals only. | RS-14 | 2 |

## Exclusions

Roster UI (FP-04), Specter or Grimoire work (FP-05), encounters and XP (FP-08+09); total ordering across sources, replay UI, CQRS infrastructure, a message broker, multi-tenant SaaS, a complete future schema; transcript-based quality judging, automated agent repair, forced history import, a Feature Planner dependency; `/api/member-records/*` (FP-10).
