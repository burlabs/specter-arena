# Component index

The repository is divided into five logical components. A component is an ownership unit for planning and review, not a deployable package.

| Component | Owns | Status |
|---|---|---|
| delivery | Toolchain, root commands, lockfiles and their checks, CI, the preview path (`infra/`, preview workflows), repository scripts, and all guidance docs | FP-00: PR-1, PR-3. FP-01: evidence validators, runbook. FP-02+03: contract tooling, spec ids, host-version policy. FP-04: spec ids, producer count and bundle budget guards, provenance disclosure |
| crew-integration | The host seam: `app.json`, the UI mount entry and stub shell, the Vite library build and its externals, the fixture stand-in and preview harness, the backend app and liveness probe | FP-00: PR-2, PR-4. FP-01: live probe. FP-02+03: slice 1 probe, store wiring, `GET /api/ready`. FP-04: attempts route, fixture SDK scenarios, mount swap |
| work-ledger | Ingesting bot work events and recording outcomes as facts | FP-02+03: the SQLite store, `backend/specter_arena/store/`. FP-04: `attempts_page` and the shared staleness cut |
| specter-identity | Each bot's Specter: identity, revisions, and assets | No changes yet (FP-05 owns the profile schema) |
| experience | The game UI and its feature areas under `ui/src/` | FP-04: the bot roster and monitoring view in `ui/src/observatory/`; owns `ui/src/` feature areas from FP-04 |

## Shared files

Some files are touched by more than one component. They are changed by one open PR at a time, in the order the feature plan sets:

- root `package.json` and `package-lock.json`
- `.github/workflows/ci.yml`
- `infra/package.json` and `infra/package-lock.json`
- `backend/uv.lock` and the root `requirements.txt`
