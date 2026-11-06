# Contributing

## Workflow

1. Every change starts from a GitHub issue. One issue maps to one PR.
2. Open the PR as a draft. Fill in `.github/pull_request_template.md`.
3. CI must show every job green. A PR with zero registered checks is not passing.
4. A maintainer publishes and squash-merges.

## Shared files: one open PR at a time

These files are changed by one open PR at a time:

- root `package.json` and `package-lock.json`
- `.github/workflows/ci.yml`
- `infra/package.json` and `infra/package-lock.json`
- `backend/uv.lock` and the root `requirements.txt`

If your PR changes a manifest, regenerate its lock in the same PR and run `npm run check:lock`.

## Lockfiles

Never edit a lockfile by hand.

```sh
npm install --package-lock-only
npm run check:lock
```

A lock generated on macOS can omit the Linux builds of native optional dependencies, and `npm ci` on a Linux runner then skips the binary without failing. If `npm run check:lock` names a package family, delete that family's platform entries from `package-lock.json`, run `npm install --package-lock-only --ignore-scripts` again, and confirm with:

```sh
npm ci --os=linux --cpu=x64 --libc=glibc
```

The Python lock (from the backend PR onward) is exported from `backend/uv.lock`:

```sh
uv lock --project backend
uv export --project backend --frozen --no-dev --no-emit-project -o requirements.txt
```

## Local checks

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run coverage
npm run check:lock
npm run check:provenance
```

To run the secret scan locally, install gitleaks at the version pinned in `.github/workflows/ci.yml` and run:

```sh
gitleaks git . --config .gitleaks.toml --redact
```

## Tests

New handwritten code ships with tests in the same PR, at ≥90% line coverage on its declared scope. A script that passes without testing anything does not count as a test.
