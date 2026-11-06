# AGENTS.md

Guidance for coding agents working in `burlabs/specter-arena`.

## Project

Specter Arena is a Kiro Crew app (slug `specter-arena`). It will have a React UI mounted by the Crew dashboard and a Starlette backend that Crew starts on its bundled Python 3.12. The repository is being built in planned feature sessions (FP-00 onward). FP-00 lays the foundation only: toolchain, checks, CI, docs, a backend liveness probe, a UI stub, and a preview path. No gameplay or data model exists yet.

## Read first

- `docs/development/adapters.md`: concrete values for the SOP provider keys (spec source, tracker, VCS, build command, CI checks, coverage).
- `docs/architecture/component-index.md`: the five logical components and who owns what.
- `spec/index.md` and `.kiro/specs/`: the spec source.
- `CONTRIBUTING.md`: lockfile rules and the local check commands.

## Commands

| Command | What it does |
|---|---|
| `npm ci` | Install the locked root dependencies |
| `npm run lint` | ESLint, ruff check, ruff format check |
| `npm run typecheck` | `tsc --noEmit` with `checkJs` over `scripts/`; mypy strict with `--config-file backend/pyproject.toml` |
| `npm test` | Node's built-in test runner over `scripts/__tests__/`; pytest over `backend/` |
| `npm run coverage` | Coverage, failing under 90% lines on `scripts/*.mjs` or `backend/specter_arena` |
| `npm run check:lock` | Every native package family in the lock has a linux-x64 glibc build; `requirements.txt` matches `backend/uv.lock` |
| `npm run check:provenance` | No Dragonboat-only identifiers, `.kiro/` tracked, no env files tracked |
| `npm run dev` | Local dev loop; prints a notice until the UI preview harness exists |

## Rules

- **One open PR at a time for shared files.** Root `package.json` and `package-lock.json`, `.github/workflows/ci.yml`, `infra/package*.json`, `backend/uv.lock`, and `requirements.txt` are changed by one open PR at a time. A PR that changes a manifest regenerates its lock in the same PR.
- **Draft PRs only.** Agents open draft PRs. A human publishes, reviews, and merges.
- **No settings or cloud changes.** Agents never change repository settings and never call AWS. Preview infrastructure is deployed by Eric.
- **No secrets.** Nothing secret is committed. `.env` files are ignored; `.env.example` holds placeholders only.
- **Nothing copied from Dragonboat.** `burlabs/dragonboat-cms` is a read-only pattern reference. See `docs/provenance.md`.
- **No root `pyproject.toml`.** Crew refuses one on the desktop interpreter. Python project config lives in `backend/pyproject.toml`.
- **Backend imports are package-relative.** Crew runs `python -s -m uvicorn backend.app:app` from the repo root with only the `requirements.txt` deps installed; the repo is never pip-installed. `from .specter_arena.routes import health` works there; `import specter_arena` does not. `backend/tests/test_importable.py` and the `backend-smoke` CI job guard this.
- **Tests come with the code.** New handwritten code ships with tests at ≥90% line coverage on its declared scope.

## External tooling

The implementer agent, the quality-gate agents (`gate-requirements`, `gate-fit`), the planning SOPs, and the orchestration kit are development tools installed outside this repository. They are not vendored here.
