# Trolley - Product Spec

Household shopping list app for two users, optimised for shopping at ALDI Australia from a phone, with AI-assisted list generation and a chatbot (MCP) integration.

Status: **Draft v1.1 - 2026-11-22** (Stage 0 and Stage 1 decisions applied; see docs/DECISIONS.md). Owner: Product Manager agent.
URL: https://trolley.mcn.am (fallback: CloudFront URL). Region: ap-southeast-2.

---

## 1. Goals and non-goals

**Goals**
- Create the weekly list in under 2 minutes (AI pre-fill + templates).
- Shop from one screen: grouped by aisle, tick into trolley, auto-archive when done.
- Add items by voice/chat from Claude or ChatGPT ("add tissues").
- Run for ~$0-3/month on serverless AWS, deployed only via GitHub Actions.

**Non-goals (v1)**
- Multiple households, public sign-up, price tracking/budgeting, multiple stores, native apps (PWA instead), offline-first editing (read-only offline cache is in scope later).

## 2. Users and auth

- 2 users (you and your wife), one **household**. Every record is scoped to `householdId`.
- Invite-only: self sign-up disabled; users created by an admin script/CLI.
- Authorisation: all API calls require a valid JWT; the household is derived from the token, never from the request body. Single role (`member`) in v1.

## 3. Functional requirements

### 3.1 Product catalogue (ALDI)
- Monthly scheduled job pulls ALDI AU product data (name, brand, SKU, category, image URL, price, pack size/unit) into the DB. Upsert by SKU; products missing from 2 consecutive runs are marked `discontinued` (kept for history).
- Users can also add **custom products** (e.g. butcher items, non-ALDI) so the app never blocks them.
- Search: type-ahead, results in a **2-column grid** - image, title, primary **Add** button, subtle **+template** icon.

### 3.2 Quantity model
Each product has a `unitType` that drives the quantity modal:

| unitType | Input | Step | Example |
|---|---|---|---|
| `each` | stepper | 1 | 6 x bananas |
| `pack` | stepper | 1 | 2 x 1kg mince |
| `kg` / `g` | stepper + presets | 0.25 kg / 100 g | 1.5 kg potatoes |
| `L` / `mL` | stepper + presets | 0.5 L / 250 mL | 2 L milk |

- Default `unitType` inferred from scraped pack-size text (e.g. "per kg" -> `kg`, "2L" -> `pack` of 2L). User can override per product (stored as a household preference).
- Modal: quantity, unit (if overridable), optional note, target list (current list / a template).

### 3.3 Templates
- Fields: name, `type` (`weekly` | `meal`), items (product, qty, unit, note).
- CRUD from a Templates screen and via the +template icon on search results.
- Applying a template to a list merges items (sum quantities if the same product already exists).

### 3.4 Shopping lists
- States: `active` -> `archived`. One or more active lists allowed; one is flagged "this week".
- Create: blank, from template(s), or **Auto-generate** (3.5).
- Items: edit qty, add note ("get white if red is out of stock"), delete, tick/untick.
- **Shop mode** (default list view): items grouped by category, groups ordered by the household's aisle order, ticked items drop to the bottom of their group (greyed). Large tap targets, one-glance view.
- When all items are ticked: confirm toast -> list archived with `completedAt`. Archived lists are read-only and feed purchase history.
- Both phones see changes: refetch on focus + 10 s polling while in shop mode (good enough for 2 users; no websockets needed).

### 3.5 AI auto-generate
- Button on new and existing lists: "Suggest items".
- Inputs: the household's purchase history (archived lists), the `weekly` template(s), current list contents, today's date.
- Process:
  1. **Deterministic pass (no AI):** compute per-product stats - purchase count, average qty, median interval between purchases, days since last purchase. Items "due" (days since last >= ~0.8 x median interval) become candidates. Add all `weekly` template items.
  2. **LLM pass:** send compact stats + candidates to a cheap Bedrock model (Amazon Nova Micro, configurable; D-061) to rank, sanity-check quantities and give a one-line reason ("usually every ~4 weeks, last bought 27 days ago").
  3. Remove anything already on the list.
