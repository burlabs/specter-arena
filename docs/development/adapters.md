# Adapter mapping

The planner and implementer SOPs refer to provider keys instead of concrete tools. No global `ADAPTERS.md` is installed, so this file is the mapping for this repository. Implementer sessions read it during Orient.

| Key | Value for specter-arena |
|---|---|
| `docs.specSource` | `spec/index.md` plus `.kiro/specs/`. Greenfield until FP-01 adds the first specs; until then read the docs and code directly. |
| `docs.provider` | None. Design and planning artifacts are kept local to each planning session. |
| `tracker.provider` | GitHub issues on `burlabs/specter-arena`. One draft PR per issue. |
| `vcs.provider` | GitHub (`burlabs/specter-arena`) through the `gh` CLI. Draft PRs only; a human publishes and merges. |
| `build.command` | `npm ci && npm run lint && npm run typecheck && npm test`. The UI stub PR adds the `build` script and appends it to this command. |
| `ci.checks` | The GitHub Actions jobs in `.github/workflows/ci.yml`, listed below. |
| `ci.checks.coverage` | `npm run coverage`. Fails under 90% line coverage on each declared scope. |

## ci.checks

The final set has 13 jobs. Each PR in the FP-00 sequence adds the jobs it can make pass on its own code.

| Job | Added by | Checks |
|---|---|---|
| `lint` | PR-1 Foundation | ESLint; ruff check and format check (PR-2) |
| `typecheck` | PR-1 Foundation | `tsc --noEmit` with `checkJs` over `scripts/`; mypy strict (PR-2) |
| `test` | PR-1 Foundation | `node --test scripts/__tests__/`; pytest over `backend/` (PR-2); Vitest joins with the UI stub |
| `coverage` | PR-1 Foundation | Node built-in coverage, ≥90% lines on `scripts/*.mjs`; pytest-cov ≥90% on `backend/specter_arena` (PR-2) |
| `secret-scan` | PR-1 Foundation | Pinned, checksum-verified gitleaks over full history |
| `provenance` | PR-1 Foundation | `npm run check:provenance`: no Dragonboat-only identifiers, `.kiro/` tracked, no env files |
| `lockfile-linux` | PR-1 Foundation | `npm ci` on `ubuntu-latest` plus `npm run check:lock` (which also checks `requirements.txt` from PR-2) |
| `lock-agreement` | PR-2 Backend | `uv lock --check`, and the `uv export` output matches the committed `requirements.txt` |
| `backend-smoke` | PR-2 Backend | Crew-style deps-only start of `backend.app:app`; `GET /health` returns 200 |
| `cdk-synth` | PR-3 Preview infrastructure | In `infra/`: `npm ci`, `typecheck`, offline `synth`, and Vitest template assertions, with no AWS credentials |
| `build` | PR-4 UI stub | The Vite library build writes `ui/dist/index.mjs` |
| `fixtures` | PR-4 UI stub | No fixture marker or host-module assignment in `ui/dist/` |
| `e2e-smoke` | PR-4 UI stub | Playwright Chromium smoke against the built preview harness |

A PR with zero registered checks is not passing. The required-check list in `docs/ops/branch-protection.md` is applied only after all 13 jobs have run at least once.

## Ephemeral dev environment

`deploy.devEnv` is the per-PR preview: S3 and CloudFront in AWS account `640822987719`, uploaded by `.github/workflows/preview.yml`, which posts the URL on the PR. It goes live once the owner deploys the `infra/` stack and sets the `preview` environment variables (`docs/ops/preview.md`). Until then the workflow prints `preview infrastructure not configured`, and a user-visible PR carries a documented human-approved exception instead of a URL.

## External tooling

These are used to build the repository but are not part of it:

- The `fullstack-implementer` agent and its SOPs.
- The quality-gate agents `gate-requirements` and `gate-fit`, installed under `~/.kiro/agents/`.
- The feature-planning SOP and the multi-agent orchestration kit.
