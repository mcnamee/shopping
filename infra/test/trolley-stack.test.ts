import * as path from 'node:path';
import { App } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { routes as apiRoutes } from '../../services/api/src/routes';
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

  it('serves S3 (site and media buckets) through CloudFront Origin Access Control (not OAI)', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 2);
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

  it('routes /mcp, /oauth/* and /.well-known/* to the API like /api/*, never the SPA rewrite (A1)', () => {
    const dist = Object.values(
      template.findResources('AWS::CloudFront::Distribution'),
    )[0] as Resource;
    const config = dist.Properties.DistributionConfig as {
      CacheBehaviors: Array<Record<string, unknown>>;
      Origins: Array<{ Id: string }>;
    };
    const api = config.CacheBehaviors.find((b) => b.PathPattern === '/api/*');
    for (const pattern of ['/mcp', '/oauth/*', '/.well-known/*']) {
      const b = config.CacheBehaviors.find((x) => x.PathPattern === pattern);
      expect(b, pattern).toMatchObject({
        TargetOriginId: api?.TargetOriginId,
        AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
        CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', // CachingDisabled
        OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac', // AllViewerExceptHostHeader (forwards Authorization)
        ViewerProtocolPolicy: 'https-only',
      });
      expect(b?.FunctionAssociations, pattern).toBeUndefined();
    }
    // One API origin shared by every API behaviour, plus the site and media buckets.
    expect(config.Origins).toHaveLength(3);
  });

  it('gives the API its public origin from the configured domain (Stage 4 issuer)', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({ PUBLIC_ORIGIN: 'https://trolley.example.com' }),
      },
    });
  });

  it('leaves the OAuth and MCP endpoints public at the gateway and JWT-protects the SPA ones', () => {
    for (const routeKey of [
      'GET /.well-known/oauth-authorization-server',
      'GET /.well-known/oauth-protected-resource',
      'GET /.well-known/oauth-protected-resource/mcp',
      'POST /oauth/register',
      'GET /oauth/authorize',
      'POST /oauth/token',
      'OPTIONS /oauth/token',
      'POST /oauth/revoke',
      'POST /mcp',
    ]) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: routeKey,
        AuthorizationType: 'NONE',
      });
    }
    for (const routeKey of [
      'GET /api/oauth/requests/{requestId}',
      'POST /api/oauth/consent',
      'GET /api/connected-apps',
      'DELETE /api/connected-apps/{grantId}',
    ]) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: routeKey,
        AuthorizationType: 'JWT',
        AuthorizerId: Match.anyValue(),
      });
    }
  });

  it('leaves only /api/health and the two quick routes without the JWT authoriser among /api/* (Siri keys)', () => {
    const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map(
      (r) => (r as Resource).Properties,
    );
    const publicApi = routes
      .filter(
        (p) => String(p.RouteKey).includes(' /api/') && (p.AuthorizationType ?? 'NONE') === 'NONE',
      )
      .map((p) => p.RouteKey as string)
      .sort();
    expect(publicApi).toEqual(['GET /api/health', 'GET /api/quick/list', 'POST /api/quick/add']);
    for (const routeKey of [
      'POST /api/shortcut-keys',
      'GET /api/shortcut-keys',
      'DELETE /api/shortcut-keys/{keyId}',
    ]) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: routeKey,
        AuthorizationType: 'JWT',
        AuthorizerId: Match.anyValue(),
      });
    }
  });

  it('keeps a single API-wide Lambda invoke permission (policy size limit)', () => {
    const perms = Object.values(template.findResources('AWS::Lambda::Permission')).filter(
      (r) => (r as Resource).Properties.Principal === 'apigateway.amazonaws.com',
    );
    expect(perms).toHaveLength(1);
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
            // Cognito plus the media bucket's regional host (token in the template).
            ContentSecurityPolicy: Match.anyValue(),
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
    // Cognito rejects a client that cannot write a required attribute (failed first deploy).
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      WriteAttributes: Match.arrayWith(['email']),
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
      } else if (actions.some((a) => a.startsWith('bedrock:'))) {
        // Covered in detail by the Bedrock tests below.
        expect(actions).toEqual(['bedrock:InvokeModel']);
        expect(json).toMatch(/nova-micro/);
      } else if (actions.some((a) => a.startsWith('s3:'))) {
        // Covered in detail by the recipe photo tests below.
        expect(actions).toEqual(['s3:PutObject', 's3:DeleteObject']);
        expect(json).toMatch(/MediaBucket/);
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

  it('has an HTTP API route with the JWT authoriser for every authed API route, and no extras', () => {
    const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map(
      (r) => (r as Resource).Properties,
    );
    const deployed = new Map(routes.map((p) => [p.RouteKey as string, p]));
    for (const [routeKey, route] of Object.entries(apiRoutes)) {
      const p = deployed.get(routeKey);
      expect(p, `${routeKey} is not deployed`).toBeDefined();
      if (route.auth) {
        expect([routeKey, p?.AuthorizationType]).toEqual([routeKey, 'JWT']);
        expect(p?.AuthorizerId).toBeDefined();
      } else {
        expect([routeKey, p?.AuthorizationType ?? 'NONE']).toEqual([routeKey, 'NONE']);
      }
    }
    expect([...deployed.keys()].sort()).toEqual(Object.keys(apiRoutes).sort());
  });

  it('protects every Stage 2 route with the JWT authoriser (A1)', () => {
    for (const routeKey of [
      'GET /api/lists',
      'POST /api/lists/{listId}/items',
      'PATCH /api/lists/{listId}/items/{itemId}',
      'POST /api/lists/{listId}/reopen',
      'GET /api/history',
      'POST /api/this-week/items',
      'DELETE /api/templates/{templateId}/items/{itemId}',
      'PUT /api/settings/aisle-order',
      'DELETE /api/settings/unit-overrides/{productId}',
    ]) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: routeKey,
        AuthorizationType: 'JWT',
        AuthorizerId: Match.anyValue(),
      });
    }
  });

  it('keeps the scraper away from GSI2 (household lists)', () => {
    const statements = statementsFor(template, roleIdOf(template, /^ScraperFunctionRole/));
    expect(JSON.stringify(statements)).not.toContain('GSI2');
    expect(JSON.stringify(statements)).not.toContain('index/*');
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
    expect(write.Action).toEqual([
      'dynamodb:BatchWriteItem',
      'dynamodb:PutItem',
      'dynamodb:DeleteItem',
    ]);
    expect(write.Condition).toEqual({
      'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['PRODUCT#*', 'SCRAPE#*'] },
    });
    const all = JSON.stringify(statements);
    expect(all).not.toMatch(/dynamodb:(UpdateItem|Scan|GetItem|\*)/);
    // DeleteItem exists only inside the PRODUCT#/SCRAPE# LeadingKeys statement (D-084).
    expect(statements.filter((st) => JSON.stringify(st).includes('DeleteItem'))).toEqual([write]);
  });

  it('has no AWS scrape schedule by default (ALDI blocks AWS, D-042)', () => {
    template.resourceCountIs('AWS::Scheduler::Schedule', 0);
  });

  it('schedules the scraper monthly on the 1st at 03:00 Sydney time when enabled', () => {
    const { template } = synth({ awsScrapeSchedule: true });
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

  it('creates the single table with GSI1, GSI2, PITR, TTL and retain policy', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        Match.objectLike({ IndexName: 'GSI1' }),
        // Household lists by status (D-057); all attributes projected.
        {
          IndexName: 'GSI2',
          KeySchema: [
            { AttributeName: 'gsi2pk', KeyType: 'HASH' },
            { AttributeName: 'gsi2sk', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
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

  it('creates no scraper alarm with alertEmail when the AWS schedule is off', () => {
    const { template } = synth({ alertEmail: 'alerts@example.com' });
    template.resourceCountIs('AWS::CloudWatch::Alarm', 0);
  });

  it('alarms on scraper errors to an SNS email subscription when enabled', () => {
    const { template } = synth({ alertEmail: 'alerts@example.com', awsScrapeSchedule: true });
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

describe('TrolleyStack suggestions model (Bedrock, D-061, D-073)', () => {
  const bedrockStatements = (template: Template) =>
    statementsFor(template, roleIdOf(template, /^ApiFunctionRole/)).filter((s) =>
      ([] as string[]).concat(s.Action as string | string[]).some((a) => a.startsWith('bedrock:')),
    );
  const apiFunction = (template: Template) =>
    Object.values(template.findResources('AWS::Lambda::Function')).find((r) =>
      JSON.stringify((r as Resource).Properties.Environment ?? {}).includes('SUGGEST_MODEL_ID'),
    ) as Resource;

  it('defaults to Nova Micro via the APAC inference profile, invoke-only on that profile and model', () => {
    const { template } = synth();
    const statements = bedrockStatements(template);
    expect(statements).toHaveLength(2);
    const profileArn = {
      'Fn::Join': [
        '',
        [
          'arn:',
          { Ref: 'AWS::Partition' },
          ':bedrock:ap-southeast-2:123456789012:inference-profile/apac.amazon.nova-micro-v1:0',
        ],
      ],
    };
    expect(statements).toEqual(
      expect.arrayContaining([
        {
          Sid: 'SuggestInferenceProfile',
          Effect: 'Allow',
          Action: 'bedrock:InvokeModel',
          Resource: profileArn,
        },
        {
          Sid: 'SuggestFoundationModelViaProfile',
          Effect: 'Allow',
          Action: 'bedrock:InvokeModel',
          Resource: {
            'Fn::Join': [
              '',
              [
                'arn:',
                { Ref: 'AWS::Partition' },
                ':bedrock:*::foundation-model/amazon.nova-micro-v1:0',
              ],
            ],
          },
          Condition: { StringEquals: { 'bedrock:InferenceProfileArn': profileArn } },
        },
      ]),
    );
    // Nothing broader: no wildcard model, no other Bedrock actions, no Marketplace.
    const json = JSON.stringify(statements);
    expect(json).not.toMatch(/foundation-model\/\*|inference-profile\/\*|"\*"|aws-marketplace/);
    expect(json).not.toMatch(/InvokeModelWithResponseStream|"bedrock:\*"/);
    expect(apiFunction(template).Properties).toMatchObject({
      Timeout: 20,
      Environment: { Variables: { SUGGEST_MODEL_ID: 'apac.amazon.nova-micro-v1:0' } },
    });
  });

  it('a plain foundation model id is allowed in this region only', () => {
    const { template } = synth({ suggestModelId: 'amazon.nova-lite-v1:0' });
    const statements = bedrockStatements(template);
    expect(statements).toHaveLength(1);
    expect(JSON.stringify(statements[0]?.Resource)).toContain(
      ':bedrock:ap-southeast-2::foundation-model/amazon.nova-lite-v1:0',
    );
    expect(statements[0]?.Condition).toBeUndefined();
  });

  it('"none" grants no Bedrock access (rules-only suggestions)', () => {
    const { template } = synth({ suggestModelId: 'none' });
    expect(bedrockStatements(template)).toHaveLength(0);
    expect(apiFunction(template).Properties).toMatchObject({
      Environment: { Variables: { SUGGEST_MODEL_ID: 'none' } },
    });
  });

  it('only the API role can call Bedrock', () => {
    const { template } = synth();
    const others = Object.values(template.findResources('AWS::IAM::Policy')).filter(
      (p) =>
        JSON.stringify((p as Resource).Properties.PolicyDocument).includes('bedrock:') &&
        !JSON.stringify((p as Resource).Properties.Roles).includes('ApiFunctionRole'),
    );
    expect(others).toHaveLength(0);
  });
});

describe('API Lambda permissions', () => {
  it('uses one API-wide invoke permission so the resource policy stays under 20 KB', () => {
    const { template } = synth();
    const perms = Object.values(template.findResources('AWS::Lambda::Permission')).filter(
      (r) =>
        (r as { Properties: { Principal?: string } }).Properties.Principal ===
        'apigateway.amazonaws.com',
    );
    expect(perms.length).toBe(1);
  });
});

describe('Stage 5 media', () => {
  const { template } = synth();

  describe('recipe photos (Stage 5, D-105)', () => {
    const resources = () => Object.values(template.findResources('AWS::S3::Bucket')) as Resource[];
    const mediaBucketId = () => {
      const id = Object.keys(template.findResources('AWS::S3::Bucket')).find((k) =>
        /^MediaBucket/.test(k),
      );
      if (!id) throw new Error('MediaBucket not found');
      return id;
    };

    it('has a private, encrypted, SSL-only, retained media bucket allowing only a POST CORS rule from the app origin', () => {
      const bucket = template.findResources('AWS::S3::Bucket')[mediaBucketId()] as Resource & {
        DeletionPolicy?: string;
      };
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      expect(JSON.stringify(bucket.Properties.BucketEncryption)).toContain('AES256');
      expect(bucket.DeletionPolicy).toBe('Retain');
      expect(bucket.Properties.CorsConfiguration).toEqual({
        CorsRules: [
          {
            AllowedHeaders: ['*'],
            AllowedMethods: ['POST'],
            AllowedOrigins: ['https://trolley.example.com'],
            MaxAge: 3000,
          },
        ],
      });
      expect(resources().length).toBe(2);
      const policy = Object.values(template.findResources('AWS::S3::BucketPolicy')).find((p) =>
        JSON.stringify((p as Resource).Properties.Bucket).includes('MediaBucket'),
      ) as Resource;
      const statements = (policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement;
      // SSL-only deny plus CloudFront OAC read; no public principal.
      expect(JSON.stringify(statements)).toContain('aws:SecureTransport');
      const allows = statements.filter((st) => st.Effect === 'Allow');
      expect(allows).toHaveLength(1);
      expect(allows[0]?.Principal).toEqual({ Service: 'cloudfront.amazonaws.com' });
      expect(allows[0]?.Action).toBe('s3:GetObject');
      expect(JSON.stringify(allows[0]?.Condition)).toContain('AWS:SourceArn');
    });

    it('serves /media/* from the media bucket through OAC: GET/HEAD, cached, no SPA rewrite', () => {
      const dist = Object.values(
        template.findResources('AWS::CloudFront::Distribution'),
      )[0] as Resource;
      const config = dist.Properties.DistributionConfig as {
        CacheBehaviors: Array<Record<string, unknown>>;
        Origins: Array<{ Id: string; DomainName: unknown; OriginAccessControlId?: unknown }>;
      };
      const media = config.CacheBehaviors.find((b) => b.PathPattern === '/media/*');
      expect(media).toMatchObject({
        AllowedMethods: ['GET', 'HEAD'],
        CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6', // CachingOptimized
        ViewerProtocolPolicy: 'redirect-to-https',
      });
      expect(media?.FunctionAssociations).toBeUndefined();
      const origin = config.Origins.find((o) => o.Id === media?.TargetOriginId);
      expect(JSON.stringify(origin?.DomainName)).toContain('MediaBucket');
      expect(origin?.OriginAccessControlId).toBeDefined();
    });

    it('lets the CSP connect to the media bucket host for uploads and show blob previews', () => {
      const policy = Object.values(
        template.findResources('AWS::CloudFront::ResponseHeadersPolicy'),
      )[0] as Resource;
      const csp = JSON.stringify(
        (
          policy.Properties.ResponseHeadersPolicyConfig as {
            SecurityHeadersConfig: { ContentSecurityPolicy: { ContentSecurityPolicy: unknown } };
          }
        ).SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy,
      );
      expect(csp).toContain(
        "connect-src 'self' https://cognito-idp.ap-southeast-2.amazonaws.com https://",
      );
      expect(csp).toMatch(/MediaBucket[0-9A-F]+","RegionalDomainName"/);
      expect(csp).toContain("img-src 'self' data: blob: https:");
    });

    it('gives the API role PutObject and DeleteObject on media/recipes/* only (no read, list or bucket access)', () => {
      const statements = statementsFor(template, roleIdOf(template, /^ApiFunctionRole/)).filter(
        (st) =>
          ([] as string[]).concat(st.Action as string | string[]).some((a) => a.startsWith('s3:')),
      );
      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatchObject({
        Effect: 'Allow',
        Action: ['s3:PutObject', 's3:DeleteObject'],
      });
      const resource = JSON.stringify(statements[0]?.Resource);
      expect(resource).toContain('MediaBucket');
      expect(resource).toContain('/media/recipes/*');
      expect(resource).not.toContain('SiteBucket');
    });

    it('passes the bucket name to the API and keeps the scraper away from S3', () => {
      const fn = Object.values(template.findResources('AWS::Lambda::Function')).find(
        (r) =>
          JSON.stringify((r as Resource).Properties.Environment).includes('TABLE_NAME') &&
          JSON.stringify((r as Resource).Properties.Environment).includes('MEDIA_BUCKET'),
      );
      expect(fn).toBeDefined();
      expect(
        JSON.stringify(statementsFor(template, roleIdOf(template, /^ScraperFunctionRole/))),
      ).not.toContain('s3:');
    });

    it('routes every recipe endpoint through the JWT authoriser and keeps one Lambda permission', () => {
      for (const routeKey of [
        'GET /api/recipes',
        'POST /api/recipes',
        'POST /api/recipes/photo-upload',
        'GET /api/recipes/{recipeId}',
        'PUT /api/recipes/{recipeId}',
        'PATCH /api/recipes/{recipeId}',
        'DELETE /api/recipes/{recipeId}',
        'POST /api/recipes/{recipeId}/to-list',
        'POST /api/recipes/{recipeId}/match',
      ]) {
        template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
          RouteKey: routeKey,
          AuthorizationType: 'JWT',
          AuthorizerId: Match.anyValue(),
        });
      }
      const perms = Object.values(template.findResources('AWS::Lambda::Permission')).filter(
        (p) => (p as Resource).Properties.Principal === 'apigateway.amazonaws.com',
      );
      expect(perms).toHaveLength(1);
    });
  });
});
