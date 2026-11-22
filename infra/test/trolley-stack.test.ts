import * as path from 'node:path';
import { App } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { TrolleyStack, type TrolleyStackProps } from '../lib/trolley-stack';

const FIXTURE_DIST = path.join(__dirname, 'fixtures', 'web-dist');
const ENV = { account: '123456789012', region: 'ap-southeast-2' };

function synth(overrides: Partial<TrolleyStackProps> = {}) {
  // Skip esbuild bundling in unit tests (bundling is exercised by `npm run synth`).
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new TrolleyStack(app, 'TrolleyStack', {
    env: ENV,
    webDistPath: FIXTURE_DIST,
    domainName: 'trolley.example.com',
    ...overrides,
  });
  return { stack, template: Template.fromStack(stack) };
}

type Resource = { Type: string; Properties: Record<string, unknown> };
type Statement = Record<string, unknown>;

function roleIdOf(template: Template, pattern: RegExp): string {
  const id = Object.keys(template.findResources('AWS::IAM::Role')).find((k) => pattern.test(k));
  if (!id) throw new Error(`role ${String(pattern)} not found`);
  return id;
}

function statementsFor(template: Template, roleId: string): Statement[] {
  return Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((p) =>
      ((p as Resource).Properties.Roles as Array<{ Ref: string }>).some((r) => r.Ref === roleId),
    )
    .flatMap(
      (p) => ((p as Resource).Properties.PolicyDocument as { Statement: Statement[] }).Statement,
    );
}

function functionByName(template: Template, name: string): Resource {
  const fn = Object.values(template.findResources('AWS::Lambda::Function')).find(
    (r) => (r as Resource).Properties.FunctionName === name,
  );
  if (!fn) throw new Error(`function ${name} not found`);
  return fn as Resource;
}

