# Stage 5 QA - Recipes and free-text lines

Branch `claude/elegant-ride-dzzdob` at ed90bf8. Run once: lint, typecheck, test (all workspaces, 0 failures; 287+249+71+355+56 tests), build, synth all pass. e2e: 135 passed, **1 failed** (deterministic, re-run to confirm; see D1). No screenshots taken (e2e writes the detail shot). No tests added: existing API, core, mock, CDK and e2e coverage already hits every risk area below.

## Criteria
| ID | Result | Evidence |
|---|---|---|
| A1 5-tab nav, 360/390 px, deep link | Pass | e2e nav fits at 360 and 390 |
| B1 field limits, 400 names field | Pass | stage5.recipes.test (limits), core recipes.test |
| B2 summaries, PUT 409 STALE, PATCH favourite, LIMIT 500 | Pass | api tests |
| B3 household isolation | Pass | another household's id is 404 on every route; foreign photoKey rejected; household comes from claims only |
| B4 presign conditions, replace/remove/delete cleans photo | Pass | photos.test pins key, `image/jpeg`, 1..3 MB / 300 KB, `Cache-Control`, 300 s; key must match `recipes/<hh>/<uuid>.jpg`; stale update does not delete |
| B5 /media via OAC, private bucket, CSP, CORS | Pass | CDK assertions: BLOCK_ALL, SSL-only, retained; CORS POST from `https://<domain>` only; connect-src adds only the bucket regional host; role limited to Put/Delete on `media/recipes/*`; no SPA rewrite |
| C1-C3 list, search, chips, empty state | Pass | recipes.test, e2e |
| D1-D4 editor, photo, discard, delete | Pass (S) | unit and e2e; real camera is [U] |
| E1-E3 detail, parsers, wake lock | Pass (S) | text rendered as React text, no HTML sink; source link `http(s)` only (server and client), `rel="noopener noreferrer"`. Wake lock on a real phone is [U] |
| F1-F4 add to list, merge, chunks, undo | Pass | merges only on identical collapsed text, unticks, notes joined; bulk undo leaves merged lines; LIMIT reported |
| G1 text rows, edit, re-key merge | Pass | api + ShopRow tests |
| G2 no purchase rows, no suggestions, offline queue | Pass | archive/Finish shop/reopen tests; suggestions exclude `kind: text` and a text line named like a product does not hide it; mock-stage5 offline tick replay |
| G3 MCP and Siri | Pass | quoted text, no quantity, remove_item matches text, Siri reads unticked |
| H1 suite green | **Fail** | D1 |
| H1 Lighthouse a11y, npm audit | Deferred | not run this pass (axe serious/critical checks pass in e2e) |
| H2, H3 | Deferred [U] | needs deploy |

## Defects
- **D1 (Medium, blocks green suite) e2e fails on recipe detail.** `apps/web/e2e/recipes.e2e.ts:59` -> `expectTapTargets` reports `input "INPUT" 1x1`: the "Keep screen on" switch in `RecipeDetailPage.tsx:177` is a `sr-only` checkbox (added in ed90bf8). The whole label row is `min-h-tap` and tappable, so real use is fine, but the check (and strict a11y reading) fails. Repro: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e -w @trolley/web -- --trace off -g "pass axe, tap targets"`. Fix either by making the input fill the label (absolute inset-0, opacity-0) or by excluding sr-only inputs in the helper.
- **D2 (Low) Two recipes can share one photoKey.** POST/PUT only check the key format and household, not that it is unused, so a client (or a retried save) can attach the same key to two recipes; deleting or replacing one then deletes the other's image. Not reachable from the UI. Suggest ignoring a previous key still referenced elsewhere, or accept (two-user household, D-105).
- **D3 (Info, accepted by D-105/B-026)** `photo-upload` has no rate limit and abandoned uploads are orphans; save does not HEAD the object.

## Release recommendation
Do not merge until D1 is fixed and the e2e suite is green (small change, no product behaviour risk). D2 can ship as is. Security posture of photos, isolation and free-text paths is sound. After deploy:
- [U] Add a recipe with a photo taken on the iPhone camera at trolley.mcn.am; it uploads (CSP/CORS live), shows on the other phone, and replacing or deleting the recipe makes the old `/media/...` URL 403/404.
- [U] Open a recipe and cook with Keep screen on: screen stays on for about 10 minutes; toggling off lets it sleep.
- [U] "Add to list" sends ingredients to this week's list; they appear under sensible aisles in shop mode, tick (also offline) and Undo works.
- [U] Ask Claude/Siri for the list: text lines read sensibly.
