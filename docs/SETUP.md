# Trolley - one-off AWS and GitHub setup

This guide gets Trolley running in your own AWS account. You only do it once. After
that, every merge to `main` deploys automatically through GitHub Actions - nothing is
ever deployed from a laptop or an AI session.

Everything below runs in **AWS CloudShell** (a terminal in your browser, already logged
in to your AWS account), so you don't need to install anything on your computer.

Time needed: about 30-45 minutes, most of it waiting.

---

## What you need

- An AWS account you can sign in to as an administrator.
- Admin access to the GitHub repository `mcnamee/shopping` (to set repository variables).
- An email address for cost alerts.
- Optional: access to the DNS settings for `mcn.am` if you want `https://trolley.mcn.am`.

## Step 0 - open CloudShell in Sydney

1. Sign in to the AWS console.
2. In the top-right region picker choose **Asia Pacific (Sydney) ap-southeast-2**.
3. Click the CloudShell icon (a `>_` symbol) in the top bar. Wait for the prompt.
4. Note your 12-digit account ID (top-right menu, or run the command below):

   ```bash
   aws sts get-caller-identity --query Account --output text
   ```

5. Check Node.js is version 20 or newer:

   ```bash
   node -v
   ```

   If it's older, install Node 22:

   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   source ~/.bashrc
   nvm install 22
   ```

## Step 1 (a) - bootstrap CDK (once per account and region)

CDK needs a small "bootstrap" stack (an S3 bucket and some deploy roles) before it can
deploy anything:

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
npx -y aws-cdk@2 bootstrap "aws://$ACCOUNT_ID/ap-southeast-2"
```

Wait for `Environment aws://.../ap-southeast-2 bootstrapped`.

## Step 2 (b) - create the GitHub deploy role

This creates a role that **only** GitHub Actions running on the `main` branch of
`mcnamee/shopping` can use, and that can only hand work to the CDK bootstrap roles. No
long-lived AWS keys are stored in GitHub.

```bash
git clone https://github.com/mcnamee/shopping.git
cd shopping
npm ci -w @trolley/infra
cd infra
npx cdk deploy TrolleyGithubOidcStack
```

