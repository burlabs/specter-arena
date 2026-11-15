# Kiro Crew 0.12.2 compatibility record

FP-02+03 slice 1 probed Specter Arena against Kiro Crew 0.12.2 on 2026-11-15. Eric read the version with `kirocrew --version` before the sitting. The manifest floor stays `minKiroCrewVersion: "0.12.0"`. FP-01 evidence for 0.12.0 is in `crew-0.12.0.md`, and cells it decided keep their 0.12.0 evidence unless slice 1 decided them again.

## Grant set: read this first

Phase v1 ran under **Eric's broad owner grant**, decided in chat on 2026-11-15 (a hackathon scope call), not the D-P1 set the plan approved:

- api: `/apps/specter-arena/api/*`, `/api/*`
- events: `slots:user`, `slots:all`, `subagent:user`, `subagent:all`, `notification:all`, `sessions`, `artifacts`, `log`, `panels`, `skills`, `workflow_run_event`, `yolo`

The staged app version was `0.0.0-probe.4`. The release `app.json` was not changed. An ALLOWED 0.12.2 cell therefore shows what a fully granted app can reach. Before FP-03 relies on a cell, it must choose the shipped grant set, and narrower grants may answer differently. In Crew 0.12.2 an api entry ending in `*` matches by prefix (`dashboard/token_auth_app_scope.py`), so `/api/*` passes the scope gate for every `/api/...` path. The member ledger, goals and activity routes and `/api/members` answered 404 `not_found` under the broad grant, where phase v0 got the 403 scope refusal. The matrix cites the v0 refusals for those cells, because a 404 under a grant that admits the path does not show the app is refused.

## Install method

Eric installed every build from the clone with `kirocrew app install .probe-app` and approved the grants on the app's detail page (`/apps/detail/specter-arena`). The App Store lists the app by its `displayName`, "Specter Arena"; "Specter Diagnostic" is only the label of its single page. An agent's `kirocrew app install` was refused again on 0.12.2: "The gateway could not verify this process as the local owner … Nothing was installed." A reinstall replaces the app directory, including the backend's `.probe-out/` folder, so each run's files were copied out before the next install. Credential label for these observations: OWNER-SESSION.

## Runs

| Run | Build | What it settled | Evidence |
|---|---|---|---|
| S1-v0 | main 062f3b6, phase v0, run `20261115T205118Z-a923f2` | Deny-by-default cells (`user-slots-no-grant-denied`, member routes, `/api/config`) | `evidence/S1-v0/` |
| S1-v1a | main 062f3b6, broad grant, run `20261115T211724Z-47f73a` | Superseded: the probe did not recognise the bot's live DM slot (fixed in #60) | `evidence/S1-v1a/` |
| S1-v1 | main 533a314, broad grant, run `20261115T215658Z-8625d7` | Lifecycle signals, session-worker attribution, reconnect snapshot, usage endpoints, outcome evidence | `evidence/S1-v1/` |

Event-frame captures for S1-v0 and S1-v1 are in `tests/recorded/crew-0.12.2/`.

## What 0.12.2 showed

- **The bot's DM slot key is not the derived form.** The live DM key was `member-specter-probe-bot-<12 hex>.memory-…`; Crew inserts an id after the slug. The only `member-specter-probe-bot.memory-…` row was the FP-01 bot's stale DM, last active 2026-11-12. The probe now also recognises the bot's slot by an exact match of the row's `agent` field to the slug (#60).
- **Lifecycle signals reach an app token** for the bot's own slot: row `running` transitions plus `chat_status`, `tool_call`, `tool_result`, `context_usage` and `chat_done` events. `last_activity_ts` is a JSON string.
- **A session-create worker is attributable** through `created_by`, with `lineage_minted=True`.
- **The reconnect snapshot carries running state over** (2 of 2 probe rows). No history was replayed after the reconnect.
- **`/api/usage` and `/api/sessions/usage` answer an app token** under the broad grant. They carry a per-session field name. The probe recorded field names only, and what the figures mean is not concluded (FD2-G4).
- `tool_result` frames carried no error indicator, and no `question_card` arrived.

## Stop triggers (FD2-G3)

Reported to Eric on 2026-11-15; Eric decided the scope.

| Check | Result |
|---|---|
| S1 lifecycle | Did not fire: `user-signal-start`, `-progress` and `-terminal` are ALLOWED on the bot's slot |
| Mechanism 1: session-create worker (prompt B) | Passed: `bot-worker-session-attribution` ALLOWED |
| Mechanism 2: `spawn_run` subagent (prompt C) | Not exercised: the probe bot has no `spawn_run` tool on 0.12.2 and refused the prompt |
| S2 | Did not fire, because mechanism 1 passed. Eric accepted the `spawn_run` gap as a coverage limit on 2026-11-15. |

## Not exercised in this sitting

The sitting was shortened to prompts A, B and C by Eric. Approval (D), rename (E) and the closed tab (F) did not run, and the optional gateway restart did not run. Their cells are UNTESTED with that reason. `closed-tab-collection` stays UNTESTED although the capture saw a 900 s gap with no page request, because the tab was not closed.
