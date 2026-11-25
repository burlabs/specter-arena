import { Match, Template } from 'aws-cdk-lib/assertions';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPreviewApp, PREVIEW_STACK_NAME } from '../lib/preview-app.ts';
import {
  CDK_QUALIFIER,
  GITHUB_OIDC_SUBJECT,
  PREVIEW_ACCOUNT,
  PREVIEW_PROFILE,
  PREVIEW_REGION,
  TOOLKIT_STACK_NAME,
} from '../lib/preview-config.ts';
import type { PreviewStack } from '../lib/preview-stack.ts';

type Statement = { Action: string | string[]; Resource: unknown; Effect: string };

let stack: PreviewStack;
let template: Template;

beforeAll(() => {
  stack = createPreviewApp().stack;
  template = Template.fromStack(stack);
});

function deployRolePolicyStatements(): Statement[] {
  const policies = template.findResources('AWS::IAM::Policy');
  return Object.values(policies).flatMap(
    (policy) => (policy as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties.PolicyDocument.Statement,
  );
}

function containsWildcardResource(value: unknown): boolean {
  if (value === '*') return true;
  if (Array.isArray(value)) return value.some(containsWildcardResource);
  return false;
}

describe('account separation', () => {
  it('pins the stack to the preview account and region', () => {
    expect(stack.account).toBe(PREVIEW_ACCOUNT);
    expect(stack.region).toBe(PREVIEW_REGION);
    expect(stack.stackName).toBe(PREVIEW_STACK_NAME);
  });

  it('uses the specter bootstrap qualifier', () => {
    const synthesized = createPreviewApp().app.synth().getStackByName(PREVIEW_STACK_NAME);
    expect(synthesized.assumeRoleArn).toContain(`cdk-${CDK_QUALIFIER}-deploy-role-${PREVIEW_ACCOUNT}-${PREVIEW_REGION}`);
  });

  it('tags every taggable resource with project=specter-arena', () => {
    for (const type of ['AWS::S3::Bucket', 'AWS::IAM::Role', 'AWS::CloudFront::Distribution']) {
      template.hasResourceProperties(type, {
        Tags: Match.arrayWith([{ Key: 'project', Value: 'specter-arena' }]),
      });
    }
  });

  it('gates bootstrap, deploy and destroy on the account preflight and the preview profile', () => {
    const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    };
    for (const name of ['bootstrap', 'deploy', 'destroy']) {
      expect(scripts[name]).toMatch(/^node scripts\/assert-aws-account\.mjs && cdk /);
      expect(scripts[name]).toContain(['--profile', PREVIEW_PROFILE].join(' '));
    }
    expect(scripts.bootstrap).toContain(`--qualifier ${CDK_QUALIFIER}`);
    for (const name of ['bootstrap', 'deploy']) {
      expect(scripts[name]).toContain(`--toolkit-stack-name ${TOOLKIT_STACK_NAME}`);
    }
    expect(TOOLKIT_STACK_NAME).not.toBe('CDKToolkit');
  });
});

describe('bucket', () => {
  it('is the only bucket and blocks all public access', () => {
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: `specter-arena-preview-${PREVIEW_ACCOUNT}`,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
    });
  });

  it('grants read only to CloudFront through Origin Access Control', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: 's3:GetObject',
            Principal: { Service: 'cloudfront.amazonaws.com' },
          }),
        ]),
      },
    });
    const policy = Object.values(template.findResources('AWS::S3::BucketPolicy'))[0] as {
      Properties: { PolicyDocument: { Statement: { Effect: string; Principal?: unknown }[] } };
    };
    for (const statement of policy.Properties.PolicyDocument.Statement) {
      if (statement.Effect === 'Allow') expect(statement.Principal).not.toBe('*');
    }
  });
});

describe('distribution', () => {
  it('attaches the index rewrite as a viewer-request function and redirects to HTTPS', () => {
    template.resourceCountIs('AWS::CloudFront::Function', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
          FunctionAssociations: [
            { EventType: 'viewer-request', FunctionARN: { 'Fn::GetAtt': [Match.stringLikeRegexp('IndexRewrite'), 'FunctionARN'] } },
          ],
        }),
      },
    });
  });
});

describe('deploy role', () => {
  it('trusts only the preview environment of this repository through GitHub OIDC', () => {
    template.resourceCountIs('AWS::IAM::OIDCProvider', 1);
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRoleWithWebIdentity',
            Effect: 'Allow',
            Principal: { Federated: { Ref: Match.stringLikeRegexp('GitHubOidc') } },
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub': GITHUB_OIDC_SUBJECT,
              },
            },
          },
        ],
      },
    });
    expect(GITHUB_OIDC_SUBJECT).toBe('repo:burlabs@62413611/specter-arena@1446525806:environment:preview');
  });

  it('has no statement on a "*" resource', () => {
    const statements = deployRolePolicyStatements();
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) expect(containsWildcardResource(statement.Resource)).toBe(false);
  });

  it('can only list, upload and delete under the pr- prefix and invalidate this distribution', () => {
    const actions = deployRolePolicyStatements().flatMap((statement) => statement.Action);
    expect(actions.sort()).toEqual(['cloudfront:CreateInvalidation', 's3:DeleteObject', 's3:ListBucket', 's3:PutObject']);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 's3:ListBucket', Condition: { StringLike: { 's3:prefix': ['pr-*'] } } }),
          Match.objectLike({
            Action: ['s3:PutObject', 's3:DeleteObject'],
            Resource: { 'Fn::Join': ['', [{ 'Fn::GetAtt': [Match.stringLikeRegexp('Bucket'), 'Arn'] }, '/pr-*']] },
          }),
        ]),
      },
    });
  });

  it('exports the values the preview workflow needs', () => {
    for (const output of ['PreviewRoleArn', 'PreviewBucket', 'PreviewDistributionId', 'PreviewDomain']) {
      template.hasOutput(output, {});
    }
  });
});
