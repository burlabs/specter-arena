---
inclusion: always
---

# Structure

| Path | Contents | Arrives with |
|---|---|---|
| `scripts/` | Repository check scripts (`check-lock`, `check-fixtures`, `check-provenance`, `dev`) and their tests in `scripts/__tests__/` | PR-1 Foundation |
| `.github/` | CI workflow, PR template | PR-1 Foundation |
| `docs/` | Architecture, development, operations, and provenance docs | PR-1 Foundation |
| `spec/`, `.kiro/specs/` | Spec source entry points | PR-1 Foundation |
| `backend/` | `app.py` (Starlette app), `specter_arena/` runtime package, `pyproject.toml`, `uv.lock`, tests | PR-2 Backend |
| `app.json` | Crew manifest | PR-2 Backend (backend section), PR-4 UI stub (ui section) |
| `requirements.txt` | Hashed export of `backend/uv.lock`; the file Crew provisions | PR-2 Backend |
| `infra/` | Preview CDK app with its own `package.json` and lock | PR-3 Preview infrastructure |
| `ui/` | Mount entry, stub shell, Vite config, fixtures, preview harness | PR-4 UI stub |
| `tests/e2e/` | Playwright smoke test | PR-4 UI stub |

Build output that is never committed: `ui/dist/`, `ui/preview-dist/`, `infra/cdk.out/`, `.deps/`, `coverage/`.
