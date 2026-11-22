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

/** ALDI store id like "G526", or "none" for no store (national range). */
export function assertServicePoint(value: string): string {
  if (!/^(?:[A-Z0-9-]{2,12}|none)$/.test(value)) {
    throw new Error('aldiServicePoint must look like "G526" or be "none"');
  }
  return value;
}

/**
 * Suggestions model (D-061): a Bedrock model or inference profile id such as
 * "apac.amazon.nova-micro-v1:0", or "none" for rules-only suggestions (no Bedrock access).
 */
export const DEFAULT_SUGGEST_MODEL_ID = 'apac.amazon.nova-micro-v1:0';

export function assertModelId(value: string): string {
  if (value !== 'none' && !/^(?:[a-z]{2,6}\.)?[a-z0-9-]+\.[a-z0-9.-]+(?::\d+)?$/.test(value)) {
    throw new Error(
      'suggestModelId must be a Bedrock model or inference profile id like "apac.amazon.nova-micro-v1:0", or "none"',
    );
  }
  return value;
}

/** Geographic cross-region inference profile prefixes (the id is then `<geo>.<model id>`). */
const PROFILE_PREFIXES = ['us', 'eu', 'apac', 'au', 'jp', 'ca', 'us-gov', 'global'];

/**
 * Split an id into its inference profile (if any) and the underlying foundation model id:
 * "apac.amazon.nova-micro-v1:0" -> profile "apac.amazon.nova-micro-v1:0", model
 * "amazon.nova-micro-v1:0"; "amazon.nova-micro-v1:0" -> no profile.
 */
export function parseModelId(id: string): { profileId: string | null; foundationModelId: string } {
  const dot = id.indexOf('.');
  const prefix = dot > 0 ? id.slice(0, dot) : '';
  if (PROFILE_PREFIXES.includes(prefix)) {
    return { profileId: id, foundationModelId: id.slice(dot + 1) };
  }
  return { profileId: null, foundationModelId: id };
}
