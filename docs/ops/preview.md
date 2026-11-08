# Preview infrastructure

Per-PR previews are static uploads of the FIXTURE preview harness to `s3://specter-arena-preview-640822987719/pr-<number>/`, served through CloudFront. The stack lives in `infra/` (one CDK stack, `SpecterArenaPreview`). The repository owner deploys it; agents never run `bootstrap`, `deploy` or `destroy`, and CI only synthesizes it offline.

## What the stack creates

| Resource | Name | Notes |
|---|---|---|
| S3 bucket | `specter-arena-preview-640822987719` | All public access blocked, SSE-S3, TLS only, objects expire after 30 days |
| CloudFront distribution | comment `specter-arena-preview per-PR previews` | Origin Access Control to the bucket, HTTPS redirect, price class 100 |
| CloudFront Function | `specter-arena-preview-index-rewrite` | Serves `/pr-<n>/index.html` for `/pr-<n>` and `/pr-<n>/` |
| IAM OIDC provider | `token.actions.githubusercontent.com` | Audience `sts.amazonaws.com` |
| IAM role | `specter-arena-preview-deploy` | Trusted only for `repo:burlabs@62413611/specter-arena@1446525806:environment:preview`; may list, put and delete `pr-*` keys and invalidate this one distribution |

Everything is tagged `project=specter-arena`. The stack pins account `640822987719` and region `us-east-1` (`infra/lib/preview-config.ts`), and it bootstraps into its own toolkit stack, `CDKToolkit-specter`, with qualifier `specter`, so it never touches the account's default `CDKToolkit` stack or other CDK use in the account.

An AWS account can hold only one IAM OIDC provider per URL. If `640822987719` already has a provider for `token.actions.githubusercontent.com`, the deploy fails on that resource; stop and decide whether to import the existing provider instead.

## Deploy (owner only)

1. Create an AWS CLI profile named `specter-preview` for account `640822987719`. Prefer IAM Identity Center (`aws configure sso`) over long-lived keys. Nothing in the repository uses any other profile, and `npm run check:provenance` fails if one appears.
2. To use a different region, change `PREVIEW_REGION` in `infra/lib/preview-config.ts` before the first bootstrap.
3. Check the expected cost with the AWS Price List API (CloudFront requests and data transfer, CloudFront Functions invocations, S3 storage).
4. From `infra/`:

   ```sh
   npm ci
   npm run bootstrap
   npm run deploy
   ```

   Both scripts pass `--toolkit-stack-name CDKToolkit-specter` and first run `scripts/assert-aws-account.mjs`, which calls `aws sts get-caller-identity` with the `specter-preview` profile and refuses to continue unless the account is `640822987719`.
5. Copy the stack outputs into variables on the repository's `preview` environment (Settings → Environments → preview):

   | Variable | Stack output |
   |---|---|
   | `PREVIEW_ROLE_ARN` | `PreviewRoleArn` |
   | `PREVIEW_BUCKET` | `PreviewBucket` |
   | `PREVIEW_DISTRIBUTION_ID` | `PreviewDistributionId` |
   | `PREVIEW_DOMAIN` | `PreviewDomain` |
   | `PREVIEW_REGION` | the value of `PREVIEW_REGION` |

Until all five variables are set, `.github/workflows/preview.yml` prints `preview infrastructure not configured` and posts no URL. A user-visible PR opened before then needs a documented, human-approved exception instead of a preview link.

## How previews run

- `preview.yml` runs on same-repository PRs only. It builds the harness with `npm run build:preview` (added by the UI stub PR), uploads `ui/preview-dist/` to `pr-<n>/`, invalidates `/pr-<n>/*`, and edits or creates one PR comment with the URL.
- `preview-cleanup.yml` deletes `pr-<n>/` and invalidates it when the PR closes.
- Both jobs run in the `preview` GitHub environment, which is what the role's trust condition names. GitHub creates that environment the first time a job references it.

## Tear down

Empty the bucket first (`cdk destroy` refuses a non-empty bucket), then from `infra/` run `npm run destroy`. `cdk destroy` does not touch the bootstrap stack `CDKToolkit-specter`; delete it in CloudFormation if nothing else uses the `specter` qualifier.
