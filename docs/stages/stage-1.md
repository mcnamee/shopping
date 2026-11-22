# Stage 1 - Catalogue and search: acceptance criteria

Goal: searching "milk" shows ALDI milk (Casey, ACT range) with images, and the quantity modal handles each/kg/L correctly.
Decisions: see docs/DECISIONS.md (D-005, D-025 to D-027). AWS is not set up yet (Stage 0 undeployed), so [U] items wait for the first deploy; [S] items gate sign-off of the build.

**Verification tags**
- **[S]** in session: lint, typecheck, unit tests, CDK assertion tests, API integration tests (DynamoDB Local or in-memory fake), scraper tests against recorded ALDI fixtures (no live calls in CI), Playwright at 390 px (iPhone 13) against local dev with mocked auth and seeded catalogue.
- **[U]** post-deploy by user, on real phones / AWS console.

## Out of scope (Stage 2+)
Lists, templates (beyond a stub action), editing aisle order or category mapping, per-household unit-override persistence, price history, offline cache, AI, MCP.

## A. Scraper (services/scraper)
- A1 [S] Crawls the ALDI AU product API category by category, following paging until the last page; fixture test covers a multi-page category.
- A2 [S] Throttled to <= 1 request/second (unit test with fake clock); retries transient errors (5xx, timeout, 429) with backoff, max 3 attempts per request; 4xx other than 429 is not retried.
- A3 [S] Store is config (`ALDI_STORE_ID` or equivalent), default Casey, ACT (D-005); no store hardcoded elsewhere.
- A4 [S] Products are deduped by SKU across categories (a product listed in 2 categories is stored once).
- A5 [S] Upsert by SKU sets name, brand, category, image URL, price, pack size text, unitType, `lastSeenAt`; a product seen again clears any `discontinued` flag and resets its missed-run count.
- A6 [S] A product missing from 1 run is still active; missing from 2 consecutive successful runs is marked `discontinued`. Nothing is ever deleted.
- A7 [S] Each run writes a run record: start/end time, status (`succeeded` | `failed` | `aborted`), counts (fetched, new, updated, unchanged, discontinued, errors), store.
- A8 [S] Abort-safety: if a run fetches < 50% of the previous successful run's product count, it writes no product changes, marks nothing discontinued, records status `aborted`, and exits with an error (triggers A11). First-ever run is exempt.
- A9 [S] Local CLI dry run (`npm run scrape -- --dry-run [--fixtures]`) prints the same counts without writing to DynamoDB; documented in README.
- A10 [S] Assertion (amended per D-042): the monthly scrape is `scrape-fallback.yml` on a GitHub runner, scheduled for the 1st of the month and writing only when `SCRAPE_FALLBACK_ENABLED=true`. The AWS EventBridge schedule `cron(0 3 1 * ? *)` (`Australia/Sydney`) is opt-in (`awsScrapeSchedule` / `AWS_SCRAPE_SCHEDULE=true`), default off, and when enabled targets the scraper Lambda; Lambda timeout and memory sufficient for a full crawl (documented estimate).
- A11 [S] Assertion (amended per D-042): when the AWS schedule is enabled, a CloudWatch alarm on scraper errors (failed or aborted run) -> SNS topic with email subscription to `ALERT_EMAIL` from config. A failed or aborted GitHub fallback run fails the workflow (GitHub emails the repo owner).
- A12 [S] `.github/workflows/scrape.yml` has `workflow_dispatch` ("Scrape now") that invokes the deployed scraper via the OIDC role (no keys); the role is allowed `lambda:InvokeFunction` on the scraper only.
- A13 [S] Fallback documented in `docs/SETUP.md`: if ALDI blocks AWS IPs, a scheduled GitHub Actions job runs the scraper CLI from the runner and writes to DynamoDB via OIDC; how to switch over is copy-paste steps.
- A14 [S] Scraper Lambda role: read/write on the table only; no `*` actions.
- A15 [U] (amended per D-042) A live scrape loads >= 1,000 products into the production catalogue and the run record shows sensible counts. ALDI blocks AWS IPs, so this is met by the GitHub runner fallback (done 22 Nov 2026: seeded the live catalogue).
- A16 [U] (amended per D-042) The scheduled monthly GitHub fallback scrape (`SCRAPE_FALLBACK_ENABLED=true`) fires on the 1st and succeeds (checked after the first 1st of the month post-deploy).

## B. Product model (packages/core)
- B1 [S] `inferUnitType(packSizeText)` unit tests cover at least: "per kg" / "kg" loose -> `kg`; "per 100g" -> `g`; "2L" -> `pack`; "500mL" -> `pack`; "6 pack" / "x 12" -> `pack`; "each" / blank / unparseable -> `each`; loose litre products -> `L`. Matches spec 3.2 table.
- B2 [S] ALDI category -> household group mapping with default groups (e.g. Fruit & Veg, Meat & Seafood, Dairy & Eggs, Bakery, Pantry, Frozen, Drinks, Household, Health & Beauty, Baby, Pet, Other); every ALDI category in the fixtures maps to a group, unknown categories map to `Other`.
- B3 [S] Default aisle order (typical ALDI layout) exported as data and returned per household until Stage 2 adds editing.

