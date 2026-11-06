# Security

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's "Report a vulnerability" form on this repository's Security tab. Do not open a public issue.

## Secret handling

This repository is public from its first commit.

- Never commit credentials, tokens, keys, or account-specific secrets.
- `.env` and `.env.*` are git-ignored. `.env.example` holds placeholder keys only.
- CI runs gitleaks over the full history on every PR (`secret-scan` job). The gitleaks binary is pinned and checksum-verified, so a changed download fails the job.
- `npm run check:provenance` fails if any env file other than `.env.example` is tracked.
- GitHub secret scanning and push protection are enabled by the repository owner (`docs/ops/branch-protection.md`).
- CI holds no long-lived cloud keys. The preview workflow assumes a role through GitHub OIDC, limited to same-repository PRs and the `preview` environment.

If a secret is committed, rotate it first, then remove it from history. Removing it from the tree alone is not enough.
