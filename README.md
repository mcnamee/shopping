# Trolley

Household shopping list PWA for two people, tuned for shopping at ALDI Australia. Serverless
on AWS (CloudFront + S3, Cognito, API Gateway HTTP API + Lambda, DynamoDB), deployed only by
GitHub Actions.

- Product spec and release stages: [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md)
- One-off AWS/GitHub setup: [docs/SETUP.md](docs/SETUP.md)

## Layout

| Path | What |
|---|---|
| `apps/web` | React + Vite + Tailwind PWA |
| `services/api` | API Lambda (tiny router; routes in `src/routes.ts`) |
| `packages/core` | Domain logic and shared types (household context, DynamoDB keys) |
| `infra` | AWS CDK app (`TrolleyStack`, one-off `TrolleyGithubOidcStack`) |
| `scripts` | Admin scripts (`create-user.sh`) |
| `.github/workflows` | `ci.yml` (PR checks), `deploy.yml` (main -> AWS via OIDC) |

## Develop

Requires Node 22 (`nvm use`).

```bash
npm ci
npm run lint        # ESLint + Prettier check
npm run typecheck
npm test            # Vitest in every workspace (incl. CDK assertion tests)
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e -w @trolley/web  # Playwright E2E (mock auth); PW_CHROMIUM_PATH optional
npm run build       # web build -> apps/web/dist
npm run synth       # cdk synth (needs the web build first)
npm run format      # Prettier write
```

Run the web app locally:

```bash
# No AWS needed: mock auth + in-browser mock API (see apps/web/src/auth/mock.ts)
npm run dev:mock -w @trolley/web

# Against a deployed stack: copy apps/web/.env.example to apps/web/.env.local and fill in
npm run dev -w @trolley/web
```

Deployment happens only via GitHub Actions on merge to `main`. Never run `cdk deploy
TrolleyStack` by hand.
