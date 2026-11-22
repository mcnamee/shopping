# Stage 0 - Foundations: acceptance criteria

Goal: both users can sign in on their phones at https://trolley.mcn.am (or the CloudFront URL) and see the app shell.
Decisions: see docs/DECISIONS.md (D-001 to D-021).

**Verification tags**
- **[S]** in session: lint, typecheck, unit tests, `cdk synth` + CDK template assertion tests, Playwright (mobile viewport, e.g. iPhone 13) against local dev with mocked auth.
- **[U]** post-deploy by user, on real phones / AWS console.

## Out of scope (Stage 1+)
Catalogue, scraper, search results, quantity modal, lists, templates, settings content (other than sign-out), AI, MCP/OAuth, PWA install prompt/offline, staging environment.

## A. Repo and tooling
- A1 [S] Root `package.json` uses npm workspaces with `apps/web`, `services/api`, `packages/core`, `infra` (other spec folders may be empty or absent). `.nvmrc`/`engines` pins Node 22.
- A2 [S] `npm ci && npm run lint && npm run typecheck && npm test` all pass from a clean clone with zero errors.
- A3 [S] Prettier check (`npm run format:check`) passes; ESLint + Prettier configs shared at root.
- A4 [S] Vitest runs unit tests in every workspace that has code; at least one test each for api, web, infra.

## B. Infrastructure (CDK, ap-southeast-2)
- B1 [S] `cdk synth` succeeds with no `CERTIFICATE_ARN` set, and with a dummy one set.
- B2 [S] Assertion: S3 bucket blocks all public access, has encryption and enforces SSL; only CloudFront (OAC) can read it.
- B3 [S] Assertion: CloudFront default behaviour -> S3; `/api/*` behaviour -> HTTP API with caching disabled and Authorization header forwarded; viewer protocol redirects to HTTPS; SPA fallback serves `index.html` for unknown non-API paths.
- B4 [S] Assertion: with `CERTIFICATE_ARN` set, distribution has alias `trolley.mcn.am` and that certificate; without it, no alias and no certificate. No Route 53 resources.
- B5 [S] Assertion: Cognito user pool has self sign-up disabled, email as username, Lite feature plan; app client has no secret and enables SRP auth.
- B6 [S] Assertion: DynamoDB table is PAY_PER_REQUEST, PITR enabled, has PK/SK and GSI1 (GSI1PK/GSI1SK).
- B7 [S] Assertion: Lambda runtime Node 22; log groups have 7-day retention.
- B8 [S] Assertion: `BucketDeployment` publishes web build plus `/config.json` (region, userPoolId, userPoolClientId) and invalidates CloudFront.
- B9 [S] Stack outputs include the CloudFront domain name and URL.

## C. Auth
- C1 [S] `scripts/create-user.sh <email> <householdId>` creates a Cognito user with a temporary password (emailed by Cognito) and records the user-to-household mapping; it is idempotent-safe (clear error if user exists). Script passes `shellcheck` or equivalent review.
- C2 [S] Web uses `aws-amplify/auth` only (no Hosted UI, no redirects, no full `aws-amplify` UI packages).
- C3 [U] Each user signs in with email + temp password, is forced to set a new password, then lands on Lists.
- C4 [U] Forgot password: code arrives by email, reset works, user can sign in with the new password.
- C5 [U] Session persists across closing and reopening the home-screen app (iOS Safari and Android Chrome).

## D. API
- D1 [S] `GET /api/health` returns 200 `{ "status": "ok" }` without a token.
- D2 [S] `GET /api/me` with a valid token returns 200 `{ userId, email, householdId }`; householdId comes from server-side lookup, and any householdId in query/body/headers is ignored (unit test).
- D3 [S] Assertion: `/api/me` route has the Cognito JWT authoriser (issuer = user pool, audience = app client); `/api/health` has none.
- D4 [U] Deployed `/api/me` returns 401 with no token and with a malformed/expired token.
- D5 [S] User with no household mapping gets 403 with a clear error code, not a 500.

