# Stage 0 - QA report

Branch `claude/elegant-ride-dzzdob`. Tester: qa-tester. Nothing was deployed (no AWS access, by design).

**Verdict: all 40 [S] criteria pass. 7 [U] criteria are deferred to the user (reviewed, achievable). 0 blockers, 0 high or medium defects; 3 low and 3 informational findings (section 3).**

## 1. Test runs

| Check | Command | Result |
|---|---|---|
| Install | `npm ci` | OK (Node 22.23.5, npm 10.9.9). `npm audit`: 3 moderate (workbox-build / minimatch, build-time only) - see INFO-1 |
| Lint + Prettier | `npm run lint` | 0 errors, Prettier clean |
| Typecheck | `npm run typecheck` | 0 errors in core, api, web (now incl. `e2e/`), infra |
| Unit tests | `npm test` | **126 passed / 126**: core 10, api 8, web 85 (10 files), infra 23 (2 files) |
| Build | `npm run build` | OK; PWA precache 16 entries. `VITE_MOCK_AUTH=true` build correctly refused; no mock code in `dist` |
| Synth | `npm run synth` | OK. Also OK with a dummy `CERTIFICATE_ARN` + `ALERT_EMAIL`, and with both set to empty |
| E2E (new) | `npm run e2e -w @trolley/web` | **53 passed / 53** (52 pass, 1 expected-fail documenting DEF-QA-001), about 30 s, run 4 times with no flake |

