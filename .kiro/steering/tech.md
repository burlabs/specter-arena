---
inclusion: always
---

# Tech

| Area | Choice |
|---|---|
| Host | Kiro Crew v0.11.2 desktop |
| Node | 26 LTS (`.nvmrc`), npm 11, `package-lock.json`, `npm ci` in CI |
| UI | React + TypeScript, Vite library build to `ui/dist/index.mjs` (built on demand, git-ignored) |
| UI tests | Vitest + v8 coverage, React Testing Library, Playwright Chromium smoke |
| Backend | Python 3.12 (Crew's bundled interpreter), Starlette + uvicorn, `backend.type: "asgi"` |
| Python tooling | uv 0.13 with `backend/uv.lock`, exported to a hashed root `requirements.txt`; pytest + pytest-cov, ruff, mypy strict |
| Repository scripts | Plain `.mjs` checked by `tsc --checkJs`, tested with `node --test` |
| Previews | S3 + CloudFront per PR via GitHub OIDC; one-stack AWS CDK app in `infra/` |
| Secret scan | Pinned, checksum-verified gitleaks CLI with `.gitleaks.toml` |

Constraints from the host:

- A root `package.json` makes a registry install run `npm install` and `npm run build` on the user's machine, so root dependencies stay small and CDK lives in the separate `infra/` project.
- Crew provisions backend dependencies from the root `requirements.txt` with `pip install --target` and starts `python -s -m uvicorn backend.app:app` with the repo root as the working directory. Backend code uses package-relative imports and never relies on the repo being installed.
- The UI bundle leaves the host-provided modules external; Crew supplies them through an import map.
