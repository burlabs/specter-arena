/** The only AWS account the preview stack may deploy to. */
export const PREVIEW_ACCOUNT = '640822987719';

/** Region for the bucket and the CDK bootstrap resources. Change it here before the first bootstrap. */
export const PREVIEW_REGION = 'us-east-1';

/** The only AWS CLI profile the bootstrap and deploy scripts use. */
export const PREVIEW_PROFILE = 'specter-preview';

/** Keeps this app's bootstrap resources apart from any other CDK use in the account. */
export const CDK_QUALIFIER = 'specter';

export const RESOURCE_PREFIX = 'specter-arena-preview';

export const PROJECT_TAG = { key: 'project', value: 'specter-arena' } as const;

export const GITHUB_OIDC_URL = 'https://token.actions.githubusercontent.com';

/**
 * Repositories created after 2026-07-15 get immutable OIDC subjects carrying the owner
 * and repository IDs. Only jobs that run in the `preview` environment of this exact
 * repository can assume the deploy role.
 */
export const GITHUB_OIDC_SUBJECT = 'repo:burlabs@62413611/specter-arena@1446525806:environment:preview';

/** Every PR uploads under `pr-<number>/`; the deploy role is limited to these keys. */
export const PREVIEW_KEY_PREFIX = 'pr-';
