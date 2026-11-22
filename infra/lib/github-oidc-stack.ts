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
  /** Lambda the "scrape-now" workflow may invoke (D-036). */
  scraperFunctionName: string;
  /**
   * Opt-in (D-037): the Trolley table name. When set, also creates a separate role for the
   * "scrape-fallback" workflow that may only read the catalogue index and write
   * PRODUCT#/SCRAPE# items. Not created by default.
   */
  scrapeFallbackTableName?: string;
}

/**
 * One-off stack, deployed manually from CloudShell (see docs/SETUP.md).
 * Creates the GitHub OIDC identity provider and a role that GitHub Actions on the
 * given repo + branch can assume. The role can ONLY assume the CDK bootstrap roles
 * (deploy, file/image publishing, lookup) and invoke the scraper Lambda;
 * CloudFormation does the actual deploy using the bootstrap execution role.
 */
export class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    if (!/^[\w.-]+\/[\w.-]+$/.test(props.repo)) throw new Error('repo must be "owner/name"');
    if (!/^[\w./-]+$/.test(props.branch)) throw new Error('invalid branch');
    if (!/^[\w-]{1,64}$/.test(props.scraperFunctionName)) throw new Error('invalid function name');
    if (props.scrapeFallbackTableName && !/^[\w.-]{3,255}$/.test(props.scrapeFallbackTableName)) {
      throw new Error('invalid table name');
    }

    const providerArn =
      props.existingProviderArn ??
      new iam.CfnOIDCProvider(this, 'GithubOidcProvider', {
        url: `https://${GITHUB_OIDC_HOST}`,
        clientIdList: ['sts.amazonaws.com'],
      }).attrArn;

    const githubPrincipal = () =>
      new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          [`${GITHUB_OIDC_HOST}:aud`]: 'sts.amazonaws.com',
          [`${GITHUB_OIDC_HOST}:sub`]: `repo:${props.repo}:ref:refs/heads/${props.branch}`,
        },
      });

    const role = new iam.Role(this, 'GithubDeployRole', {
      roleName: 'trolley-github-deploy',
      description: `GitHub Actions deploy role for ${props.repo} (${props.branch} only)`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: githubPrincipal(),
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

    // "scrape-now" workflow: invoke this one function, nothing else (D-036).
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'InvokeScraper',
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:${Aws.PARTITION}:lambda:${Aws.REGION}:${Aws.ACCOUNT_ID}:function:${props.scraperFunctionName}`,
        ],
      }),
    );

    if (props.scrapeFallbackTableName) {
      const tableArn = `arn:${Aws.PARTITION}:dynamodb:${Aws.REGION}:${Aws.ACCOUNT_ID}:table/${props.scrapeFallbackTableName}`;
      const fallback = new iam.Role(this, 'GithubScrapeFallbackRole', {
        roleName: 'trolley-github-scrape-fallback',
        description: `GitHub Actions ALDI scrape fallback for ${props.repo} (${props.branch} only): catalogue items only`,
        maxSessionDuration: Duration.hours(1),
        assumedBy: githubPrincipal(),
      });
      fallback.addToPolicy(
        new iam.PolicyStatement({
          sid: 'ReadCatalogueIndex',
          actions: ['dynamodb:Query'],
          resources: [`${tableArn}/index/GSI1`],
        }),
      );
      fallback.addToPolicy(
        new iam.PolicyStatement({
          sid: 'WriteCatalogueItemsOnly',
          actions: ['dynamodb:BatchWriteItem', 'dynamodb:PutItem'],
          resources: [tableArn],
          conditions: {
            'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['PRODUCT#*', 'SCRAPE#*'] },
          },
        }),
      );
      new CfnOutput(this, 'ScrapeFallbackRoleArn', {
        value: fallback.roleArn,
        description: 'Set this as the AWS_SCRAPE_ROLE_ARN GitHub repository variable',
      });
    }

    new CfnOutput(this, 'DeployRoleArn', {
      value: role.roleArn,
      description: 'Set this as the AWS_DEPLOY_ROLE_ARN GitHub repository variable',
    });
  }
}