- Output is shown as a **review sheet** (pre-ticked suggestions with reason + qty) -> user confirms -> added. Never silently writes.
- Cold start (< 3 archived lists): template items only + note explaining suggestions improve over time.
- Works without AI: if Bedrock fails or takes > 8 s, the deterministic result is shown (D-062). LLM sees product names and stats only, output is validated against the candidates (D-065). Max 20 runs/household/day (D-066).
- Also on the New list sheet: "Start with suggestions" (D-064). Acceptance criteria: `docs/stages/stage-3.md`.

### 3.6 Settings
- Aisle order: drag-and-drop list of categories (defaults seeded from a typical ALDI layout).
- Category mapping: ALDI categories map to household groups (e.g. "Fresh Produce" -> Fruit & Veg); editable.
- Product unit overrides; connected chatbot apps (view/revoke).

### 3.7 Chatbot integration (MCP)
- Remote MCP server (Streamable HTTP) with OAuth 2.1, usable from Claude (custom connector) and ChatGPT (connectors/apps).
- Tools:
  - `add_item(text, quantity?, unit?, note?)` - resolves "tissues" to the household's usual product (most-purchased match in history, else best catalogue match), adds to this week's active list, creating an empty one if none exists. Returns what was added.
  - `get_current_list()` - items grouped by category.
  - `remove_item(text)`; `search_products(query)` (for disambiguation).
- If ambiguous with no history (e.g. 3 tissue types, never bought), return options so the chatbot asks the user.

## 4. Feasibility

| Area | Verdict | Notes / risk |
|---|---|---|
| Serverless AWS stack | **High** | All services below are GA and have permanent free allowances that cover 2 users. |
| ALDI product data | **Medium** | aldi.com.au renders its range from a JSON product-search API used by the site; several third-party scrapers rely on it. Not a public/official API: format can change and bot protection may block cloud IPs. ALDI's terms should be checked - this is personal, low-volume (once a month, throttled) use. **Mitigations:** custom products always available; scraper isolated behind an adapter; fallback to running it from a GitHub Actions scheduled job; failures alert by email and never wipe existing data. |
| AI suggestions | **High** | Mostly deterministic maths; LLM only ranks/explains. Amazon Nova Micro on Bedrock (APAC cross-region profile) costs cents per month; no Anthropic use-case form (D-061). |
| MCP + auth for Claude & ChatGPT | **Medium-High** | Both clients support remote MCP with OAuth. Claude supports Dynamic Client Registration (DCR) and a manual client ID/secret; ChatGPT relies on DCR or predefined clients. Cognito does **not** support DCR, so we build a small OAuth authorisation-server shim (DCR + PKCE) in Lambda that delegates the actual login to Cognito. This is the most complex piece - Senior Engineer owns it. |
| Two-phone sync | **High** | Polling is sufficient at this scale. |
| PWA "add to home screen" | **High** | Works on iOS Safari and Android Chrome. |

## 5. Architecture

```
 Phone (PWA)  ──HTTPS──▶ CloudFront ──▶ S3 (React static build + /config.json)
                            │ /api/*, /mcp, /oauth/* (same origin, no CORS)
                            └─JWT──▶ API Gateway (HTTP API, Cognito JWT authoriser) ──▶ Lambda (api) ──▶ DynamoDB (single table)
                                                                     └──────────▶ Bedrock (Nova Micro) [suggest]
 Claude / ChatGPT ──OAuth──▶ API Gateway /oauth/* ──▶ Lambda (oauth shim) ──▶ Cognito Hosted UI (login)
                  ──Bearer─▶ API Gateway /mcp     ──▶ Lambda (mcp)        ──▶ DynamoDB
 EventBridge Scheduler (monthly) ──▶ Lambda (scraper) ──▶ ALDI site ─▶ DynamoDB
 GitHub Actions ──OIDC role──▶ CDK deploy (no long-lived AWS keys)
```

