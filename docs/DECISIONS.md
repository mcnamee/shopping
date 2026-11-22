# Decisions log

Format: ID - date - decision. Why. (Supersedes / status.)

## User answers (2026-11-22)
- **D-001** App name is **Trolley**.
- **D-002** AWS region **ap-southeast-2 (Sydney)** for all resources, except the ACM certificate for CloudFront (must be us-east-1).
- **D-003** AI suggestions use **Amazon Bedrock** (no separate Anthropic API key). Model access requested by the user as a one-off manual step.
- **D-004** Custom domain **https://trolley.mcn.am**. DNS for mcn.am is held at an external provider (not Route 53), so no hosted zone is created; the user adds records manually.
- **D-005** ALDI store/state: still open (needed before Stage 1).

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