E2E suite: `apps/web/e2e/` (`auth`, `shell`, `config`, `a11y`, `exploratory`) with `apps/web/playwright.config.ts`. It uses the iPhone 13 profile (390 px wide; Playwright's profile height is 664, not 844) and runs against `vite dev` in mock mode on port 5199. A second non-mock `vite dev` on port 5198 exercises the real `/config.json` path with route interception. Tracing is off. To use the sandbox's preinstalled browser (the installed Playwright 1.65.1 expects a different Chromium build) run with `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e -w @trolley/web`. In CI the `ci.yml` step runs `playwright install --with-deps chromium` instead. The e2e step was added to `ci.yml` (it ran reliably headless).

Dependencies added to `apps/web` (devDependencies): `@playwright/test`, `@axe-core/playwright` (lockfile written with npm 11, as instructed).

## 2. Criteria

Legend: Pass, Fail, Deferred (user verifies post-deploy, reviewed for achievability).

### A. Repo and tooling

| ID | Result | Evidence |
|---|---|---|
| A1 | Pass | Root workspaces `packages/*`, `services/*`, `apps/*`, `infra`; `.nvmrc` = 22; `engines` `>=22 <23` |
| A2 | Pass | `npm ci`, lint, typecheck, test all exit 0. Also confirmed `npm ci` + OIDC synth in a fresh clone |
| A3 | Pass | `npm run format:check` clean; single root `eslint.config.mjs` and Prettier config |
| A4 | Pass | Vitest suites in core, api, web, infra (126 tests) |

### B. Infrastructure

Verified by the unit assertions and independently by inspecting the synthesised templates (with and without certificate).

| ID | Result | Evidence |
|---|---|---|
| B1 | Pass | Synth OK with no `CERTIFICATE_ARN`, with a dummy valid ARN, and with empty values. A malformed ARN fails with a clear message |
| B2 | Pass | `BlockPublicAccess.BLOCK_ALL`, S3-managed encryption, `aws:SecureTransport=false` deny; only `cloudfront.amazonaws.com` with `AWS:SourceArn` = this distribution may `s3:GetObject` (OAC, no OAI) |
| B3 | Pass | Default behaviour -> S3, `redirect-to-https`, CloudFront Function rewrites extensionless paths to `/index.html`. `/api/*` -> HTTP API, CachingDisabled, AllViewerExceptHostHeader (forwards `Authorization`), https-only, no SPA function |
| B4 | Pass | Cert present: alias `trolley.mcn.am` + ACM ARN + TLS 1.2 2021. Absent: no alias, no certificate. No Route 53 resource types |
| B5 | Pass | `AllowAdminCreateUserOnly`, `UsernameAttributes: email`, `UserPoolTier: LITE`, client `GenerateSecret: false`, flows `ALLOW_USER_SRP_AUTH` + refresh only. Client cannot write `custom:householdId` |
| B6 | Pass | `PAY_PER_REQUEST`, PITR on, `pk`/`sk`, GSI1 (`gsi1pk`/`gsi1sk`) |
| B7 | Pass | API Lambda `nodejs22.x`; both log groups `RetentionInDays: 7`. The CDK BucketDeployment helper Lambda is `python3.13` (CDK-managed, not our code) |
| B8 | Pass | Two `Custom::CDKBucketDeployment`s: hashed assets (immutable cache) and site files plus `config.json` (region, userPoolId, userPoolClientId; `no-cache`), with `DistributionPaths: /*` invalidation |
| B9 | Pass | Outputs `CloudFrontDomainName`, `AppUrl` (and UserPoolId, ClientId, ApiEndpoint, TableName) |

### C. Auth

| ID | Result | Evidence |
|---|---|---|
| C1 | Pass | Ran `scripts/create-user.sh` against a stubbed `aws` CLI: creates user with `email`, `email_verified`, `custom:householdId`, EMAIL delivery; existing user gives a clear error and exit 1 with no change; `--resend` path, user-not-found, other-error, bad email, bad householdId (`a#b`, too short), bad flag and missing stack output all handled with clear messages and exit 1. `shellcheck` (0.x via shellcheck-py) clean. Minor cosmetic issue: DEF-QA-002 |
| C2 | Pass | Only `aws-amplify` (core `Amplify.configure`) and `aws-amplify/auth` are imported, in `auth/amplify.ts`. No Hosted UI, no redirects, no Amplify UI packages |
| C3 | Deferred to user - reviewed | Real path implemented: SRP sign-in, `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED` -> `/new-password` -> `confirmSignIn` -> Lists. Behaviour proven end to end in mock (E2E). Pool has no other required attributes that would block the challenge |
| C4 | Deferred to user - reviewed | `resetPassword` + `confirmResetPassword` wired; two-step flow and success banner proven in mock. Pool `accountRecovery: EMAIL_ONLY` |
| C5 | Deferred to user - reviewed | Amplify persists tokens in `localStorage`; refresh token 30 days; session restore on cold start with splash; reload persistence proven in mock. Needs a real iOS/Android home-screen check |

### D. API

| ID | Result | Evidence |
|---|---|---|
| D1 | Pass | `handler.test.ts` health returns 200 `{status:"ok"}` with no auth; template route `GET /api/health` has `AuthorizationType: NONE` |
| D2 | Pass | Unit test returns `{userId,email,householdId}` from verified claims; test "ignores any household id supplied in the request" (query + body). Household comes from the verified ID-token claim `custom:householdId` (admin-writable only), consistent with D-014 |
| D3 | Pass | `GET /api/me` has `AuthorizationType: JWT`, issuer `https://cognito-idp.ap-southeast-2.amazonaws.com/<pool>`, audience = app client; `/api/health` has none |
| D4 | Deferred to user - reviewed | API Gateway JWT authoriser rejects missing/malformed/expired tokens with 401 before the Lambda; the web client signs out on any 401 (unit tested) |
| D5 | Pass | Missing or invalid household claim returns 403 `NO_HOUSEHOLD`; access token returns 403 `FORBIDDEN`; thrown errors return a generic 500 without detail. Web shows the NO_HOUSEHOLD state (E2E) |

### E. Web shell

| ID | Result | Evidence |
|---|---|---|
| E1 | Pass | E2E: fields, "Sign in", "Forgot password?", inline wrong-credential alert, validation messages, button disabled and "Signing in..." while submitting, password toggle, locked and expired banners |
| E2 | Pass | E2E: `new@example.com`/`TempPass1` shows rules list, weak password and mismatch shown inline, success lands on Lists with toast; refresh mid-challenge returns to sign-in with the timeout notice |
| E3 | Pass | E2E: request code -> code + new password -> `/sign-in` with email prefilled, success banner, Password focused; wrong and short code errors; resend throttled |
| E4 | Pass | E2E: 4-link `nav[aria-label=Main]` fixed at viewport bottom, exactly one `aria-current="page"`, each tab shows its title and placeholder, deep link plus reload works |
| E5 | Pass | E2E: Settings shows email and version; confirm sheet (initial focus Cancel, focus trap, Esc, scrim, Cancel); Sign out returns to `/sign-in` and protected routes redirect |
| E6 | Pass | E2E: `/`, `/search`, `/templates`, `/settings` all redirect to `/sign-in` when signed out; after sign-in returns to the deep-linked page |
| E7 | Pass | E2E at 390 px: no horizontal scroll (all tabs, auth screens, long email); every visible link, button and input is at least 44x44 (detector sanity-checked); axe (WCAG 2 A/AA + best-practice) has no serious or critical violations on sign-in (idle and error), forgot-password (both steps), new-password, Lists/Search/Templates, Settings, sign-out sheet open, no-household state |
| E8 | Pass | `lang="en-AU"`, title "Trolley"; grep of UI copy finds no US spellings; copy uses "Unauthorised" etc. |
| E9 | Pass | E2E (non-mock server, `/config.json` intercepted): HTTP 500, aborted request, and incomplete JSON each show "Trolley couldn't start" with Try again; Try again recovers once config loads. No Cognito jargon shown |
| E10 | Deferred to user - reviewed | `viewport-fit=cover`; `--safe-*` insets from `env()` applied to app bar, content, nav and sheet. Needs a real notch/home-bar device check |

### F. CI/CD

| ID | Result | Evidence |
|---|---|---|
| F1 | Pass | `ci.yml` on `pull_request` (and non-main pushes): install, lint, typecheck, test, build, synth. QA added an e2e step |
| F2 | Pass | `deploy.yml` on push to `main` (and manual): install, lint, typecheck, test, build, then `aws-actions/configure-aws-credentials@v4` with `vars.AWS_DEPLOY_ROLE_ARN`, then `cdk deploy`; `permissions: id-token: write, contents: read`. No AWS keys or secrets in `.github` |
| F3 | Pass | `concurrency: deploy-production` with `cancel-in-progress: false`; `AWS_REGION`/`aws-region` fixed to `ap-southeast-2` |
| F4 | Deferred to user - reviewed | Workflow, variables and role chain are consistent with SETUP.md. Cannot be run here |

### G. Docs and one-off setup

| ID | Result | Evidence |
|---|---|---|
| G1 | Pass | SETUP steps 1-3 give bootstrap, `TrolleyGithubOidcStack` deploy (trust `repo:mcnamee/shopping:ref:refs/heads/main`) and the four variables, matching those used in `deploy.yml`. Verified in a fresh clone: `npm ci -w @trolley/infra` then `cdk synth TrolleyGithubOidcStack` succeeds even with no web build present |
| G2 | Pass | Step 4: ACM cert in us-east-1, validation CNAME, `CERTIFICATE_ARN`, CNAME `trolley -> <distribution>.cloudfront.net` |
| G3 | Pass | Step 6 (`create-user.sh` for both users with the same household id), Step 6b Bedrock access. Budget email: SETUP says no subscription confirmation is needed (AWS Budgets emails directly), which differs from the criterion wording - see INFO-2 |
| G4 | Pass | README "Develop": `npm ci`, lint, typecheck, test, `dev:mock`. (README does not yet mention `npm run e2e`) |

### H. Cost and security

| ID | Result | Evidence |
|---|---|---|
| H1 | Pass | Budget USD 5/month, 80% actual and 100% forecast, email `ALERT_EMAIL` from setting. `-c requireAlertEmail=true` (used by `deploy.yml`) without an email fails: "ALERT_EMAIL is required for deploy: ..." |
| H2 | Pass | Grep of tracked files: no AWS keys, no real account IDs (only dummy `123456789012` in tests/docs), no real emails (only `example.com`). `.env*` ignored; `.env.example` has no values |
| H3 | Pass | API role is explicit (no managed policy): `logs:CreateLogStream/PutLogEvents` on its own log group; DynamoDB item/query actions on the table ARN and `/index/*` only. No `*` actions. Note INFO-3 for the CDK helper Lambda role |
| H4 | Pass | Deploy role only has `sts:AssumeRole`/`TagSession` on `cdk-hnb659fds-*-role-<acct>-*`; no admin policy; trust pins `aud=sts.amazonaws.com` and `sub=repo:mcnamee/shopping:ref:refs/heads/main` |
| H5 | Pass | Resource types: no NAT, Route 53, Secrets Manager, WAF; DynamoDB on-demand; Cognito Lite; Lambda/HTTP API/CloudFront pay per use |
| H6 | Deferred to user - reviewed | Budget created when `ALERT_EMAIL` set. Cost Explorer check is post-deploy |

Totals: 47 criteria. **Pass 40, Fail 0, Deferred 7** (C3, C4, C5, D4, E10, F4, H6).

### Extra checks (not criteria)

- **CSP vs built app**: served `apps/web/dist` with the exact CSP and security headers from the synthesised `ResponseHeadersPolicy`, a stub `/config.json`, SPA rewrite and a 401 `/api` stub. `/sign-in` renders, `/settings` redirects to `/sign-in`, service worker registers, and a real sign-in attempt reaches `cognito-idp` (a 400 from the fake pool, which proves `connect-src` allows it). **No CSP violations or console errors** other than that expected 400.
- **Other-household data access**: no data endpoints exist in Stage 0. The only authenticated route derives the household from verified claims and ignores request input (unit test); the app client cannot write `custom:householdId`.
- **Concurrent ticking**: not applicable in Stage 0 (no lists).
- **Auth expiry**: the web client signs out on API 401 (unit test; the mock's in-page API made an end-to-end version impractical). Offline and back-online banners verified in E2E.
- **Empty states and units**: placeholder pages and NO_HOUSEHOLD state verified; units (each/kg/L) are Stage 1+.

## 3. Defects and findings

| ID | Severity | Summary | Repro |
|---|---|---|---|
| DEF-QA-001 | Low - **Fixed** (92f541d) | Forgot-password Code field: `maxlength=6` truncates pasted text before non-digits are stripped, so pasting `123 456` gives `12345` (UX spec says strip non-digits on paste) | Mock dev: `/forgot-password`, send code, paste `123 456` into Code. Expected `123456`, got `12345`. Covered by the `test.fail()` case in `e2e/exploratory.e2e.ts`; remove `test.fail()` once fixed. Suggested fix: drop `maxLength`, strip then `slice(0, 6)` in `onChange` |
| DEF-QA-002 | Low - **Fixed** (92f541d) | `scripts/create-user.sh` usage text is cut off mid-sentence (`sed -n '2,9p'` should cover the whole header comment, about lines 2-12) | Run `scripts/create-user.sh` with no arguments: output ends at "that is what" |
| DEF-QA-003 | Low - **Closed** (E7 reworded) | Playwright's iPhone 13 profile viewport is 390x664, while E7 says 390x844. Width is what matters and passes; PM may want to reword E7 | n/a |
| INFO-1 | Info - **Accepted** (D-022) | `npm audit`: 3 moderate advisories (`minimatch` via `workbox-build`, build-time only). Not exploitable in the shipped app | `npm audit` |
| INFO-2 | Info - **Closed** (G3/H6 reworded) | Criteria G3/H6 mention "confirming the budget email subscription", but AWS Budgets email notifications need no confirmation and SETUP.md says so. SETUP is correct; reword the criterion | Read SETUP step 3 vs `stage-0.md` G3/H6 |
| INFO-3 | Info - **Accepted** (D-023); Node note fixed | The CDK-generated BucketDeployment helper role uses the `AWSLambdaBasicExecutionRole` managed policy and `cloudfront:CreateInvalidation` on `*` (AWS requires it). H3 is scoped to our API Lambda, which is clean. Also SETUP Step 0 says Node 20+ is enough while `engines` is `>=22 <23` (npm only warns) | Inspect the synthesised IAM policies |

No product code was changed. Files added or changed by QA: `apps/web/e2e/*`, `apps/web/playwright.config.ts`, `apps/web/package.json` (`e2e` script, devDependencies, typecheck covers `e2e/`), `package-lock.json`, `.github/workflows/ci.yml`, this report.

## 4. Recommendation

Stage 0 meets every [S] criterion. Fix DEF-QA-001 and DEF-QA-002 when convenient (neither blocks the stage), then proceed to deployment so the user can verify C3, C4, C5, D4, E10, F4 and H6.

## 5. Sign-off (product-manager, 2026-11-22)

**Verdict: Stage 0 [S] criteria signed off.** 40/40 [S] pass, 0 fail. Stage 0 is complete once the user confirms the [U] checklist below after the first deploy (C3, C4, F4 and E10 are required by "Done when"; C5, D4 and H6 are expected but not stage-blocking unless they fail).

Re-verified after QA, at commit 92f541d: lint, typecheck, 126/126 unit tests, 53/53 E2E (DEF-QA-001 case now passes normally, no `test.fail()`).

**Resolved since QA**
- DEF-QA-001 fixed (code field no longer truncates on paste/autofill).
- DEF-QA-002 fixed (`create-user.sh` prints the full usage text).
- DEF-QA-003 closed: E7 reworded to a 390 px wide viewport.
- INFO-2 closed: G3 and H6 reworded (AWS Budgets needs no email confirmation).
- README documents `npm run e2e`; SETUP.md says Node 22 (INFO-3 note).

**Accepted risks** (docs/DECISIONS.md)
- INFO-1: 3 moderate `npm audit` advisories via `workbox-build` (build-time only) - D-022.
- INFO-3: CDK-generated BucketDeployment helper role (managed basic-execution policy, `cloudfront:CreateInvalidation` on `*`) - D-023.

**Deferred UX gaps** (docs/BACKLOG.md, not blocking): no splash "Try again" on network-only session-restore failure; no distinct "same as temporary password" message; return-to-page after sign-in excludes `/settings`.

### User verification checklist (after the first merge to `main`)
Tick each, on both phones where noted. Report any failure and it becomes a Stage 0 fix before Stage 1.

- [ ] **F4** GitHub Actions "deploy" run on `main` is green; the `AppUrl` output (CloudFront URL) loads the Trolley sign-in screen.
- [ ] **C3** (both users) Invite email arrives; sign in with email + temporary password; you are made to choose a new password; you land on Lists.
- [ ] **C4** (one user is enough) Sign out, tap "Forgot password?", code arrives by email, reset works, sign in with the new password.
- [ ] **E10** (both phones) Add to home screen; open it. Header and bottom nav clear the notch and home bar; all four tabs work; nothing scrolls sideways.
- [ ] **C5** (both phones) Close the home-screen app fully, reopen it later: still signed in (iOS Safari and Android Chrome).
- [ ] **D4** Open `<AppUrl>/api/me` in a browser (no token): you see a 401 / "Unauthorized" response, not data.
- [ ] **H6** AWS console -> Billing and Cost Management -> Budgets: `trolley-monthly` exists with your alert email. After about a week, Cost Explorer shows ~USD 0.
- [ ] Custom domain (optional, if `CERTIFICATE_ARN` set): https://trolley.mcn.am loads with a valid padlock.
- [ ] Before Stage 1: tell us your ALDI state (D-005).
