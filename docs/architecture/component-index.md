# Component index

The repository is divided into five logical components. A component is an ownership unit for planning and review, not a deployable package.

| Component | Owns | FP-00 status |
|---|---|---|
| delivery | Toolchain, root commands, lockfiles and their checks, CI, the preview path (`infra/`, preview workflows), repository scripts, and all guidance docs | Changes in PR-1 and PR-3 |
| crew-integration | The host seam: `app.json`, the UI mount entry and stub shell, the Vite library build and its externals, the fixture stand-in and preview harness, the backend app and liveness probe | Changes in PR-2 and PR-4 |
| work-ledger | Ingesting agent work events and recording outcomes as facts | No changes |
| specter-identity | Each agent's Specter: identity, revisions, and assets | No changes |
| experience | The game UI and its feature areas under `ui/src/` | No changes; owns `ui/src/` feature areas from FP-04 |

## Shared files

Some files are touched by more than one component. They are changed by one open PR at a time, in the order the feature plan sets:

- root `package.json` and `package-lock.json`
- `.github/workflows/ci.yml`
- `infra/package.json` and `infra/package-lock.json`
- `backend/uv.lock` and the root `requirements.txt`