| Concern | Choice | Why |
|---|---|---|
| Frontend | React + TypeScript + Vite, Tailwind, PWA (vite-plugin-pwa), TanStack Query | Mobile-first, fast, cheap static hosting |
| Hosting | S3 + CloudFront (Origin Access Control) | Free-tier/flat-rate free plan covers this usage |
| Auth | Amazon Cognito user pool (Lite tier, 10k MAU free), email username, self sign-up off; in-app login form via `aws-amplify/auth` (no Hosted UI redirect, D-012) | Managed, no servers; reliable in iOS home-screen PWA |
| API | API Gateway HTTP API + Lambda (Node 22, TypeScript) | 1M Lambda requests/month free; HTTP API is pennies |
| Database | DynamoDB on-demand, single table | 25 GB always free; no patching |
| AI | Amazon Bedrock (Amazon Nova Micro, model id via CDK context, D-061) | IAM auth, no API key to manage, pay-per-token |
| Scheduling | EventBridge Scheduler | 14M invocations/month free |
| Secrets | SSM Parameter Store (standard, SecureString) | Free (vs Secrets Manager $0.40/secret) |
| IaC | AWS CDK (TypeScript) | One language across stack |
| CI/CD | GitHub Actions: lint/test on PR; deploy on merge to `main` via OIDC | Requirement: GitHub deploys, not Claude |
| Monitoring | CloudWatch logs (7-day retention) + one alarm on scraper failure -> SNS email | Within free tier |

**Repo layout (monorepo, npm workspaces)**
```
apps/web          React PWA
services/api      Lambda handlers (REST)
services/mcp      MCP server Lambda
services/oauth    OAuth shim Lambda
services/scraper  ALDI scraper Lambda
packages/core     domain logic, DynamoDB repo, shared types, suggestion engine
infra             CDK app
.github/workflows ci.yml, deploy.yml
```

### 5.1 Data model (DynamoDB single table)

| Entity | PK | SK | Notes |
|---|---|---|---|
| Product (catalogue) | `PRODUCT#<sku>` | `META` | GSI1 for category browse; search via prefix tokens or in-memory index (catalogue is ~2-3k items, so the API Lambda can cache it and search in memory) |
| Custom product | `HH#<hh>` | `PRODUCT#<id>` | |
| Household prefs | `HH#<hh>` | `SETTINGS` | aisle order, category map, unit overrides |
| Template | `HH#<hh>` | `TEMPLATE#<id>` | items embedded (small) |
| List | `HH#<hh>` | `LIST#<id>` | status, weekOf, completedAt; GSI on status |
| List item | `HH#<hh>#LIST#<id>` | `ITEM#<id>` | separate rows so two phones can tick concurrently without overwriting |
| Purchase history | `HH#<hh>` | `PURCHASE#<sku>#<date>` | written on archive; feeds suggestions and MCP "usual product" |
| OAuth clients/codes/tokens | `OAUTH#...` | ... | TTL attribute for expiry |

### 5.2 Cost estimate (monthly)

| Item | Estimate |
|---|---|
| Lambda, API Gateway, DynamoDB, Cognito, CloudFront, S3, Scheduler | $0 - $0.50 |
| Bedrock Nova Micro (approx. 30 runs x ~4k tokens; hard cap 20 runs/day) | < $0.10 |
| Custom domain trolley.mcn.am (external DNS, ACM cert free) | $0 |
| **Total** | **~$0-1/month** |

Note: AWS accounts created after July 2025 use the new credit-based free plan for the first 6 months; the "always free" allowances for Lambda, DynamoDB, Cognito and CloudFront continue after that. Set an AWS Budget alert at $5 in Stage 0.