- If the repository is private, `git clone` will ask for a username and password: use
  your GitHub username and a [fine-grained personal access token](https://github.com/settings/personal-access-tokens)
  with read-only "Contents" access to this repository as the password.
- Type `y` when CDK asks to confirm the IAM changes.
- If it fails with "Provider with url https://token.actions.githubusercontent.com already
  exists", your account already has the GitHub OIDC provider. Re-run with:
  ```bash
  npx cdk deploy TrolleyGithubOidcStack \
    -c existingOidcProviderArn=arn:aws:iam::$ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com
  ```

At the end CDK prints an output like:

```
TrolleyGithubOidcStack.DeployRoleArn = arn:aws:iam::123456789012:role/trolley-github-deploy
```

Copy that ARN for the next step. (You can also find it later in CloudFormation ->
`TrolleyGithubOidcStack` -> Outputs.)

## Step 3 (c) - set GitHub repository variables

In GitHub: **mcnamee/shopping -> Settings -> Secrets and variables -> Actions ->
Variables tab -> New repository variable**. These are *variables*, not secrets (none of
them are secret).

| Name | Value | Required |
|---|---|---|
| `AWS_ACCOUNT_ID` | your 12-digit account ID | yes |
| `AWS_DEPLOY_ROLE_ARN` | the `DeployRoleArn` from step 2 | yes |
| `ALERT_EMAIL` | where AWS Budget alerts go (USD 5/month budget; alerts at 80% actual and 100% forecast) | recommended - no budget is created without it |
| `CERTIFICATE_ARN` | ACM certificate ARN from step 4 | only for a custom domain |

`ALERT_EMAIL` is required for deploys: the Deploy workflow stops with a clear error if it
is missing, so the app never runs without a cost alarm. AWS Budgets emails it directly -
there is no subscription to confirm. After the first deploy you can check it in the AWS
console under **Billing and Cost Management -> Budgets -> trolley-monthly**.

## Step 4 (d) - optional: custom domain `trolley.mcn.am`

Skip this if you're happy with the `https://dxxxxxxxxxxxx.cloudfront.net` address. You
can add it at any time later.

1. In the AWS console switch the region to **US East (N. Virginia) us-east-1** (CloudFront
   only accepts certificates from this region).
2. Open **Certificate Manager -> Request -> Request a public certificate**.
   Domain name: `trolley.mcn.am`. Validation: **DNS validation**. Request.
3. Open the certificate. Under **Domains** copy the CNAME name and value.
4. At your DNS provider for `mcn.am`, add that CNAME record exactly as shown.
5. Wait until the certificate status is **Issued** (usually 5-30 minutes).
6. Copy the certificate ARN (`arn:aws:acm:us-east-1:...:certificate/...`) and set it as
   the `CERTIFICATE_ARN` GitHub variable.
7. After the next deploy (step 5), add one more DNS record at your DNS provider:
   - Type `CNAME`, name `trolley`, value = the `CloudFrontDomainName` output
     (e.g. `d1234abcd.cloudfront.net`).

To use a different domain, change `context.domainName` in `infra/cdk.json` (and request
the certificate for that name).

## Step 5 (e) - deploy

Merge the pull request into `main` (or push to `main`). The **Deploy** workflow:

1. runs lint, type checks, tests and the web build;
2. signs in to AWS through the OIDC role (no keys);
3. runs `cdk deploy TrolleyStack`.

Watch it under the repository's **Actions** tab. The first deploy takes ~10-15 minutes
(CloudFront is slow to create). The job summary shows the stack outputs, including:

- `AppUrl` - the address to open on your phones
- `CloudFrontDomainName` - for the custom-domain CNAME
- `UserPoolId` - used by the user script below

You can re-run a deploy any time from **Actions -> Deploy -> Run workflow** (on `main`).

## Step 6 (f) - create the two user accounts

Sign-up is invite-only. In CloudShell (Sydney region), from the `shopping` folder:

```bash
cd ~/shopping
git pull
scripts/create-user.sh you@example.com our-home
scripts/create-user.sh partner@example.com our-home
```

- The second argument is the **household id**. **Both of you must use exactly the same
  household id** - that's what makes you share the same lists. Use 3-64 letters, digits,
  `-` or `_` (e.g. `our-home`). It can't be changed from the app.
- Each person gets an email from AWS with a temporary password, valid for 7 days. On first
  sign-in the app asks them to choose their own password (at least 8 characters with
  upper case, lower case and a number).
- Invite expired? `scripts/create-user.sh you@example.com our-home --resend`

## Step 6b - request Bedrock model access (needed from Stage 3)

AI suggestions use Claude through Amazon Bedrock in your account. Do this once, any time
before Stage 3:

1. In the AWS console (Sydney region) open **Amazon Bedrock -> Model access** (or **Model
   catalog**, depending on the console version).
2. Request access to an **Anthropic Claude Haiku** model. Fill in the short use-case form
   (e.g. "personal shopping list suggestions").
3. Wait for the status to show **Access granted** (usually minutes).

## Step 7 (g) - add Trolley to your home screen

Open the `AppUrl` and sign in, then:

- **iPhone (Safari):** tap the Share button -> **Add to Home Screen** -> Add.
- **Android (Chrome):** tap the three-dot menu -> **Add to Home screen** (or **Install
  app**) -> Install.

Trolley now opens full screen like a normal app.

---

## Costs and safety

- Expected cost is ~USD 0-1/month. The budget emails you at USD 4 actual or USD 5
  forecast.
- The database and user pool are **retained** if the stack is ever deleted, so lists and
  accounts are never lost by accident.
- The GitHub role can only be used from the `main` branch of `mcnamee/shopping`.

## Troubleshooting

| Problem | Fix |
|---|---|
| Deploy fails at "Configure AWS credentials" with "Not authorized to perform sts:AssumeRoleWithWebIdentity" | Check `AWS_DEPLOY_ROLE_ARN`; make sure the workflow ran on `main` (other branches are refused by design). |
| Deploy fails with "SSM parameter /cdk-bootstrap/hnb659fds/version not found" | Step 1 (bootstrap) wasn't run in ap-southeast-2. |
| `create-user.sh` says it can't find `UserPoolId` | The first deploy hasn't finished, or you're in the wrong region (use Sydney). |
| Signed in but the app says your account isn't set up | The user was created without `custom:householdId`; delete the user in Cognito and re-run `create-user.sh`. |
