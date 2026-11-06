# Dependencies

Direct dependencies and pinned tools, with licenses. Exact resolved versions are in the lockfiles.

## Root npm project (development only)

| Package | Version | License | Used for |
|---|---|---|---|
| `typescript` | 7.0.2 | Apache-2.0 | `npm run typecheck` |
| `@types/node` | 26.6.6 | MIT | Node types for `checkJs` |
| `eslint` | 10.14.0 | MIT | `npm run lint` |
| `@eslint/js` | 10.0.1 | MIT | ESLint recommended rules |

The UI stub PR adds Vite, Vitest, React Testing Library, React, and Playwright, each with its license recorded here.

## Backend runtime (`requirements.txt`, provisioned by Crew)

| Package | Version | License | Used for |
|---|---|---|---|
| `starlette` | 1.10.0 | BSD-3-Clause | ASGI app and routing |
| `uvicorn` | 0.54.0 | BSD-3-Clause | ASGI server Crew starts |
| `anyio` | 4.16.0 | MIT | Starlette dependency |
| `click` | 8.5.0 | BSD-3-Clause | uvicorn dependency |
| `h11` | 0.16.0 | MIT | uvicorn dependency |
| `idna` | 3.20 | BSD-3-Clause | anyio dependency |
| `typing_extensions` | 4.16.0 | PSF-2.0 | Starlette dependency |

## Backend development (`backend/pyproject.toml` dev group, never shipped)

| Package | Version | License | Used for |
|---|---|---|---|
| `pytest` | 9.2.0 | MIT | Backend tests |
| `pytest-cov` | 7.1.0 | MIT | Backend coverage |
| `ruff` | 0.17.4 | MIT | Lint and format check |
| `mypy` | 2.4.1 | MIT | Strict type check |
| `httpx2` | 2.16.0 | BSD-3-Clause | Transport for `starlette.testclient` |

## Preview infrastructure (`infra/`, separate npm project, never shipped)

| Package | Version | License | Used for |
|---|---|---|---|
| `aws-cdk-lib` | 2.275.0 | Apache-2.0 | Preview stack constructs |
| `constructs` | 10.8.1 | Apache-2.0 | CDK construct base |
| `aws-cdk` | 2.1148.0 | Apache-2.0 | `cdk synth`, `bootstrap`, `deploy` |
| `typescript` | 7.0.2 | Apache-2.0 | `npm run typecheck` in `infra/` |
| `@types/node` | 26.6.6 | MIT | Node types |
| `vitest` | 5.1.0 | MIT | Template assertion tests |
| `@vitest/coverage-v8` | 5.1.0 | MIT | Coverage on `infra/lib` and `infra/scripts` |

## Pinned CI tools

| Tool | Version | License | Integrity |
|---|---|---|---|
| gitleaks CLI | 8.30.1 | MIT | `gitleaks_8.30.1_linux_x64.tar.gz` SHA-256 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`, from the release's checksums file |
| `actions/checkout` | v7.0.1 (`3d3c42e5aac5ba805825da76410c181273ba90b1`) | MIT | pinned by commit SHA |
| `actions/setup-node` | v7.1.0 (`949feb2413d6458794dcd2491c4babbbce0c15c1`) | MIT | pinned by commit SHA |
| `actions/setup-python` | v7.1.0 (`6d4fd22b20465ccc0f7354476588e8df7c9ca0e0`) | MIT | pinned by commit SHA |
| `aws-actions/configure-aws-credentials` | v6.3.0 (`e1253824e5c10ff9df46874f81ed3ec929e19cfd`) | MIT | pinned by commit SHA; preview workflows only |
| `astral-sh/setup-uv` | v10.3.3 (`68559e99cc807c1eb7e9238fd43a15bba460eec2`), installing uv 0.13.7 | MIT OR Apache-2.0 | pinned by commit SHA |
