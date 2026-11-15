# Probe evidence

Each live probe run commits its evidence under `docs/compatibility/evidence/<runId or run step>/`: the run log and, where the diagnostic page produced one, its sanitised export.

## What is here (FP-01, Crew 0.12.0)

| Directory | Run | Contents |
|---|---|---|
| `L1/` | Unchanged FP-00 stub | `run-log.md` (OWNER-SESSION) |
| `L2/` | Release tree, before and after PR #30 | `run-log.md` (OWNER-SESSION) |
| `L3-v0/` | Probe app, no grants | `run-log.md`; the raw export was not saved |
| `L3-v1/` | Probe app with grants, before PR #34 | `run-log.md`, `export.json` (run `20261110T013502Z-d9acb2`); superseded |
| `L3-v1b/` | Probe app with grants, after PR #34 | `run-log.md`, `export.json` (run `20261111T230641Z-4f743d`); authoritative for the grant-phase cells |
| `SUMMARY.md` | FP-01 runs | Closing summary: host facts, ALLOWED and DENIED cells, and the UNTESTED list |

## What is here (FP-02+03 slice 1, Crew 0.12.2)

| Directory | Run | Contents |
|---|---|---|
| `S1-v0/` | Probe app, phase v0 (own api entry only) | `run-log.md`, `export.json` (run `20261115T205118Z-a923f2`) |
| `S1-v1a/` | Probe app, Eric's broad grant, before #60 | `run-log.md`, `export.json` (run `20261115T211724Z-47f73a`); superseded |
| `S1-v1/` | Probe app, Eric's broad grant, after #60 | `run-log.md`, `export.json` (run `20261115T215658Z-8625d7`); authoritative for the 0.12.2 grant-phase cells |

Slice-1 event-frame captures are in `tests/recorded/crew-0.12.2/`. The grant set and the stop-trigger reading are in `../crew-0.12.2.md`.

Inside an export, `ref` values such as `run/<runId>/deny-matrix` name probe steps of that run. Matrix and host-fact refs in the JSON files point at the committed files here, with the cell or fact id after `#`.

## Not here

- Screenshots. Eric reported them to the coordinator as pasted images or text in chat; none was saved as a file, so none is committed.
- Sanitised payloads for `tests/recorded/crew-0.12.0/`. The exports are not in the `_meta` plus `rows` shape that `scripts/check-recorded.mjs` validates, so they stay here as evidence only.

Rules:

- Every file carries a credential label, `OWNER-SESSION` or `APP-TOKEN`, and an ISO 8601 UTC timestamp where one was recorded.
- Matrix `evidenceRef` values and host-fact evidence refs are relative paths under this directory. `node scripts/check-matrix.mjs` fails when a cited file does not exist.
- No literal credential, app secret, proxy header value or key block appears here. Describe formats in prose.
- Only the throwaway probe bot (`specter-probe-bot`) is named. Rows from other bots and users are hashed or redacted by the export.
