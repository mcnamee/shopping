# Stage 1 - QA report

Branch `claude/elegant-ride-dzzdob`. Tester: qa-tester. Stage 1 was merged and deployed to production at the user's request before this QA (see section 5); this report is retrospective.

**Verdict: all 45 [S] criteria pass (A10/A11 pass in their D-042 opt-in form). 0 blockers, 0 high or medium defects; 1 low and 2 informational findings (section 4). [U] items reviewed; A15 (Lambda form), D9 and C9 are partly confirmed in production (section 5).**

## 1. Test runs

| Check | Command | Result |
|---|---|---|
| Install | `npm ci` | OK. `npm audit`: 3 moderate (build-time `glob`/`minimatch`); `npm audit --omit=dev`: 0 (INFO-1) |
| Lint + Prettier | `npm run lint` | Clean |
| Typecheck | `npm run typecheck` | 0 errors |
| Unit and integration | `npm test` | **410 passed**: core 123, api 57, scraper 57, web 139, infra 34 |
| Build | `npm run build` | OK, PWA precache 16 entries |
| Synth | `npm run synth` | OK (TrolleyStack, TrolleyGithubOidcStack) |
| E2E | `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e -w @trolley/web -- --trace off` | **80 passed / 80** at iPhone 13 (390 px), 1.3 min, no flake. 27 are Stage 1 (`search.e2e.ts`) plus 10 in `search-paging.e2e.ts` (paging, error, stale, images, focus, note limit, scrim, 401, drag) |

Reused from the interrupted run: `apps/web/e2e/search-paging.e2e.ts`, the mock `__many` seam in `apps/web/src/api/mock.ts`, `services/api/src/products/qa-isolation.test.ts`. No product code changed. Gaps checked and found already covered: infinite scroll to end-of-results, load-more error with Try again, and drag-to-dismiss (long drag dismisses, short drag springs back, no toast).

## 2. Lead rulings accepted

- Note max 200 characters (E1 says "max 200"; enforced and E2E-tested).
- Product images use `alt=""` because the title is adjacent; E2E verifies the card and Add button accessible names include the product name (F2 reading: images decorative, name conveyed). Accepted.
- UI page size 24 (API default 20 per C1; D-034 default 20, max 48). Accepted; E2E confirms first page 24 then the rest with no duplicates.
- Search errors are inline only (grid kept, message + Try again). Accepted.
- D-042 supersedes A10/A11 as written: the AWS schedule and alarm are opt-in.

## 3. Criteria

### A. Scraper

| ID | Result | Evidence |
|---|---|---|
| A1 | Pass | `crawl-run.test.ts` "pages each category to the end..."; empty-page stop |
| A2 | Pass | Fake-clock throttle and retry tests (`aldi-client.test.ts`): <= 1 req/s, 3 attempts, 5xx/timeout/429 retried, other 4xx and 403/HTML not retried (D-032) |
| A3 | Pass | `ALDI_SERVICE_POINT` env/CLI/CDK context, default G526 Casey (D-030); store id not hardcoded elsewhere |
| A4 | Pass | SKU dedupe across categories test |
| A5 | Pass | Upsert/reactivation test in `crawl-run.test.ts` L188 |
| A6 | Pass | Same test: 1 miss active, 2 successful misses discontinued, never deleted; failed runs do not advance misses |
| A7 | Pass | Run record tests in `store.test.ts` and `crawl-run.test.ts` (status, counts, store) |
| A8 | Pass | < 50% aborts with no writes; exactly 50% accepted; baseline is last succeeded run; first run exempt |
| A9 | Pass | Dry-run test writes nothing; documented in README |
| A10 | Pass (changed by D-042) | Schedule `cron(0 3 1 * ? *)` Australia/Sydney asserted when enabled; asserted absent by default |
| A11 | Pass (changed by D-042) | Alarm + SNS email asserted when enabled; asserted absent when schedule off or no `alertEmail` |
| A12 | Pass | `scrape.yml` workflow_dispatch, OIDC, main-only guard; deploy role has `lambda:InvokeFunction` on `trolley-scraper` only (oidc test L59) |
| A13 | Pass | Fallback documented in `docs/SETUP.md`; `scrape-fallback.yml` exists |
| A14 | Pass | Scraper role: Query on GSI1 and `SCRAPE#*`, BatchWrite/Put limited by `dynamodb:LeadingKeys` to `PRODUCT#*`/`SCRAPE#*`; no Delete/Update/Scan, no `*` actions (infra test L271). Fallback role is not created by default and has the same narrowness |
| A15 | Deferred [U], partly confirmed | Lambda scrape from AWS FAILED: ALDI Akamai 403. Fallback (GitHub runner) succeeded and seeded the live catalogue. Criterion as written (from AWS IPs) cannot pass; accepted via D-042 |
| A16 | Deferred [U] | Moot while the AWS schedule is off; replaced by the monthly `scrape-fallback.yml` (needs `SCRAPE_FALLBACK_ENABLED=true`); not blocking |

### B. Product model

| ID | Result | Evidence |
|---|---|---|
| B1 | Pass | `unit-type.test.ts` covers the listed forms. Spot check of 27 products from the fixtures (fruit-veg, meat, milk, bakery, liquor): "1 each" -> each; "2 Pack"/"5 each" -> pack; "1 kg", "280 g", "2 l", "750 mL" fixed sizes -> pack (D-039); random-weight "approx. 0.8 kg per package" -> pack; no size ("Prosecco DOC") -> each. No fixture contains loose weightType 3, so kg/g/L loose rules rest on unit tests. All 27 consistent with D-039 and spec 3.2. Note B1's "2L -> pack" matches |
| B2 | Pass | `groups.test.ts`: every fixture category maps; unknown -> Other |
| B3 | Pass | `DEFAULT_GROUPS` in ALDI walk order, served by `GET /api/groups` |