describe('TrolleyStack', () => {
  const { stack, template } = synth();

  it('blocks all public access to the site bucket and enforces SSL', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('serves S3 through CloudFront Origin Access Control (not OAI)', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.resourceCountIs('AWS::CloudFront::CloudFrontOriginAccessIdentity', 0);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Origins: Match.arrayWith([Match.objectLike({ OriginAccessControlId: Match.anyValue() })]),
      }),
    });
  });

  it('routes /api/* to the HTTP API uncached, with SPA rewrite only on the default behaviour', () => {
    const dist = Object.values(
      template.findResources('AWS::CloudFront::Distribution'),
    )[0] as Resource;
    const config = dist.Properties.DistributionConfig as {
      DefaultCacheBehavior: { FunctionAssociations?: unknown[] };
      CacheBehaviors: Array<Record<string, unknown>>;
      CustomErrorResponses?: unknown;
      Aliases?: unknown;
    };
    expect(config.DefaultCacheBehavior.FunctionAssociations).toHaveLength(1);
    expect(config.CustomErrorResponses).toBeUndefined();
    expect(config.Aliases).toBeUndefined();
    const api = config.CacheBehaviors.find((b) => b.PathPattern === '/api/*');
    expect(api).toMatchObject({
      AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
      CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', // CachingDisabled
      OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac', // AllViewerExceptHostHeader
    });
    expect(api?.FunctionAssociations).toBeUndefined();
  });

  it('sets security headers including a CSP that allows Cognito', () => {
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: {
        SecurityHeadersConfig: Match.objectLike({
          StrictTransportSecurity: Match.objectLike({ Override: true }),
          ContentTypeOptions: { Override: true },
          FrameOptions: { FrameOption: 'DENY', Override: true },
          ReferrerPolicy: Match.objectLike({ ReferrerPolicy: 'strict-origin-when-cross-origin' }),
          ContentSecurityPolicy: {
            ContentSecurityPolicy: Match.stringLikeRegexp(
              "connect-src 'self' https://cognito-idp\\.ap-southeast-2\\.amazonaws\\.com",
            ),
            Override: true,
          },
        }),
      },
    });
  });

  it('creates an invite-only Lite user pool that is retained', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolTier: 'LITE',
      AdminCreateUserConfig: Match.objectLike({ AllowAdminCreateUserOnly: true }),
      UsernameAttributes: ['email'],
      AccountRecoverySetting: {
        RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }],
      },
      Schema: Match.arrayWith([
        Match.objectLike({ Name: 'householdId', AttributeDataType: 'String', Mutable: true }),
      ]),
    });
    template.hasResource('AWS::Cognito::UserPool', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  it('configures a public SRP app client that cannot write custom:householdId', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      ExplicitAuthFlows: Match.arrayEquals(['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']),
      PreventUserExistenceErrors: 'ENABLED',
      AccessTokenValidity: 60,
      RefreshTokenValidity: 43200,
      TokenValidityUnits: Match.objectLike({ AccessToken: 'minutes', RefreshToken: 'minutes' }),
      ReadAttributes: Match.arrayWith(['custom:householdId']),
      WriteAttributes: Match.not(Match.arrayWith(['custom:householdId'])),
    });
  });

  it('protects /api/me with the JWT authoriser and leaves /api/health public', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      JwtConfiguration: {
        Audience: [{ Ref: Match.stringLikeRegexp('UserPoolWebClient') }],
        Issuer: Match.anyValue(),
      },
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /api/me',
      AuthorizationType: 'JWT',
      AuthorizerId: Match.anyValue(),
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /api/health',
      AuthorizationType: 'NONE',
    });
  });

  it('runs the API on Node 22 arm64 with 256 MB and one-week logs', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      MemorySize: 256,
      Environment: {
        Variables: Match.objectLike({ TABLE_NAME: { Ref: Match.stringLikeRegexp('^Table') } }),
      },
    });
    const logGroups = Object.values(template.findResources('AWS::Logs::LogGroup')) as Resource[];
    expect(logGroups.length).toBeGreaterThan(0);
    for (const lg of logGroups) expect(lg.Properties.RetentionInDays).toBe(7);
    // Every Lambda (API + BucketDeployment) logs to a group with retention set.
    const fns = Object.values(template.findResources('AWS::Lambda::Function')) as Resource[];
    for (const fn of fns) expect(fn.Properties.LoggingConfig).toBeDefined();
  });

  it('creates no Route 53 resources and nothing with a fixed monthly fee', () => {
    const types = new Set(
      Object.values(template.toJSON().Resources as Record<string, Resource>).map((r) => r.Type),
    );
    for (const t of types) {
      expect(t).not.toMatch(/^AWS::(Route53|EC2::NatGateway|SecretsManager|RDS|ElastiCache)/);
    }
  });

  it('grants the API Lambda access to this table (and its own log group) only', () => {
    const roleId = roleIdOf(template, /^ApiFunctionRole/);

    const role = template.findResources('AWS::IAM::Role')[roleId] as Resource;
    expect(role.Properties.ManagedPolicyArns).toBeUndefined();

    const policies = Object.values(template.findResources('AWS::IAM::Policy')).filter((p) =>
      ((p as Resource).Properties.Roles as Array<{ Ref: string }>).some((r) => r.Ref === roleId),
    ) as Resource[];
    expect(policies.length).toBeGreaterThan(0);

    const statements = policies.flatMap(
      (p) =>
        (p.Properties.PolicyDocument as { Statement: Array<Record<string, unknown>> }).Statement,
    );
    for (const s of statements) {
      const resources = ([] as unknown[]).concat(s.Resource);
      const actions = ([] as string[]).concat(s.Action as string | string[]);
      const json = JSON.stringify(resources);
      expect(json).not.toContain('"*"');
      if (actions.some((a) => a.startsWith('dynamodb:'))) {
        expect(json).toMatch(/Table[0-9A-F]{8}/);
        expect(json).not.toMatch(/ApiFunctionLogs/);
      } else {
        expect(actions.every((a) => a.startsWith('logs:'))).toBe(true);
        expect(json).toMatch(/ApiFunctionLogs/);
      }
    }
  });

  it('protects the product routes with the JWT authoriser', () => {
    for (const routeKey of [
      'GET /api/products/search',
      'GET /api/products/{sku}',
      'POST /api/products/custom',
      'GET /api/groups',
    ]) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: routeKey,
        AuthorizationType: 'JWT',
        AuthorizerId: Match.anyValue(),
      });
    }
  });

  it('runs the scraper on Node 22 arm64, 512 MB, 15 min, Casey service point, no async retries', () => {
    const fn = functionByName(template, 'trolley-scraper');
    expect(fn.Properties).toMatchObject({
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      MemorySize: 512,
      Timeout: 900,
      Environment: {
        Variables: expect.objectContaining({
          ALDI_SERVICE_POINT: 'G526',
          SCRAPE_MIN_INTERVAL_MS: '1000',
          TABLE_NAME: { Ref: expect.stringMatching(/^Table/) },
        }),
      },
    });
    template.hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
      FunctionName: Match.anyValue(),
      MaximumRetryAttempts: 0,
    });
    template.hasOutput('ScraperFunctionName', {});
  });

  it('limits the scraper to its logs, the catalogue index, and PRODUCT#/SCRAPE# writes', () => {
    const roleId = roleIdOf(template, /^ScraperFunctionRole/);
    const role = template.findResources('AWS::IAM::Role')[roleId] as Resource;
    expect(role.Properties.ManagedPolicyArns).toBeUndefined();
    const statements = statementsFor(template, roleId);
    expect(statements).toHaveLength(4);
    for (const st of statements) expect(JSON.stringify(st.Resource)).not.toContain('"*"');

    const byAction = (a: string) =>
      statements.find((st) => ([] as string[]).concat(st.Action as string).includes(a))!;
    expect(JSON.stringify(byAction('logs:PutLogEvents').Resource)).toMatch(/ScraperFunctionLogs/);
    const queries = statements.filter((st) => st.Action === 'dynamodb:Query');
    expect(queries).toHaveLength(2);
    expect(JSON.stringify(queries[0]!.Resource)).toContain('/index/GSI1');
    expect(queries[1]!.Condition).toEqual({
      'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['SCRAPE#*'] },
    });
    const write = byAction('dynamodb:BatchWriteItem');
    expect(write.Action).toEqual(['dynamodb:BatchWriteItem', 'dynamodb:PutItem']);
    expect(write.Condition).toEqual({
      'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['PRODUCT#*', 'SCRAPE#*'] },
    });
    const all = JSON.stringify(statements);
    expect(all).not.toMatch(/dynamodb:(DeleteItem|UpdateItem|Scan|GetItem|\*)/);
  });

  it('schedules the scraper monthly on the 1st at 03:00 Sydney time', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(0 3 1 * ? *)',
      ScheduleExpressionTimezone: 'Australia/Sydney',
      State: 'ENABLED',
      Target: Match.objectLike({
        Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^ScraperFunction'), 'Arn'] },
        Input: JSON.stringify({ trigger: 'schedule' }),
        RetryPolicy: Match.objectLike({ MaximumRetryAttempts: 0 }),
      }),
    });
  });

  it('creates no scraper alarm or SNS topic without alertEmail', () => {
    template.resourceCountIs('AWS::CloudWatch::Alarm', 0);
    template.resourceCountIs('AWS::SNS::Topic', 0);
  });

  it('creates the single table with GSI1, PITR, TTL and retain policy', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [Match.objectLike({ IndexName: 'GSI1' })],
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
    template.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain' });
  });

  it('deploys the web build plus runtime config.json and invalidates CloudFront', () => {
    template.resourceCountIs('Custom::CDKBucketDeployment', 2);
    template.hasResourceProperties('Custom::CDKBucketDeployment', {
      DistributionPaths: ['/*'],
      SourceMarkers: Match.arrayWith([
        Match.objectLike({ '<<marker:0xbaba:0>>': Match.anyValue() }),
      ]),
    });
  });

  it('does not create a budget without alertEmail', () => {
    template.resourceCountIs('AWS::Budgets::Budget', 0);
  });

  it('outputs the CloudFront domain name and user pool id', () => {
    template.hasOutput('CloudFrontDomainName', {});
    template.hasOutput('UserPoolId', {});
    template.hasOutput('UserPoolClientId', {});
  });

  it('has no synthesis errors', () => {
    Annotations.fromStack(stack).hasNoError('*', Match.anyValue());
  });
});

