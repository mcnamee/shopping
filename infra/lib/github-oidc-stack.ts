import { Aws, CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';

export interface GithubOidcStackProps extends StackProps {
  /** owner/name, e.g. "mcnamee/shopping". */
  repo: string;
  /** Branch allowed to deploy, e.g. "main". */
  branch: string;
  /** Re-use an existing GitHub OIDC provider in the account instead of creating one. */
  existingProviderArn?: string;
}

/**
 * One-off stack, deployed manually from CloudShell (see docs/SETUP.md).
 * Creates the GitHub OIDC identity provider and a role that GitHub Actions on the
 * given repo + branch can assume. The role can ONLY assume the CDK bootstrap roles
 * (deploy, file/image publishing, lookup); CloudFormation does the actual deploy
 * using the bootstrap execution role.
 */
export class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    if (!/^[\w.-]+\/[\w.-]+$/.test(props.repo)) throw new Error('repo must be "owner/name"');
    if (!/^[\w./-]+$/.test(props.branch)) throw new Error('invalid branch');

    const providerArn =
      props.existingProviderArn ??
      new iam.CfnOIDCProvider(this, 'GithubOidcProvider', {
        url: `https://${GITHUB_OIDC_HOST}`,
        clientIdList: ['sts.amazonaws.com'],
      }).attrArn;

    const role = new iam.Role(this, 'GithubDeployRole', {
      roleName: 'trolley-github-deploy',
      description: `GitHub Actions deploy role for ${props.repo} (${props.branch} only)`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          [`${GITHUB_OIDC_HOST}:aud`]: 'sts.amazonaws.com',
          [`${GITHUB_OIDC_HOST}:sub`]: `repo:${props.repo}:ref:refs/heads/${props.branch}`,
        },
      }),
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole', 'sts:TagSession'],
        resources: [
          `arn:${Aws.PARTITION}:iam::${Aws.ACCOUNT_ID}:role/cdk-hnb659fds-*-role-${Aws.ACCOUNT_ID}-*`,
        ],
      }),
    );

    new CfnOutput(this, 'DeployRoleArn', {
      value: role.roleArn,
      description: 'Set this as the AWS_DEPLOY_ROLE_ARN GitHub repository variable',
    });
  }
}
