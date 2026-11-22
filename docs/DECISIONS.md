# Decisions log

Format: ID - date - decision. Why. (Supersedes / status.)

## User answers (2026-11-22)
- **D-001** App name is **Trolley**.
- **D-002** AWS region **ap-southeast-2 (Sydney)** for all resources, except the ACM certificate for CloudFront (must be us-east-1).
- **D-003** AI suggestions use **Amazon Bedrock** (no separate Anthropic API key). Model access requested by the user as a one-off manual step.
- **D-004** Custom domain **https://trolley.mcn.am**. DNS for mcn.am is held at an external provider (not Route 53), so no hosted zone is created; the user adds records manually.
- **D-005** ALDI store: **Casey, ACT (Canberra)**. Closed 2026-11-22. Scraper store is configurable, default Casey ACT; prices/range shown are for that store.

## Stage 0 technical decisions (2026-11-22, lead engineer, accepted by PM)
- **D-010 Same-origin hosting.** CloudFront serves the SPA from S3 (Origin Access Control, bucket private) and routes `/api/*` to the API Gateway HTTP API. No CORS. `/mcp` and `/oauth/*` will be routed the same way in Stage 4.
- **D-011 Optional custom domain via config.** If GitHub variable `CERTIFICATE_ARN` (ACM cert in us-east-1, created and DNS-validated manually by the user) is set, CloudFront gets alias `trolley.mcn.am`; otherwise the default `*.cloudfront.net` URL is used. User adds CNAME `trolley -> <distribution>.cloudfront.net` at their DNS provider.
- **D-012 In-app login form** using Amplify Auth (`aws-amplify/auth` only), no Hosted UI redirect. Why: redirects out of an iOS home-screen PWA are unreliable. Must handle `NEW_PASSWORD_REQUIRED` (users start with a temp password) and forgot-password. Supersedes the spec's "Hosted UI / managed login" for the web app (Stage 4 OAuth shim may still use managed login).
- **D-013 Cognito user pool:** Lite feature plan, self sign-up disabled, email as username. Users and household assignment created by `scripts/create-user.sh`.
- **D-014 API:** HTTP API with Cognito JWT authoriser. `GET /api/health` (public), `GET /api/me` (authed; returns `userId`, `email`, `householdId`). Household is resolved server-side from the token/user record, never from request input.
- **D-015 DynamoDB:** single table, on-demand, point-in-time recovery on, GSI1 created now for later use.
- **D-016 Runtime web config** (`/config.json`: region, user pool id, client id) written by CDK `BucketDeployment`, so one `cdk deploy` ships infra + web and invalidates CloudFront. No build-time env baking.
- **D-017 CI/CD:** GitHub Actions. `ci.yml` on PRs: lint, typecheck, unit tests, `cdk synth`. `deploy.yml` on push to `main`: same checks then `cdk deploy` with an OIDC-assumed IAM role (no long-lived keys). Sessions never deploy (CLAUDE.md).
- **D-018 One-off manual setup** by the user in AWS CloudShell: `cdk bootstrap`, deploy the GitHub OIDC provider + deploy-role stack, set repo variables `AWS_ACCOUNT_ID`, `AWS_DEPLOY_ROLE_ARN`, `ALERT_EMAIL`, optional `CERTIFICATE_ARN`. Documented in `docs/SETUP.md`.
- **D-019 Budget alarm** at USD 5/month, emailing `ALERT_EMAIL` (from GitHub variable, never hardcoded).
- **D-020 Tooling:** npm workspaces monorepo, TypeScript, Node 22, Vitest, ESLint + Prettier; layout per spec section 5.
- **D-021 Single environment** (`prod`) for now. Revisit if a breaking change needs a staging stack.

## Stage 0 sign-off (2026-11-22, PM)
- **D-022 Accepted risk: build-time npm audit advisories.** 3 moderate advisories (`minimatch` via `workbox-build`) are in the PWA build toolchain only and never ship to the browser or Lambda. Accepted; re-check `npm audit` at each stage start and upgrade when `vite-plugin-pwa`/`workbox-build` publish a fix. No `npm audit fix --force`.
- **D-023 Accepted risk: CDK BucketDeployment helper role.** The CDK-generated helper Lambda uses `AWSLambdaBasicExecutionRole` and `cloudfront:CreateInvalidation` on `*` (CloudFront invalidation does not support narrower scoping in the CDK construct). It runs only at deploy time. H3 least-privilege applies to our own Lambdas, which are clean. Revisit only if CDK offers scoped invalidation.
- **D-024 Stage 0 criteria wording.** E7 is measured at 390 px width (iPhone 13 Playwright profile); G3/H6 no longer require confirming a budget email subscription (AWS Budgets needs none). Intent unchanged.

## Stage 1 decisions (2026-11-22, PM)
- **D-025 Custom domain stays on CloudFront + free ACM cert; no CNAME straight to S3.** User asked about pointing `trolley.mcn.am` at the S3 bucket. Rejected: S3 website endpoints are HTTP-only (no HTTPS), need a public bucket named exactly as the domain, and lose same-origin `/api/*` routing (D-010). ACM cert is free; D-011 unchanged.
- **D-026 Stage 1 has no list to add to.** The quantity modal is fully functional, but confirm only shows a toast summarising the choice ("Added 1.5 kg Potatoes - lists arrive in Stage 2"); nothing is persisted. The add-to-template icon shows "Templates arrive in Stage 2". Why: simplest option that lets QA verify the modal; a local draft list would be throwaway work Stage 2 must migrate.
- **D-027 Stage 1 runs before Stage 0 is deployed.** The AWS account is not set up yet, so Stage 1 [U] criteria (live scrape from AWS IPs, monthly run, images on phones) are verified after the first deploy; [S] criteria gate the build sign-off.
- **D-028 Scraper safety rules.** Throttle <= 1 req/s, max 3 attempts per request; a run fetching < 50% of the previous successful run's count is aborted with no writes and alerts by email; products are never deleted. Monthly schedule: 1st of the month 03:00 Australia/Sydney. Fallback if ALDI blocks AWS IPs: scheduled GitHub Actions runner scrape via OIDC.