describe('TrolleyStack options', () => {
  it('creates a USD 5 budget with 80% actual and 100% forecast alerts when alertEmail is set', () => {
    const { template } = synth({ alertEmail: 'alerts@example.com' });
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({
        BudgetLimit: { Amount: 5, Unit: 'USD' },
        TimeUnit: 'MONTHLY',
        BudgetType: 'COST',
      }),
      NotificationsWithSubscribers: [
        {
          Notification: Match.objectLike({ NotificationType: 'ACTUAL', Threshold: 80 }),
          Subscribers: [{ SubscriptionType: 'EMAIL', Address: 'alerts@example.com' }],
        },
        {
          Notification: Match.objectLike({ NotificationType: 'FORECASTED', Threshold: 100 }),
          Subscribers: [{ SubscriptionType: 'EMAIL', Address: 'alerts@example.com' }],
        },
      ],
    });
  });

  it('alarms on scraper errors to an SNS email subscription when alertEmail is set', () => {
    const { template } = synth({ alertEmail: 'alerts@example.com' });
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'alerts@example.com',
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'Errors',
      Namespace: 'AWS/Lambda',
      Statistic: 'Sum',
      Threshold: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      TreatMissingData: 'notBreaching',
      Dimensions: [
        { Name: 'FunctionName', Value: { Ref: Match.stringLikeRegexp('^ScraperFunction') } },
      ],
      AlarmActions: [{ Ref: Match.stringLikeRegexp('^ScraperAlertTopic') }],
    });
  });

  it('uses a configured ALDI service point', () => {
    const { template } = synth({ aldiServicePoint: 'G662' });
    expect(functionByName(template, 'trolley-scraper').Properties.Environment).toMatchObject({
      Variables: expect.objectContaining({ ALDI_SERVICE_POINT: 'G662' }),
    });
  });

  it('adds the custom domain alias only when certificateArn is set', () => {
    const arn = 'arn:aws:acm:us-east-1:123456789012:certificate/abcd-1234';
    const { template } = synth({ certificateArn: arn });
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['trolley.example.com'],
        ViewerCertificate: Match.objectLike({ AcmCertificateArn: arn }),
      }),
    });
  });

  it('reports a clear error when the web build is missing', () => {
    const { stack, template } = synth({ webDistPath: path.join(__dirname, 'does-not-exist') });
    Annotations.fromStack(stack).hasError('*', Match.stringLikeRegexp('Web build not found'));
    template.resourceCountIs('Custom::CDKBucketDeployment', 0);
  });
});