## C. Search API (all authed, household resolved server-side)
- C1 [S] `GET /api/products/search?q=&category=&cursor=` returns `{ items, nextCursor }`; each item has sku, name, brand, imageUrl, price, packSize, unitType, group, `custom` flag. Page size 20.
- C2 [S] Ranking: exact word match in name > word-prefix match in name > brand-only match; ties broken by name. Fixture test: `q=milk` returns "Full Cream Milk 2L" before "Milky Bar" before a product matching only on brand. Case- and diacritic-insensitive.
- C3 [S] `category` filters by household group; empty `q` with a category browses that group; cursor paging returns no duplicates or gaps.
- C4 [S] Discontinued products never appear in search results; `GET /api/products/:sku` still returns them with `discontinued: true`.
- C5 [S] `GET /api/products/:sku` returns 404 with an error code for unknown SKUs, and for another household's custom product.
- C6 [S] `POST /api/products/custom` (name required, 1-80 chars; optional brand, group, unitType, packSize) creates a household-scoped product; validation errors return 400 with field messages.
- C7 [S] Household isolation: integration test with two households - custom products of one never appear in the other's search or `:sku` lookup; any householdId in input is ignored.
- C8 [S] Routes have the Cognito JWT authoriser (assertion); no-token request returns 401.
- C9 [S] p95 < 500 ms warm for search over a 3,000-product catalogue (local benchmark of the handler, 100 queries); [U] spot-check in the deployed app feels instant.

## D. Search UI (Search tab)
- D1 [S] 2-column grid of cards: image, title, price and pack size, primary "Add" button, subtle add-to-template icon with accessible label.
- D2 [S] Type-ahead: debounced (~250 ms), one request per pause (not per keystroke), stale responses never overwrite newer ones.
- D3 [S] Category filter chips (horizontal scroll) including "All"; selected chip is visually and programmatically indicated (`aria-pressed` or equivalent).
- D4 [S] States: initial (prompt to search), loading (skeletons), error (message + "Try again"), no results ("No matches for 'x'" + "Add 'x' as a custom item").
- D5 [S] Image fallback: broken or missing image shows a placeholder; layout does not shift.
- D6 [S] Infinite scroll or "Load more" fetches the next page; end of results is indicated.
- D7 [S] Add-to-template icon shows toast "Templates arrive in Stage 2" (D-026).
- D8 [S] Custom product: from no-results, a form prefilled with the query (name, optional group and unit type) creates the product, which then appears in search with a "Custom" badge.
- D9 [U] Real ALDI images load on both phones; searching "milk" shows ALDI milk.

## E. Quantity modal (opened by "Add")
- E1 [S] Opens as a bottom sheet with product name/image; quantity, unit, optional note (max 200 chars).
- E2 [S] `each` and `pack`: stepper, step 1, minimum 1, default 1.
- E3 [S] `kg`: step 0.25, presets 0.5/1/1.5/2 kg; `g`: step 100, presets 250/500/1000 g. Minimum one step; no floating-point display errors (e.g. 0.75, not 0.7500001).
- E4 [S] `L`: step 0.5, presets 1/2/3 L; `mL`: step 250, presets 250/500/1000 mL.
- E5 [S] Unit override: user can change unit (e.g. each -> kg); step, presets and default reset to the new unit's rules. Override is not persisted in Stage 1.
- E6 [S] Confirm closes the modal and shows toast "Added 1.5 kg Potatoes - lists arrive in Stage 2" (exact qty/unit/name shown; nothing persisted) (D-026). Cancel / swipe-down / Escape closes without toast.
- E7 [S] Focus moves into the sheet on open, is trapped while open and returns to the "Add" button on close; controls have labels.

## F. Accessibility, mobile and quality
- F1 [S] Playwright at 390 px: no horizontal page scroll (chips scroll within their row), tap targets >= 44 px, axe has no serious/critical violations on Search (results, no-results, error) and the open modal.
- F2 [S] Images have alt text (product name); toasts are announced (`role="status"`); copy is Australian English.
- F3 [S] Lint, typecheck, all tests and `cdk synth` pass; `npm audit` re-checked (D-022).
- F4 [S] No new fixed-cost resources (H5 of Stage 0 still holds); no secrets or store credentials in the repo.

## Done when
All [S] criteria pass in QA's report. After the first deploy, the user confirms A15, D9 and C9 [U]; A16 is confirmed after the first scheduled run and does not block sign-off.