## 6. Non-functional requirements
- Mobile-first, works one-handed; tap targets >= 44 px; usable in bright store lighting (high contrast).
- p95 API latency < 500 ms (except AI suggest, < 15 s with a loading state).
- Security: least-privilege IAM per Lambda; all data household-scoped; OAuth tokens short-lived (1 h) with refresh and revocation; no secrets in repo.
- Accessibility: WCAG 2.1 AA for core flows.
- Tests: unit tests for domain logic (quantity, suggestion engine, merge rules); API integration tests against DynamoDB Local; Playwright mobile-viewport E2E for core flows.

## 7. Release stages

Each stage is sized to fit one working session and ends deployable. Each stage follows: **PM** refines acceptance criteria -> **UX** designs screens (where UI changes) -> **Engineers** build -> **QA** tests against acceptance criteria -> **PM** signs off.

### Stage 0 - Foundations
- Monorepo scaffold, lint/format/test tooling.
- CDK stack: S3 + CloudFront, Cognito (invite-only), HTTP API with JWT authoriser, DynamoDB table, health endpoint.
- GitHub Actions: `ci.yml` (PR checks), `deploy.yml` (main -> AWS via OIDC). Budget alarm.
- Web: login/logout shell, bottom navigation (Lists, Search, Templates, Settings).
- **Your one-off manual steps:** create AWS account, run CDK bootstrap once, create the GitHub OIDC role (we provide a script), add repo variables, request Bedrock model access.
- **Done when:** both of you can log in on your phones at https://trolley.mcn.am (or the CloudFront URL). Criteria: docs/stages/stage-0.md.

### Stage 1 - Catalogue and search
- ALDI scraper Lambda + monthly schedule + manual "run now" workflow; category seed; custom products.
- Search screen (2-column grid), quantity modal with unit types.
- Store: Casey, ACT (D-005). No lists yet, so the modal's confirm shows a toast (D-026).
- **Done when:** searching "milk" shows ALDI milk with images and the modal handles each/kg/L correctly. Criteria: docs/stages/stage-1.md.

### Stage 2 - Lists and templates (MVP - usable in store)
- Templates CRUD (weekly/meal), add-to-template from search.
- Lists: create blank / from template, edit qty, notes, delete, tick, auto-archive, history view.
- Grouping by category, aisle-order settings, polling sync.
- **Done when:** you can do a real ALDI shop from the app.

### Stage 3 - AI auto-generate
- Purchase-history records, suggestion engine (deterministic), Bedrock ranking, review sheet UI, cold-start behaviour.
- **Done when:** after a few archived lists, "Suggest items" proposes sensible weekly + periodic items with reasons, excluding items already on the list.

### Stage 4 - Chatbot (MCP)
- OAuth shim (metadata discovery, DCR, authorise via Cognito, token, refresh, revoke), MCP Lambda with tools, connected-apps settings.
- **Done when:** "add tissues to my shopping list" in Claude and ChatGPT adds your usual tissues to this week's list.

### Stage 5 - Recipes
- Mela-style household recipes (photo, tags, times, ingredients, method), cooking view with keep-screen-on, selected ingredients to a list as free-text lines. Criteria: docs/stages/stage-5.md (D-103 to D-110).

### Later - Polish (optional, pick and choose)
- Offline read cache for shop mode, install prompt, dark mode, list sharing link, price display/estimated total, meal planner (pick meals -> merge meal templates).

## 8. Open questions for you
1. ~~App name / custom domain~~ - Trolley at trolley.mcn.am (D-001, D-004).
2. ~~Region~~ - ap-southeast-2 (D-002).
3. ~~ALDI store/state~~ - Casey, ACT (D-005).
5. ~~CNAME the domain straight to S3?~~ - no; CloudFront + free ACM cert stays (D-025).
4. ~~Bedrock OK?~~ - yes (D-003).

## 9. Sources consulted
- Third-party ALDI AU scrapers confirming the site's product data is programmatically accessible: https://apify.com/solidcode/aldi-com-au-scraper
- Claude connector auth (DCR and manual client credentials): https://claude.com/docs/connectors/building/authentication
- OpenAI plugin/connector auth (DCR, predefined clients, PKCE): https://developers.openai.com/plugins/build/auth.md
