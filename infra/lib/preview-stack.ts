import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import {
  GITHUB_OIDC_SUBJECT,
  GITHUB_OIDC_URL,
  PREVIEW_KEY_PREFIX,
  PROJECT_TAG,
  RESOURCE_PREFIX,
} from './preview-config.ts';
import { REWRITE_FUNCTION_CODE } from './rewrite-function.ts';

/**
 * Per-PR preview hosting: a private bucket behind CloudFront with Origin Access Control,
 * and a GitHub OIDC role that only this repository's `preview` environment can assume.
 */
export class PreviewStack extends Stack {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;
  readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    Tags.of(this).add(PROJECT_TAG.key, PROJECT_TAG.value);

    this.bucket = new s3.Bucket(this, 'Bucket', {
      bucketName: `${RESOURCE_PREFIX}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // Previews are disposable; expiring them caps storage if a cleanup run is missed.
      lifecycleRules: [{ expiration: Duration.days(30) }],
      // `cdk destroy` refuses a non-empty bucket, so previews must be emptied first.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const rewrite = new cloudfront.Function(this, 'IndexRewrite', {
      functionName: `${RESOURCE_PREFIX}-index-rewrite`,
      code: cloudfront.FunctionCode.fromInline(REWRITE_FUNCTION_CODE),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `${RESOURCE_PREFIX} per-PR previews`,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [{ function: rewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
    });

    const github = new iam.OidcProviderNative(this, 'GitHubOidc', {
      url: GITHUB_OIDC_URL,
      clientIds: ['sts.amazonaws.com'],
    });

    this.deployRole = new iam.Role(this, 'DeployRole', {
      roleName: `${RESOURCE_PREFIX}-deploy`,
      description: 'Uploads per-PR previews from GitHub Actions',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(github.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': GITHUB_OIDC_SUBJECT,
        },
      }),
    });

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [this.bucket.bucketArn],
        conditions: { StringLike: { 's3:prefix': [`${PREVIEW_KEY_PREFIX}*`] } },
      }),
    );
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:DeleteObject'],
        resources: [this.bucket.arnForObjects(`${PREVIEW_KEY_PREFIX}*`)],
      }),
    );
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [this.distribution.distributionArn],
      }),
    );

    new CfnOutput(this, 'PreviewRoleArn', { value: this.deployRole.roleArn });
    new CfnOutput(this, 'PreviewBucket', { value: this.bucket.bucketName });
    new CfnOutput(this, 'PreviewDistributionId', { value: this.distribution.distributionId });
    new CfnOutput(this, 'PreviewDomain', { value: this.distribution.distributionDomainName });
  }
}