## E. Web shell (mobile-first, Australian English)
- E1 [S] Login screen: email, password, "Sign in" button, "Forgot password?" link; inline error for wrong credentials; button disabled/spinner while submitting.
- E2 [S] Set-new-password screen shown on `NEW_PASSWORD_REQUIRED`; shows password rules; mismatch/weak password errors shown inline.
- E3 [S] Forgot-password flow: request code -> enter code + new password -> back to sign in with success message.
- E4 [S] Signed-in shell: fixed bottom nav with Lists, Search, Templates, Settings; active tab highlighted; each tab routes to a placeholder page with its title; deep link refresh works.
- E5 [S] Settings shows signed-in email and a "Sign out" button; sign-out returns to login and protected routes then redirect to login.
- E6 [S] Unauthenticated access to any app route redirects to login.
- E7 [S] Playwright at 390x844: no horizontal scroll; tap targets >= 44 px; text contrast passes axe (no serious/critical violations) on login and shell pages.
- E8 [S] UI copy reviewed for Australian English (e.g. "authorise", "colour"); app title "Trolley".
- E9 [S] App reads `/config.json` at start-up; shows a friendly error if it fails to load.
- E10 [U] Shell looks and works correctly on both users' phones, including safe-area insets (notch/home bar).

## F. CI/CD
- F1 [S] `.github/workflows/ci.yml` runs on pull requests: install, lint, typecheck, unit tests, `cdk synth`.
- F2 [S] `.github/workflows/deploy.yml` runs on push to `main`: same checks, then `cdk deploy` using `aws-actions/configure-aws-credentials` with role `AWS_DEPLOY_ROLE_ARN` via OIDC; `permissions: id-token: write, contents: read`; no AWS access keys anywhere.
- F3 [S] Workflow concurrency prevents overlapping deploys; region fixed to ap-southeast-2.
- F4 [U] First merge to `main` deploys successfully and the site loads at the CloudFront URL.

## G. Docs and one-off setup
- G1 [S] `docs/SETUP.md` gives copy-paste CloudShell steps: `cdk bootstrap`, deploy OIDC provider + deploy-role stack (trust limited to this repo's `main` branch), set GitHub variables `AWS_ACCOUNT_ID`, `AWS_DEPLOY_ROLE_ARN`, `ALERT_EMAIL`, optional `CERTIFICATE_ARN`.
- G2 [S] SETUP.md covers custom domain: request ACM cert in us-east-1, add validation CNAME at the external DNS provider, set `CERTIFICATE_ARN`, add CNAME `trolley -> <distribution>.cloudfront.net`.
- G3 [S] SETUP.md covers creating both users with `create-user.sh`, confirming the budget alert email subscription, and requesting Bedrock model access.
- G4 [S] README has local dev instructions (install, test, run web with mocked auth).

## H. Cost and security
- H1 [S] Assertion: AWS Budget of USD 5/month with email notification to `ALERT_EMAIL` taken from config; synth fails with a clear message if `ALERT_EMAIL` is missing in deploy.
- H2 [S] No secrets, account IDs or emails hardcoded in the repo (grep check / secret scan clean).
- H3 [S] Assertion: each Lambda role is least-privilege (api Lambda: read on the table/household mapping only; no `*` actions or resources except where AWS requires).
- H4 [S] Deploy role in the OIDC stack is scoped to assuming CDK bootstrap roles (no AdministratorAccess attached directly); trust condition pins `repo:<owner>/<repo>:ref:refs/heads/main`.
- H5 [S] No resource costs a fixed monthly fee (no NAT, no Route 53 zone, no Secrets Manager, no provisioned capacity).
- H6 [U] Budget alert email subscription confirmed; AWS Cost Explorer shows ~$0 after a week.

## Done when
All [S] criteria pass in QA's report, and the user confirms C3, C4, F4 and E10: both of you can sign in on your phones at https://trolley.mcn.am (or the CloudFront URL if the certificate is not yet set up).
