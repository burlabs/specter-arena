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
| `npm run typecheck` | `tsc --noEmit` over `scripts/` and `ui/`; mypy strict with `--config-file backend/pyproject.toml` |
| `npm test` | `node --test` over `scripts/__tests__/`; Vitest over `ui/src/`; pytest over `backend/` |
| `npm run coverage` | Coverage, failing under 90% lines on `scripts/*.mjs`, `ui/src/` or `backend/specter_arena` |
| `npm run check:lock` | Every native package family in the lock has a linux-x64 glibc build; `requirements.txt` matches `backend/uv.lock` |
| `npm run check:provenance` | No Dragonboat-only identifiers, `.kiro/` tracked, no env files tracked |
| `npm run build` | Vite library build to `ui/dist/index.mjs`; host modules stay external |
| `npm run build:preview` | FIXTURE preview harness to `ui/preview-dist/` |
| `npm run test:e2e` | Playwright Chromium smoke against the built harness |
| `npm run check:fixtures` | No fixture code in `ui/dist/`; backend runtime imports no tests or fixtures |
| `npm run build:diagnostic` | Dev-only diagnostic bundle to `ui/diagnostic-dist/` (never shipped; carries `SPECTER-DIAGNOSTIC-ONLY`) |
| `npm run check:diagnostic` | Positive control: the diagnostic bundle still carries its marker, so the `check:fixtures` exclusion scan is meaningful |
| `npm run probe:check` | Offline validation of the committed capability matrix and recorded payloads; not a live probe |
| `npm run probe:stage` | Assembles the git-ignored `.probe-app/` (release app plus probe overlay; `-- --phase v0\|v1\|v2`) for the owner to install; prints the install command, never installs |
| `npm run dev` | Vite dev server for the FIXTURE preview harness |

## Rules

- **One open PR at a time for shared files.** Root `package.json` and `package-lock.json`, `.github/workflows/ci.yml`, `infra/package*.json`, `backend/uv.lock`, and `requirements.txt` are changed by one open PR at a time. A PR that changes a manifest regenerates its lock in the same PR.
- **Draft PRs only.** Agents open draft PRs. A human publishes, reviews, and merges.
- **No settings or cloud changes.** Agents never change repository settings and never call AWS. Preview infrastructure (`infra/`) is deployed by Eric; agents may run `npm ci`, `typecheck`, `synth` and `test` in `infra/`, never `bootstrap`, `deploy` or `destroy` (`docs/ops/preview.md`).
- **No secrets.** Nothing secret is committed. `.env` files are ignored; `.env.example` holds placeholders only.
- **Nothing copied from Dragonboat.** `burlabs/dragonboat-cms` is a read-only pattern reference. See `docs/provenance.md`.
- **No root `pyproject.toml`.** Crew refuses one on the desktop interpreter. Python project config lives in `backend/pyproject.toml`.
- **Backend imports are package-relative.** Crew runs `python -s -m uvicorn backend.app:app` from the repo root with only the `requirements.txt` deps installed; the repo is never pip-installed. `from .specter_arena.routes import health` works there; `import specter_arena` does not. `backend/tests/test_importable.py` and the `backend-smoke` CI job guard this.
- **Fixtures stay out of production.** Files under `ui/fixtures/` and `ui/preview/` carry `SPECTER-FIXTURE-ONLY` and are never imported from `ui/src/`. The UI bundle leaves the host modules listed in `ui/host-modules.ts` external. Files under `ui/src/diagnostic/` carry `SPECTER-DIAGNOSTIC-ONLY` and are never imported from the release entry; `app.json` never references them. Recorded real captures live in `tests/recorded/` and are never imported by release code.
- **Tests come with the code.** New handwritten code ships with tests at ≥90% line coverage on its declared scope.

## External tooling

The implementer agent, the quality-gate agents (`gate-requirements`, `gate-fit`), the planning SOPs, and the orchestration kit are development tools installed outside this repository. They are not vendored here.
