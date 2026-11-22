import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  Annotations,
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  TimeZone,
  type StackProps,
} from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubs from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Fixed name so the GitHub "scrape-now" workflow can invoke it (D-036). */
export const SCRAPER_FUNCTION_NAME = 'trolley-scraper';
/** ALDI Casey ACT (D-030). */
export const DEFAULT_ALDI_SERVICE_POINT = 'G526';

const LAMBDA_BUNDLING = {
  format: OutputFormat.ESM,
  target: 'node22',
  minify: true,
  sourceMap: true,
  // Runtime-provided AWS SDK v3 is used; keeps the bundle small.
  externalModules: ['@aws-sdk/*'],
  banner:
    "import { createRequire as __trolleyCreateRequire } from 'node:module';" +
    'const require = __trolleyCreateRequire(import.meta.url);',
};

export interface TrolleyStackProps extends StackProps {
  /** Directory containing the built web app (apps/web/dist). */
  webDistPath: string;
  /** Budget alert recipient. When absent, no budget is created. */
  alertEmail?: string;
  /** ACM certificate (us-east-1) for the custom domain. When absent, no alias is used. */
  certificateArn?: string;
  /** Custom domain served by CloudFront when certificateArn is given. */
  domainName: string;
  /** ALDI store ("service point") the scraper uses; "none" for no store. Default G526. */
  aldiServicePoint?: string;
  /**
   * Run the monthly scrape (and its error alarm) from AWS. Off by default: ALDI's bot
   * protection blocks AWS addresses, so the GitHub runner fallback does the monthly scrape
   * (D-042). The Lambda stays deployed for "Scrape now" experiments.
   */
  awsScrapeSchedule?: boolean;
}

