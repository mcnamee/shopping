# Status / handoff (2026-11-22)

## Where things are
- **Stage 0**: built, QA'd, PM signed off. `main` = 94b9671 (Stage 0 + Stage 1 docs). Not yet live.
- **Stage 1** (catalogue, scraper, search UI): built on `claude/elegant-ride-dzzdob`. QA was **interrupted** mid-run - partial QA test work committed as WIP (search paging E2E + mock `__many` seam). No `docs/stages/stage-1-qa.md` yet. PM sign-off pending.
- User AWS setup done: CDK bootstrap, TrolleyGithubOidcStack (from branch at 0eaf17f, includes D-041 trust fix + scrape-now invoke permission), repo variables, default branch = main. `AWS_SCRAPE_ROLE_ARN` not needed yet (fallback role not created - TrolleyStack table didn't exist).

## First deploy - current blocker
Run 44979466972 (main): OIDC auth now works (D-041). CloudFormation failed creating
`UserPool/WebClient` (infra/lib/trolley-stack.ts ~L92): **"Invalid write attributes specified while creating a client"** (Cognito 400).
Likely cause: the app client's `writeAttributes` set (which excludes `custom:householdId`) is invalid - e.g. includes a non-writable attribute such as `email_verified`, or omits a required attribute. Fix in trolley-stack.ts, add an assertion test, then get it onto `main`.

## Next session - do in order
1. Fix the Cognito `writeAttributes` error (senior-engineer). Check whether the failed create left a stack in ROLLBACK_COMPLETE (CDK normally replaces it) and RETAIN'd orphans (user pool, table, bucket) - user may need to delete them in the console before redeploying.
2. Decide how to ship: either cherry-pick the fix onto `main` (Stage 0 only) or finish Stage 1 QA + PM sign-off and merge the branch to `main`.
3. Resume Stage 1 QA (qa-tester) -> PM sign-off.
4. After a green deploy: create users (scripts/create-user.sh), CNAME `trolley` -> CloudFront domain (if CERTIFICATE_ARN set), confirm SNS alert email, run "Scrape now", user [U] checklists (stage-0-qa.md section 5, stage-1.md).

## Housekeeping
- Actions warn Node 20 is deprecated for actions/checkout@v4, setup-node@v4, configure-aws-credentials@v4 - bump to current majors.
- Backlog: docs/BACKLOG.md (B-001..B-004).
