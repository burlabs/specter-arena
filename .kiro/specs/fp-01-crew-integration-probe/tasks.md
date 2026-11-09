# FP-01 tasks

Shared single-writer files (root `package.json` and lock, `.github/workflows/ci.yml`, `backend/uv.lock`, `requirements.txt`) change in one open PR at a time. S1 may hold the root `package.json` token if a React pin is needed; S2 waits for it.

- [ ] S0 delivery: spec folder, compatibility skeletons, validators, runbook, preview exception, steering fix (no shared file)
- [ ] S1a crew-integration: live baseline on unchanged `main`, default-export entry, host SDK seam
- [ ] S1b crew-integration: signed `/api/ping`, HMAC verifier, version floor, `websockets`; delivery adds the `DEPENDENCIES.md` rows
- [ ] S2 joint (crew-integration + delivery, one PR): diagnostic build seam, exclusion check, positive control, root commands
- [ ] S3a crew-integration: probe logic and dev-switched routes; regenerates `capability-questions.json` and the skeletons
- [ ] S3 experience: diagnostic view components
- [ ] S3b crew-integration: live driver and diagnostic entry wiring
- [ ] S4 live probe run, evidence, recorded payloads, matrix, host facts, compatibility record
- [ ] S4 decision gate: AC05, PA1-D2, PA1-D5 recorded in `docs/compatibility/monitoring-scope.md`
