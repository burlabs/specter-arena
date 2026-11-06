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
| `npm run typecheck` | `tsc --noEmit` with `checkJs` over `scripts/`, then mypy strict over `backend/` |
| `npm test` | Node's built-in test runner over `scripts/__tests__/`, then pytest over `backend/` |
| `npm run coverage` | Tests with coverage; fails under 90% lines on `scripts/*.mjs` or on `backend/specter_arena` |
| `npm run check:lock` | Checks that every native package family in the lock has a linux-x64 glibc build, and that `requirements.txt` matches `backend/uv.lock` |
| `npm run check:provenance` | Checks for Dragonboat-only identifiers, a tracked `.kiro/`, and no tracked env files |
| `npm run dev` | Local dev loop; prints a notice until the UI preview harness exists |

### Planned commands

These arrive with later FP-00 PRs and are not runnable yet:

- `npm run build` (UI stub PR): Vite library build to `ui/dist/index.mjs`. Run `npm ci && npm run build` before installing this repo into Crew from a local path, because a local-path install copies the folder without building it.
- `npm run build:preview`, `npm run test:e2e`, `npm run check:fixtures` (UI stub PR).

## Documentation

- `AGENTS.md`: guidance for coding agents
- `CONTRIBUTING.md`: lockfile rules and local checks
- `SECURITY.md`: secret handling
- `docs/development/adapters.md`: SOP provider keys and the CI check list
- `docs/architecture/component-index.md`: component ownership
- `docs/provenance.md` and `DEPENDENCIES.md`: where things come from

## License

MIT. See `LICENSE`.
