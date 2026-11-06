# Dependencies

Direct dependencies and pinned tools, with licenses. Exact resolved versions are in the lockfiles.

## Root npm project (development only)

| Package | Version | License | Used for |
|---|---|---|---|
| `typescript` | 7.0.2 | Apache-2.0 | `npm run typecheck` |
| `@types/node` | 26.6.6 | MIT | Node types for `checkJs` |
| `eslint` | 10.14.0 | MIT | `npm run lint` |
| `@eslint/js` | 10.0.1 | MIT | ESLint recommended rules |

Later FP-00 PRs add Vite, Vitest, React Testing Library, React, and Playwright (UI stub PR), and Starlette, uvicorn, pytest, ruff, and mypy (backend PR), each with its license recorded here.

## Pinned CI tools

| Tool | Version | License | Integrity |
|---|---|---|---|
| gitleaks CLI | 8.30.1 | MIT | `gitleaks_8.30.1_linux_x64.tar.gz` SHA-256 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`, from the release's checksums file |
| `actions/checkout` | v7.0.1 (`3d3c42e5aac5ba805825da76410c181273ba90b1`) | MIT | pinned by commit SHA |
| `actions/setup-node` | v7.1.0 (`949feb2413d6458794dcd2491c4babbbce0c15c1`) | MIT | pinned by commit SHA |
