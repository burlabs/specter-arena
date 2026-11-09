# FP-01 requirements: installed Crew shell and bot telemetry capability proof

Specter Arena is installed into a real Kiro Crew 0.12.0 and a committed, evidence-backed capability matrix records what the app can and cannot see. Per the PA-1 pivot, the subject is Crew bots, not agents. "Fixtures" in the intake means recorded real payloads under `tests/recorded/crew-0.12.0/`, distinct from the synthetic stand-ins under `ui/fixtures/`.

## Acceptance criteria (verbatim from the intake)

- **FP-01-AC01:** A real installed app page calls the actual backend successfully; out-of-scope or unauthorized calls fail without privileged-token fallback.
- **FP-01-AC02:** A real attempt appears in the diagnostic view with supported identity and outcome evidence. A completed model turn is not described as accepted work.
- **FP-01-AC03:** Closing the tab establishes whether collection continues, and reconnect testing establishes exactly what can be recovered.
- **FP-01-AC04:** The capability matrix covers user/app/cross-app scope and external CLI visibility; inaccessible information is marked inaccessible, not guessed.
- **FP-01-AC05:** The approved monitoring scope is sufficient for a real demo and is documented for the user. If it is not, later monitoring implementation is blocked pending a real scope decision.
- **FP-01-AC06:** The probe produces reproducible commands/evidence and sanitized fixtures; mocks alone do not pass this feature.

## Requirements

| Id | Requirement | Acceptance criteria |
|---|---|---|
| FP01-REQ-01 | An installed app page reaches the backend through a signed round trip; unsigned or ungranted calls fail with no privileged fallback. | FP-01-AC01 |
| FP01-REQ-02 | A real attempt appears in a dev-only diagnostic view with identity, signals and outcome evidence; outcome evidence never says "accepted". | FP-01-AC02 |
| FP01-REQ-03 | Collection with the tab closed, and what a reconnect recovers, are established by the probe. | FP-01-AC03 |
| FP01-REQ-04 | The capability matrix covers app-owned, user-owned, other-app, bot and external-CLI scope. ALLOWED needs APP-TOKEN evidence in every scope; DENIED and UNSUPPORTED need an existing evidence file; anything not probed is UNTESTED with a reason. | FP-01-AC04 |
| FP01-REQ-05 | The monitoring scope is decided at a gate with Eric and recorded in `docs/compatibility/monitoring-scope.md`; FP-03 monitoring is blocked until its status reads APPROVED. | FP-01-AC05 |
| FP01-REQ-06 | Evidence is reproducible: runbook, committed evidence directory, sanitised recorded payloads, and offline validators for both. | FP-01-AC06 |
| FP01-REQ-07 | The dev-only diagnostic view never ships: the release bundle and `app.json` are scanned, with a positive control. | FP-01-AC02 |
| FP01-REQ-08 | The compatibility record pins Kiro Crew 0.12.0 as the only version probed. | FP-01-AC01 |

## Delivery requirements

| Id | Requirement | Slice |
|---|---|---|
| FP01-DEL-1 | Release `ui/dist` and `app.json` never contain the diagnostic view; a positive control proves the check can fail. No new required CI check. | S2 |
| FP01-DEL-2 | Committed question list, capability matrix, rendered matrix, host facts, compatibility record and evidence directory, with a validator. | S0 |
| FP01-DEL-3 | `tests/recorded/crew-0.12.0/` layout and a deterministic shape check for non-probe rows. | S0 |
| FP01-DEL-4 | Root commands for the diagnostic build, positive control and offline evidence validation. | S2 |
| FP01-DEL-5 | Standing preview exception for surfaces that need a live Crew. | S0 |
| FP01-DEL-6 | Probe runbook: owner steps versus APP-TOKEN steps, timestamps, credential labels, timebox, "green CI is not live proof". | S0 |
| FP01-DEL-7 | This spec folder and its row in `spec/index.md`. | S0 |
| FP01-DEL-8 | Guidance and provenance fixes: Crew 0.12.0 in `.kiro/steering/tech.md`, the xiaoya-crew-app read-only prior-art note. | S0 |
| FP01-DEL-9 | Single-writer slice order S0, S1, S2 (one joint PR), S3, S4. | all |
| FP01-DEL-10 | Host facts are mechanism facts, not permissions, and live outside the matrix. | S0 |
| FP01-DEL-11 | `monitoring-scope.md` records the AC05, PA1-D2 and PA1-D5 decisions. | S0 skeleton, S4 fill |

## Privacy and labels

- Evidence carries a credential label (OWNER-SESSION or APP-TOKEN) and a UTC timestamp.
- Nothing secret is committed; formats are described in prose.
- The probe runs against a throwaway probe bot. Notes, memory and lessons of real bots are never read.
