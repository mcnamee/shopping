import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { GithubOidcStack } from '../lib/github-oidc-stack';

type Statement = Record<string, unknown>;
type PolicyResource = {
  Properties: { PolicyDocument: { Statement: Statement[] }; Roles: Array<{ Ref: string }> };
};

function synth(existingProviderArn?: string, scrapeFallbackTableName?: string) {
  const app = new App();
  const stack = new GithubOidcStack(app, 'TrolleyGithubOidcStack', {
    env: { account: '123456789012', region: 'ap-southeast-2' },
    repo: 'mcnamee/shopping',
    branch: 'main',
    ownerId: '1809236',
    repoId: '1467089057',
    scraperFunctionName: 'trolley-scraper',
    ...(existingProviderArn ? { existingProviderArn } : {}),
    ...(scrapeFallbackTableName ? { scrapeFallbackTableName } : {}),
  });
  return Template.fromStack(stack);
}

describe('GithubOidcStack', () => {
  const template = synth();

  it('creates the GitHub OIDC provider', () => {
    template.hasResourceProperties('AWS::IAM::OIDCProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIdList: ['sts.amazonaws.com'],
    });
  });

  it('trusts only mcnamee/shopping on refs/heads/main', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRoleWithWebIdentity',
            Effect: 'Allow',
            Principal: { Federated: Match.anyValue() },
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub': [
                  'repo:mcnamee@1809236/shopping@1467089057:ref:refs/heads/main',
                  'repo:mcnamee/shopping:ref:refs/heads/main',
                ],
              },
            },
          },
        ],
      },
    });
  });

  it('can only assume the CDK bootstrap roles and invoke the scraper function', () => {
    const policies = Object.values(template.findResources('AWS::IAM::Policy')) as PolicyResource[];
    expect(policies).toHaveLength(1);
    const statements = policies[0]!.Properties.PolicyDocument.Statement;
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatchObject({
      Effect: 'Allow',
      Action: ['sts:AssumeRole', 'sts:TagSession'],
    });
    expect(JSON.stringify(statements[0]!.Resource)).toContain(':role/cdk-hnb659fds-*-role-');
    expect(statements[1]).toMatchObject({ Effect: 'Allow', Action: 'lambda:InvokeFunction' });
    const invokeResource = JSON.stringify(statements[1]!.Resource);
    expect(invokeResource).toContain(':function:trolley-scraper');
    expect(invokeResource).not.toContain('*');
    template.hasResourceProperties('AWS::IAM::Role', { ManagedPolicyArns: Match.absent() });
  });

  it('does not create the scrape fallback role by default', () => {
    template.resourceCountIs('AWS::IAM::Role', 1);
  });

  it('optionally creates a fallback role limited to catalogue items', () => {
    const t = synth(undefined, 'TrolleyStack-Table123');
    t.resourceCountIs('AWS::IAM::Role', 2);
    t.hasOutput('ScrapeFallbackRoleArn', {});
    t.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'trolley-github-scrape-fallback',
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Condition: {
              StringEquals: Match.objectLike({
                'token.actions.githubusercontent.com:sub': [
                  'repo:mcnamee@1809236/shopping@1467089057:ref:refs/heads/main',
                  'repo:mcnamee/shopping:ref:refs/heads/main',
                ],
              }),
            },
          }),
        ],
      },
    });
    const policies = Object.values(t.findResources('AWS::IAM::Policy')) as PolicyResource[];
    const fallback = policies.find((p) => JSON.stringify(p.Properties.Roles).includes('Fallback'))!;
    const statements = fallback.Properties.PolicyDocument.Statement;
    expect(statements).toEqual([
      expect.objectContaining({ Action: 'dynamodb:Query', Resource: expect.anything() }),
      expect.objectContaining({
        Action: 'dynamodb:Query',
        Condition: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['SCRAPE#*'] } },
      }),
      expect.objectContaining({
        Action: ['dynamodb:BatchWriteItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem'],
        Condition: {
          'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['PRODUCT#*', 'SCRAPE#*'] },
        },
      }),
    ]);
    expect(JSON.stringify(statements[0]!.Resource)).toContain(
      'table/TrolleyStack-Table123/index/GSI1',
    );
  });

  it('outputs the deploy role ARN', () => {
    template.hasOutput('DeployRoleArn', {});
  });

  it('can reuse an existing provider', () => {
    const t = synth('arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com');
    t.resourceCountIs('AWS::IAM::OIDCProvider', 0);
  });
});