export class TrolleyStack extends Stack {
  constructor(scope: Construct, id: string, props: TrolleyStackProps) {
    super(scope, id, props);

    // ---------------------------------------------------------------- Data
    const table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.RETAIN,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
    });

    // ---------------------------------------------------------------- Auth
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'trolley-users',
      featurePlan: cognito.FeaturePlan.LITE,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      customAttributes: {
        householdId: new cognito.StringAttribute({ minLen: 3, maxLen: 64, mutable: true }),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userInvitation: {
        emailSubject: 'Your Trolley account',
        emailBody:
          'You have been invited to Trolley, our shopping list app.<br/><br/>' +
          'Email: {username}<br/>Temporary password: {####}<br/><br/>' +
          'Sign in and you will be asked to choose a new password.',
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const userPoolClient = userPool.addClient('WebClient', {
      userPoolClientName: 'trolley-web',
      generateSecret: false,
      authFlows: { userSrp: true },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      // Users must never be able to change their own household: the client may read
      // custom:householdId but only an admin (scripts/create-user.sh) can write it.
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({ email: true, emailVerified: true, fullname: true })
        .withCustomAttributes('householdId'),
      // Cognito requires every required attribute (email) to be writable; householdId stays
      // read-only so users cannot move themselves between households.
      writeAttributes: new cognito.ClientAttributes().withStandardAttributes({
        email: true,
        fullname: true,
      }),
    });

    // ---------------------------------------------------------------- API
    const apiLogGroup = new logs.LogGroup(this, 'ApiFunctionLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Explicit role (no AWSLambdaBasicExecutionRole managed policy, which allows logs:* on *).
    const apiRole = new iam.Role(this, 'ApiFunctionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Trolley API Lambda: write own logs, read/write the Trolley table',
    });
    apiRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [apiLogGroup.logGroupArn],
      }),
    );

    const apiFunction = new NodejsFunction(this, 'ApiFunction', {
      entry: path.join(REPO_ROOT, 'services', 'api', 'src', 'handler.ts'),
      handler: 'handler',
      projectRoot: REPO_ROOT,
      depsLockFilePath: path.join(REPO_ROOT, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      role: apiRole,
      logGroup: apiLogGroup,
      environment: {
        TABLE_NAME: table.tableName,
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: LAMBDA_BUNDLING,
    });
    table.grantReadWriteData(apiFunction);

    const jwtAuthorizer = new HttpJwtAuthorizer(
      'CognitoJwt',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      {
        authorizerName: 'cognito-id-token',
        jwtAudience: [userPoolClient.userPoolClientId],
      },
    );

    const httpApi = new apigw.HttpApi(this, 'HttpApi', {
      apiName: 'trolley-api',
      description: 'Trolley REST API (served under /api via CloudFront)',
      createDefaultStage: false,
    });
    new apigw.HttpStage(this, 'HttpApiDefaultStage', {
      httpApi,
      stageName: '$default',
      autoDeploy: true,
      // Cost and abuse guard; far above what two people need.
      throttle: { rateLimit: 20, burstLimit: 40 },
    });

    const integration = new HttpLambdaIntegration('ApiIntegration', apiFunction);
    httpApi.addRoutes({
      path: '/api/health',
      methods: [apigw.HttpMethod.GET],
      integration,
    });
    const authedRoutes: Array<[string, apigw.HttpMethod]> = [
      ['/api/me', apigw.HttpMethod.GET],
      ['/api/products/search', apigw.HttpMethod.GET],
      ['/api/products/{sku}', apigw.HttpMethod.GET],
      ['/api/products/custom', apigw.HttpMethod.POST],
      ['/api/groups', apigw.HttpMethod.GET],
    ];
    for (const [routePath, method] of authedRoutes) {
      httpApi.addRoutes({
        path: routePath,
        methods: [method],
        integration,
        authorizer: jwtAuthorizer,
      });
    }

    // ---------------------------------------------------------------- Catalogue scraper
    const scraperLogGroup = new logs.LogGroup(this, 'ScraperFunctionLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const scraperRole = new iam.Role(this, 'ScraperFunctionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description:
        'Trolley ALDI scraper: own logs; read catalogue GSI; write PRODUCT#/SCRAPE# items only',
    });
    scraperRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [scraperLogGroup.logGroupArn],
      }),
    );
    scraperRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadCatalogueIndex',
        actions: ['dynamodb:Query'],
        resources: [`${table.tableArn}/index/GSI1`],
      }),
    );
    scraperRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadScrapeRuns',
        actions: ['dynamodb:Query'],
        resources: [table.tableArn],
        conditions: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['SCRAPE#*'] } },
      }),
    );
    scraperRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'WriteCatalogueItemsOnly',
        actions: ['dynamodb:BatchWriteItem', 'dynamodb:PutItem'],
        resources: [table.tableArn],
        // Household data (HH#...) can never be written by the scraper.
        conditions: {
          'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['PRODUCT#*', 'SCRAPE#*'] },
        },
      }),
    );

    const scraperFunction = new NodejsFunction(this, 'ScraperFunction', {
      functionName: SCRAPER_FUNCTION_NAME,
      description: 'Monthly ALDI AU catalogue scrape into the Trolley table',
      entry: path.join(REPO_ROOT, 'services', 'scraper', 'src', 'handler.ts'),
      handler: 'handler',
      projectRoot: REPO_ROOT,
      depsLockFilePath: path.join(REPO_ROOT, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.minutes(15),
      role: scraperRole,
      logGroup: scraperLogGroup,
      // Failures alarm instead of silently re-scraping ALDI.
      retryAttempts: 0,
      environment: {
        TABLE_NAME: table.tableName,
        ALDI_SERVICE_POINT: props.aldiServicePoint ?? DEFAULT_ALDI_SERVICE_POINT,
        SCRAPE_MIN_INTERVAL_MS: '1000',
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: LAMBDA_BUNDLING,
    });

    // 1st of each month, 03:00 Sydney time (D-035). Opt-in since ALDI blocks AWS (D-042).
    if (props.awsScrapeSchedule)
      new scheduler.Schedule(this, 'ScraperSchedule', {
        description: 'Monthly ALDI catalogue scrape',
        schedule: scheduler.ScheduleExpression.cron({
          minute: '0',
          hour: '3',
          day: '1',
          timeZone: TimeZone.AUSTRALIA_SYDNEY,
        }),
        target: new schedulerTargets.LambdaInvoke(scraperFunction, {
          input: scheduler.ScheduleTargetInput.fromObject({ trigger: 'schedule' }),
          retryAttempts: 0,
        }),
      });

    if (props.alertEmail && props.awsScrapeSchedule) {
      const alertTopic = new sns.Topic(this, 'ScraperAlertTopic', {
        displayName: 'Trolley scraper alerts',
        enforceSSL: true,
      });
      alertTopic.addSubscription(new snsSubs.EmailSubscription(props.alertEmail));
      const alarm = new cloudwatch.Alarm(this, 'ScraperErrorsAlarm', {
        alarmName: 'trolley-scraper-errors',
        alarmDescription:
          'The ALDI catalogue scrape failed, was partial, or was blocked. Existing products are untouched; see the trolley-scraper logs and the SCRAPE#RUN record.',
        metric: scraperFunction.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(new cwActions.SnsAction(alertTopic));
    }

    // ---------------------------------------------------------------- Web hosting
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // No autoDeleteObjects: it adds a custom-resource Lambda; the bucket is cheap to keep.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // SPA routing without masking API errors: rewrite extensionless paths to /index.html
    // on the S3 behaviour only. /api/* never runs this function.
    const spaRewrite = new cloudfront.Function(this, 'SpaRewriteFunction', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Rewrite extensionless paths to /index.html for client-side routing',
      code: cloudfront.FunctionCode.fromInline(
        [
          'function handler(event) {',
          '  var request = event.request;',
          '  var uri = request.uri;',
          "  var last = uri.substring(uri.lastIndexOf('/') + 1);",
          "  if (last.indexOf('.') === -1) {",
          "    request.uri = '/index.html';",
          '  }',
          '  return request;',
          '}',
        ].join('\n'),
      ),
    });

    const cognitoEndpoint = `https://cognito-idp.${this.region}.amazonaws.com`;
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      `connect-src 'self' ${cognitoEndpoint}`,
      "manifest-src 'self'",
      "worker-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ');

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: 'Trolley security headers',
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(730),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        contentSecurityPolicy: { contentSecurityPolicy: csp, override: true },
      },
    });

    // HTTP API endpoint is https://<id>.execute-api.<region>.amazonaws.com
    const apiDomain = Fn.select(2, Fn.split('/', httpApi.apiEndpoint));

    const certificate = props.certificateArn
      ? acm.Certificate.fromCertificateArn(this, 'Certificate', props.certificateArn)
      : undefined;

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'Trolley',
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      // Includes Australian edge locations.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      ...(certificate
        ? {
            certificate,
            domainNames: [props.domainName],
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
          }
        : {}),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
        functionAssociations: [
          { function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(apiDomain, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeaders,
        },
      },
    });

    // ---------------------------------------------------------------- Web deployment
    const indexHtml = path.join(props.webDistPath, 'index.html');
    if (fs.existsSync(indexHtml)) {
      const deployLogs = new logs.LogGroup(this, 'WebDeploymentLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      });

      // Hashed build assets: cache for a year.
      const assetsDir = path.join(props.webDistPath, 'assets');
      const assetsDeployment = fs.existsSync(assetsDir)
        ? new s3deploy.BucketDeployment(this, 'DeployWebAssets', {
            sources: [s3deploy.Source.asset(assetsDir)],
            destinationBucket: siteBucket,
            destinationKeyPrefix: 'assets/',
            cacheControl: [s3deploy.CacheControl.fromString('public, max-age=31536000, immutable')],
            prune: false,
            memoryLimit: 512,
            logGroup: deployLogs,
          })
        : undefined;

      // Everything else (index.html, service worker, manifest, runtime config): always revalidate.
      const siteDeployment = new s3deploy.BucketDeployment(this, 'DeployWebSite', {
        sources: [
          s3deploy.Source.asset(props.webDistPath, { exclude: ['assets', 'assets/**'] }),
          s3deploy.Source.jsonData('config.json', {
            region: this.region,
            userPoolId: userPool.userPoolId,
            userPoolClientId: userPoolClient.userPoolClientId,
          }),
        ],
        destinationBucket: siteBucket,
        cacheControl: [s3deploy.CacheControl.fromString('no-cache')],
        prune: false,
        distribution,
        distributionPaths: ['/*'],
        memoryLimit: 512,
        logGroup: deployLogs,
      });
      if (assetsDeployment) siteDeployment.node.addDependency(assetsDeployment);
    } else {
      // Fail `cdk synth`/`cdk deploy` for this stack with a clear message, while still
      // letting other stacks in the app (e.g. TrolleyGithubOidcStack) be deployed.
      Annotations.of(this).addError(
        `Web build not found at ${indexHtml}. Run "npm run build" at the repo root before synth/deploy.`,
      );
    }

    // ---------------------------------------------------------------- Budget
    if (props.alertEmail) {
      const subscribers = [{ subscriptionType: 'EMAIL', address: props.alertEmail }];
      new budgets.CfnBudget(this, 'MonthlyBudget', {
        budget: {
          budgetName: 'trolley-monthly',
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: 5, unit: 'USD' },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold: 80,
              thresholdType: 'PERCENTAGE',
            },
            subscribers,
          },
          {
            notification: {
              notificationType: 'FORECASTED',
              comparisonOperator: 'GREATER_THAN',
              threshold: 100,
              thresholdType: 'PERCENTAGE',
            },
            subscribers,
          },
        ],
      });
    }

    // ---------------------------------------------------------------- Outputs
    new CfnOutput(this, 'CloudFrontDomainName', {
      value: distribution.distributionDomainName,
      description: 'Point your custom domain CNAME at this',
    });
    new CfnOutput(this, 'AppUrl', {
      value: certificate
        ? `https://${props.domainName}`
        : `https://${distribution.distributionDomainName}`,
    });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'ApiEndpoint', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'ScraperFunctionName', { value: scraperFunction.functionName });
  }
}
