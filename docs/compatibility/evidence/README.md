# Probe evidence

Each live probe run commits its evidence under `docs/compatibility/evidence/<runId>/`: the run log, a capture index, and real rendered screenshots (not Vitest output or text snapshots).

Rules:

- Every file carries a credential label, `OWNER-SESSION` or `APP-TOKEN`, and an ISO 8601 UTC timestamp.
- Matrix `evidenceRef` values and host-fact evidence refs are relative paths under this directory. `node scripts/check-matrix.mjs` fails when a cited file does not exist.
- No literal credential, app secret, proxy header value or key block appears here. Describe formats in prose.
- The directory is empty of run data until the live run.
