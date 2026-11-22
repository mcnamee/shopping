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
| `services/api` | API Lambda (tiny router; routes in `src/routes.ts`, products in `src/products/`) |
| `services/scraper` | ALDI AU catalogue scraper: library, Lambda handler and CLI |
| `packages/core` | Domain logic and shared types (household context, DynamoDB keys, products, unit types, groups, search) |
| `infra` | AWS CDK app (`TrolleyStack`, one-off `TrolleyGithubOidcStack`) |
| `scripts` | Admin scripts (`create-user.sh`) |
| `.github/workflows` | `ci.yml` (PR checks), `deploy.yml` (main -> AWS via OIDC), `scrape.yml` (Scrape now), `scrape-fallback.yml` (runner scrape if ALDI blocks AWS) |

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

In mock mode the Search tab is backed by ~60 real ALDI products (`apps/web/src/api/fixtures/products.ts`)
plus seeded custom products. Search for `__error` to see the error state, `__slow` for loading skeletons.

## ALDI catalogue scraper

Runs monthly in AWS (1st, 03:00 Sydney) and on demand via **Actions -> Scrape now**. Locally:

```bash
# Offline, against the recorded fixtures in services/scraper/test/fixtures (no network)
npm run scrape -w @trolley/scraper -- --dry-run --fixtures

# Live, polite sample: 12 products per top-level category (~23 requests, ~35 s)
NODE_USE_ENV_PROXY=1 npm run scrape -w @trolley/scraper -- --dry-run --max-per-category 12 --out sample.json

# Full live dry run (~75 requests at 1 request/second, ~2 minutes)
npm run scrape -w @trolley/scraper -- --dry-run --out products.json
```

`--dry-run` never touches DynamoDB; it prints the run record (counts, unitType distribution,
unmapped categories) and `--out` writes the mapped products. Other options: `--service-point
G526|none` (ALDI store; default Casey ACT), `--categories <key,key>`, `--max-products N`,
`--interval-ms N` (minimum 500). `NODE_USE_ENV_PROXY=1` is only needed behind an HTTPS proxy.
Without `--dry-run` the CLI writes to `TABLE_NAME` with the same safety rules as the Lambda
(used by the fallback workflow). How the ALDI API works: docs/DECISIONS.md D-030 to D-033.

Deployment happens only via GitHub Actions on merge to `main`. Never run `cdk deploy
TrolleyStack` by hand.
