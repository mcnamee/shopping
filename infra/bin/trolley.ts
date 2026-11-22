#!/usr/bin/env node
import * as path from 'node:path';
import { App, Tags } from 'aws-cdk-lib';
import {
  APP_TAG,
  REGION,
  assertCertificateArn,
  assertEmail,
  assertModelId,
  assertServicePoint,
  setting,
} from '../lib/config';
import { GithubOidcStack } from '../lib/github-oidc-stack';
import { SCRAPER_FUNCTION_NAME, TrolleyStack } from '../lib/trolley-stack';

const app = new App();

// TROLLEY_ACCOUNT (from the AWS_ACCOUNT_ID GitHub variable) pins the target account so a
// misconfigured role can't deploy somewhere unexpected; otherwise use the CLI's account.
const env = {
  account: process.env.TROLLEY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
  region: REGION,
};

const alertEmail = setting(app, 'alertEmail', 'ALERT_EMAIL');
// deploy.yml passes -c requireAlertEmail=true so a production deploy never goes out
// without the budget alarm. Local/CI synth may omit it (then no budget is created).
if (!alertEmail && app.node.tryGetContext('requireAlertEmail') === 'true') {
  throw new Error(
    'ALERT_EMAIL is required for deploy: set the ALERT_EMAIL GitHub repository variable (docs/SETUP.md step 3).',
  );
}
const certificateArn = setting(app, 'certificateArn', 'CERTIFICATE_ARN');
const aldiServicePoint = setting(app, 'aldiServicePoint', 'ALDI_SERVICE_POINT');
// Suggestions model (D-061); default Amazon Nova Micro via the APAC inference profile.
const suggestModelId = setting(app, 'suggestModelId', 'SUGGEST_MODEL_ID');

new TrolleyStack(app, 'TrolleyStack', {
  env,
  description: 'Trolley shopping list app',
  webDistPath: path.resolve(__dirname, '..', '..', 'apps', 'web', 'dist'),
  domainName: setting(app, 'domainName', 'DOMAIN_NAME') ?? 'trolley.mcn.am',
  ...(alertEmail ? { alertEmail: assertEmail(alertEmail) } : {}),
  ...(certificateArn ? { certificateArn: assertCertificateArn(certificateArn) } : {}),
  ...(aldiServicePoint ? { aldiServicePoint: assertServicePoint(aldiServicePoint) } : {}),
  awsScrapeSchedule: setting(app, 'awsScrapeSchedule', 'AWS_SCRAPE_SCHEDULE') === 'true',
  ...(suggestModelId ? { suggestModelId: assertModelId(suggestModelId) } : {}),
});

const existingProviderArn = setting(app, 'existingOidcProviderArn', 'EXISTING_OIDC_PROVIDER_ARN');
const scrapeFallbackTableName = setting(
  app,
  'scrapeFallbackTableName',
  'SCRAPE_FALLBACK_TABLE_NAME',
);
new GithubOidcStack(app, 'TrolleyGithubOidcStack', {
  env,
  description: 'One-off: GitHub Actions OIDC deploy role for Trolley',
  repo: setting(app, 'githubRepo', 'GITHUB_REPO') ?? 'mcnamee/shopping',
  branch: setting(app, 'githubBranch', 'GITHUB_BRANCH') ?? 'main',
  ownerId: setting(app, 'githubOwnerId', 'GITHUB_OWNER_ID') ?? '1809236',
  repoId: setting(app, 'githubRepoId', 'GITHUB_REPO_ID') ?? '1467089057',
  scraperFunctionName: SCRAPER_FUNCTION_NAME,
  ...(existingProviderArn ? { existingProviderArn } : {}),
  ...(scrapeFallbackTableName ? { scrapeFallbackTableName } : {}),
});

Tags.of(app).add(APP_TAG.key, APP_TAG.value);
