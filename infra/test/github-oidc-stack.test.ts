import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { GithubOidcStack } from '../lib/github-oidc-stack';

function synth(existingProviderArn?: string) {
  const app = new App();
  const stack = new GithubOidcStack(app, 'TrolleyGithubOidcStack', {
    env: { account: '123456789012', region: 'ap-southeast-2' },
    repo: 'mcnamee/shopping',
    branch: 'main',
    ...(existingProviderArn ? { existingProviderArn } : {}),
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
                'token.actions.githubusercontent.com:sub':
                  'repo:mcnamee/shopping:ref:refs/heads/main',
              },
            },
          },
        ],
      },
    });
  });

  it('can only assume the CDK bootstrap roles', () => {
    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    expect(policies).toHaveLength(1);
    const statements = (
      policies[0] as {
        Properties: { PolicyDocument: { Statement: Array<Record<string, unknown>> } };
      }
    ).Properties.PolicyDocument.Statement;
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({
      Effect: 'Allow',
      Action: ['sts:AssumeRole', 'sts:TagSession'],
    });
    const resource = JSON.stringify(statements[0]!.Resource);
    expect(resource).toContain(':role/cdk-hnb659fds-*-role-');
    template.hasResourceProperties('AWS::IAM::Role', { ManagedPolicyArns: Match.absent() });
  });

  it('outputs the deploy role ARN', () => {
    template.hasOutput('DeployRoleArn', {});
  });

  it('can reuse an existing provider', () => {
    const t = synth('arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com');
    t.resourceCountIs('AWS::IAM::OIDCProvider', 0);
  });
});
