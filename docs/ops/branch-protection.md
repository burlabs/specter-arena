# Branch protection and secret scanning

These are repository settings. The repository owner applies them; agents never run these commands.

## Step 1: before the first merge

Require a PR (no approval count), linear history, and no force-push or deletion of `main`. Admins may bypass.

```sh
gh api -X PUT repos/burlabs/specter-arena/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

Confirm with `gh api repos/burlabs/specter-arena/branches/main/protection`. Applied 2026-11-05.

## Step 2: after the UI stub PR merges

Only after all 13 CI jobs have run at least once, make them required and require branches to be up to date. Running this earlier can block merges on a check that never registers, and a PR with zero registered checks must never count as passing.

```sh
gh api -X PATCH repos/burlabs/specter-arena/branches/main/protection/required_status_checks \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "strict": true,
  "contexts": [
    "lint", "typecheck", "test", "coverage", "secret-scan", "provenance", "lockfile-linux",
    "lock-agreement", "backend-smoke", "cdk-synth", "build", "fixtures", "e2e-smoke"
  ]
}
JSON
```

The list must match `ci.checks` in `docs/development/adapters.md`.

## Secret scanning and push protection

```sh
gh api -X PATCH repos/burlabs/specter-arena \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
JSON
```

Confirm with `gh api repos/burlabs/specter-arena -q .security_and_analysis`.
