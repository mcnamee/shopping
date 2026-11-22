import type { App } from 'aws-cdk-lib';

export const REGION = 'ap-southeast-2';
export const APP_TAG = { key: 'app', value: 'trolley' } as const;

/**
 * Read a setting from CDK context (-c key=value) first, then an environment variable.
 * Empty strings (e.g. an unset GitHub variable) are treated as "not provided".
 */
export function setting(app: App, contextKey: string, envKey: string): string | undefined {
  const fromContext: unknown = app.node.tryGetContext(contextKey);
  const value = typeof fromContext === 'string' ? fromContext : process.env[envKey];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertEmail(value: string): string {
  if (!EMAIL.test(value)) throw new Error(`alertEmail is not a valid email address`);
  return value;
}

const ACM_ARN = /^arn:aws:acm:us-east-1:\d{12}:certificate\/[\w-]+$/;

export function assertCertificateArn(value: string): string {
  if (!ACM_ARN.test(value)) {
    throw new Error(
      'certificateArn must be an ACM certificate ARN in us-east-1 (CloudFront requirement)',
    );
  }
  return value;
}