### C. Search API

| ID | Result | Evidence |
|---|---|---|
| C1 | Pass | `products.test.ts`; field is `groupId` (D-040); page size 20 |
| C2 | Pass | `search-quality.test.ts`: exact > prefix > brand-only, head-noun bonus, case/diacritic-insensitive, ties by name then SKU |
| C3 | Pass | Group filter, empty q browse, cursor paging without dups or gaps |
| C4 | Pass | Discontinued excluded from search, `:sku` returns `discontinued: true` |
| C5 | Pass | 404 with error code for unknown SKU and other household's custom product |
| C6 | Pass | 1-80 char name, 400 with field messages; max 500 custom per household (D-040) |
| C7 | Pass | `qa-isolation.test.ts` two-household test: search, `:sku`, input householdId ignored |
| C8 | Pass | JWT authoriser asserted on routes; no token -> 401 |
| C9 | Pass [S] / Deferred [U] | D-034 records < 10 ms per query over 3,000 products. Live feel: see section 5 |

### D. Search UI

| ID | Result | Evidence |
|---|---|---|
| D1 | Pass | E2E "searching milk": 2-column grid, Add button, template icon with label |
| D2 | Pass | One request per pause, single character ignored; stale slow response never overwrites newer |
| D3 | Pass | Chips with `aria-pressed`, tap again returns to All, URL state |
| D4 | Pass | Initial, skeleton, error with Try again, no results with custom item; axe clean |
| D5 | Pass | Broken image placeholder, no layout shift |
| D6 | Pass | Infinite scroll, end-of-results message, load-more error recovers |
| D7 | Pass | Toast "Templates arrive in Stage 2" above nav |
| D8 | Pass | No results -> sheet prefilled -> save -> quantity modal -> Custom badge in search |
| D9 | Deferred [U] | See section 5 |

### E. Quantity modal

| ID | Result | Evidence |
|---|---|---|
| E1 | Pass | Bottom sheet dialog; note capped at 200 |
| E2 | Pass | each/pack stepper, min 1, default 1, no presets |
| E3 | Pass | kg 0.25 step with presets and exact values; g covered by seeded custom products and `quantity.test.ts` |
| E4 | Pass | L and mL via seeded custom products and unit tests |
| E5 | Pass | Unit override resets step, presets and default; not persisted |
| E6 | Pass | Confirm toast with exact amount; Cancel, Escape, scrim tap, drag-down dismiss with no toast |
| E7 | Pass | Focus in, trapped, returns to opener (E2E for quantity and custom sheets) |

### F. Accessibility and quality

| ID | Result | Evidence |
|---|---|---|
| F1 | Pass | 390 px: no horizontal scroll, tap targets >= 44 px, axe no serious/critical on results, no-results, error and modal |
| F2 | Pass (ruling) | `alt=""` ruling accepted, accessible names include product; toasts `role="status"`; copy in Australian English |
| F3 | Pass | Lint, typecheck, tests, synth pass; audit re-checked (INFO-1) |
| F4 | Pass | No new fixed-cost resources (scheduler and alarm now optional); secret scan (AKIA, private keys, key assignments) over the repo found nothing; no store credentials; ALDI UA is honest and carries no contact details |

Workflow review: `scrape-fallback.yml` manual runs default `dry_run: true`; the schedule runs only when `vars.SCRAPE_FALLBACK_ENABLED == 'true'` and then writes; the dry-run path needs no AWS access. `scrape.yml` refuses non-main refs.

### Exploratory

- Empty states (initial, no results, empty category): pass.
- Units each/kg/L/g/mL via seeded custom products: pass.
- Auth expiry: a 401 from search signs out and returns to sign-in (E2E).
- Other-household data: pass (C5, C7).
- Concurrent ticking from two sessions: not applicable in Stage 1 (no lists); carry to Stage 2. Custom products: the other phone sees a new one within 60 s (D-034 cache), by design.

## 4. Defects and findings

| ID | Severity | Description |
|---|---|---|
| INFO-1 | Info | `npm audit`: 3 moderate (`glob` -> `minimatch`), dev/build-time only; 0 in `--omit=dev`. Fix with `npm audit fix` when convenient |
| INFO-2 | Info | A15 as written (Lambda from AWS IPs) cannot pass because ALDI blocks AWS. Recommend PM amend A10/A11/A15/A16 to the D-042 wording |
| LOW-1 | Low | No fixture holds a loose `weightType 3` product, so the loose-kg mapping through `mapProduct` is not covered end to end (unit inference tests cover it). Repro: grep fixtures for `"weightType": "3"`. Suggest adding a recorded loose-produce fixture next scrape |

No defects block sign-off.

## 5. Production facts and [U] status

- AWS Lambda scrape blocked by ALDI (Akamai 403); D-042 made the AWS schedule and alarm opt-in, default off.
- GitHub runner fallback scrape succeeded and seeded the live catalogue; the user signed in on the live site.
- Confirmed in production: catalogue loaded (the substance of A15, via the fallback), sign-in. Not explicitly confirmed: D9 (images and "milk" on both phones) and C9 feel; the user should tick these. A16 open and non-blocking.
