# Specter Arena

A Kiro Crew app, built in the open for Kiroween 2026. This repository is at its foundation stage (FP-00): toolchain, checks, CI, and docs. There is no gameplay yet.

## Prerequisites

- Node 26 and npm 11 (`.nvmrc` pins the Node major)
- Python 3.12 and uv 0.13 (`.python-version` pins 3.12, the version Crew bundles)

## Commands

Run these from the repository root on a fresh checkout:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run coverage
```

| Command | What it does |
|---|---|
| `npm run lint` | ESLint, then `ruff check` and `ruff format --check` over `backend/` |
| `npm run typecheck` | `tsc --noEmit` over `scripts/` and `ui/`, then mypy strict over `backend/` |
| `npm test` | Node's built-in test runner over `scripts/__tests__/`, Vitest over `ui/src/`, then pytest over `backend/` |
| `npm run coverage` | Tests with coverage; fails under 90% lines on `scripts/*.mjs`, `ui/src/` or `backend/specter_arena` |
| `npm run check:lock` | Checks that every native package family in the lock has a linux-x64 glibc build, and that `requirements.txt` matches `backend/uv.lock` |
| `npm run check:provenance` | Checks for Dragonboat-only identifiers, a tracked `.kiro/`, and no tracked env files |
| `npm run build` | Vite library build of the UI to `ui/dist/index.mjs`, with the host-provided modules left external |
| `npm run build:preview` | Builds the FIXTURE preview harness to `ui/preview-dist/` |
| `npm run test:e2e` | Builds the harness and runs the Playwright Chromium smoke test against it |
| `npm run check:fixtures` | Fails if `ui/dist/` carries fixture code or the backend runtime imports tests or fixtures |
| `npm run dev` | Serves the FIXTURE preview harness with Vite's dev server (no backend) |

Run `npm ci && npm run build` before installing this repo into Crew from a local path: a local-path install copies the folder without building it, and Crew loads `ui/dist/index.mjs`.

## Documentation

- `AGENTS.md`: guidance for coding agents
- `CONTRIBUTING.md`: lockfile rules and local checks
- `SECURITY.md`: secret handling
- `docs/development/adapters.md`: SOP provider keys and the CI check list
- `docs/architecture/component-index.md`: component ownership
- `docs/ops/preview.md`: the per-PR preview stack and how the owner deploys it
- `docs/provenance.md` and `DEPENDENCIES.md`: where things come from

## License

MIT. See `LICENSE`.
