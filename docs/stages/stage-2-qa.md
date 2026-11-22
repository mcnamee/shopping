# Stage 2 - QA report

Branch `claude/elegant-ride-dzzdob`. Tester: qa-tester. Nothing deployed; no product code changed.

**Verdict: all 46 [S] criteria Pass. 0 blockers, 0 high or medium defects. 1 low defect (QA-1) and 3 informational findings (section 4). K1 and K2 [U]: Deferred to user - reviewed.**

## 1. Test runs

| Check | Result |
|---|---|
| `npm ci` | OK. `npm audit`: 3 moderate (build-time, same as Stage 1) |
| `npm run lint` (eslint + prettier) | Clean |
| `npm run typecheck` | 0 errors (all 5 workspaces, incl. e2e tsconfig) |
| `npm test` | **621 passed**: core 156, api 111 (incl. 3 QA gap tests), scraper 57, web 260, infra 37 |
| `npm run build` | OK (PWA precache 16 entries; 553 kB main chunk warning, informational) |
| `npm run synth` | OK |
| E2E, full suite, iPhone 13 (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e -w @trolley/web -- --trace off`) | Run 1: 103/103. Run 2: 103/103. Run 3 (after adding 6 QA tests): **109/109**, ~2.1 min. No flake in three runs |

Tests added: `services/api/src/stage2.qa-gaps.test.ts` (3) and `apps/web/e2e/stage2-qa.e2e.ts` (6, exploratory: bottom-of-list reach, redundant pack size, modal layout at 390x664 and 390x844, concurrent ticks, delete then leave screen).

## 2. Lead-flagged visual issues

| Item | Result | Evidence |
|---|---|---|
| (a) FAB overlaps last rows in shop mode | **Not reproduced.** Pass | 63-item list scrolled to the bottom: last row bottom y=487, FAB top y=520, nav top y=599. Last row clickable and ticks. `main` has `pb-[calc(56px+32px)]`. Screenshot `a-long-list-bottom.png` |
| (b) Redundant "per kg" | **Confirmed**, low (QA-1) | Rows read "Garlic per kg / per kg / 0.1 kg" (4 seeded per-kg rows). Same pattern for names ending in the size, e.g. "Brioche Hot Dog Rolls 6 Pack 270g / 270 g", "Full Cream Milk 2L / 2 L". Screenshot `b-shop-top.png` |
| (c) Quantity modal and edit sheet tall | **Not reproduced.** Pass | At 390x844 the modal is 677 px, no internal scroll; Note bottom y=527, "Adding to" y=679, confirm button y=760, Cancel visible. At 390x664 (Playwright iPhone 13 default viewport) the sheet is 598 px with scrollHeight = clientHeight: everything still fits, Note bottom y=426, confirm y=580. Edit sheet likewise fits at both. Screenshots `c-qty-modal-844.png`, `c-qty-modal-664.png`, `c-edit-sheet-844.png`, `c-edit-sheet-664.png` |

Screenshots: `/tmp/claude-0/-home-user-shopping/8e252ed6-4540-5359-9d43-d654ea5e1540/scratchpad/stage2-qa/` (not committed).

## 3. Criteria

| ID | Result | Evidence |
|---|---|---|
| A1 | Pass | `trolley-stack.test.ts` asserts JWT on every authed route; new QA test: all 27 Stage 2 routes return 401 with no token. `stage2.isolation-concurrency.test.ts`: two-household 404s on every id route incl. guessed ids and ignored `householdId`. QA gap test adds the id-less routes (this-week, aisle order, history, finish/reopen, purchase rows): nothing crosses households |
| A2 | Pass | Validation and limit tests in `stage2.lists.test.ts` / `templates-settings.test.ts` and core parsers (D-052 reading of "multiple of step") |
| A3 | Pass | Snapshot tests (D-047); history and templates render from snapshot |
| A4 | Pass | Key-shape assertions in the API tests (`LIST#`/`ITEM#`, `THISWEEK` pointer D-056, `SETTINGS`, `PURCHASE#`) |
| B1 | Pass | `templates.e2e.ts` filter chips, empty state; sort in core tests |
| B2 | Pass | `templates.e2e.ts` rename, delete with confirm |
| B3 | Pass | Template editor tests; edits survive reload (mock persists to localStorage) |
| B4 | Pass | Merge tests (D-046) in core and API |
| B5 | Pass | `search.e2e.ts` / `templates.e2e.ts` "Added ... to Tacos" |
| C1 | Pass | Search e2e confirm persists; Undo removes or reverts merge |
| C2 | Pass | `POST /api/this-week/items` tests incl. concurrent creation keeps one list |
| C3 | Pass | Target picker e2e; button label "Add to Week of 23 Nov" seen in screenshot |
| C4 | Pass | "two phones adding the same product at once merge into one row" |
| C5 | Pass | Settings e2e "remembered from the modal" plus J2 flow applying the remembered unit |
| D1 | Pass | `lists.e2e.ts` Lists tab |
| D2 | Pass | New list sheet e2e; merged count |
| D3 | Pass | Add to list from templates, merged count with Undo |
| D4 | Pass | Pointer design D-056; API tests (exactly one flag, archive clears, first auto-flagged) |
| D5 | Pass | Rename and delete list tests |
| D6 | Pass | Edit sheet e2e, prefilled; Save updates row |
| D7 | Pass | Swipe delete with Undo; QA test: delete then leave the screen before the toast ends still deletes (DELETE fires on unmount; row gone on return) |
| D8 | Pass | "Add items" opens Search with the list as target |
| E1 | Pass | Layout e2e: groups in aisle order, empty groups hidden, header "n of m ticked". Aisle reorder shown in shop mode (settings e2e) |
| E2 | Pass | Rows >= 56 px, bold qty, pack size, note. See QA-1 for redundancy and INFO-2 for note truncation |
| E3 | Pass | `role=checkbox` + aria-checked, strike-through, reorder; untick restores |
| E4 | Pass | Sticky header with "7/63" pill and progress bar (screenshot) |
| E5 | Pass | axe, tap-target and no-horizontal-scroll checks on shop mode, Lists, History, Templates, Settings in e2e (run x3) |
| E6 | Pass | E2E measures 15 consecutive ticks each < 100 ms (criterion says 30; INFO-3) |
| F1 | Pass | Auto-archive + 8 s Undo e2e; undo does not re-archive until a later completing tick (QA also saw the final-untick path) |
| F2 | Pass | Finish shop confirm; QA API test: finish with 1 of 2 ticked writes exactly 1 purchase row |
| F3 | Pass | "ticking the last two items at the same moment archives exactly once" |
| F4 | Pass | QA API test: finish -> 1 row, reopen -> 0 rows, re-finish -> 1 row (no duplicates); archived list rejects item writes with 409 |
| F5 | Pass | History e2e read-only; API 409 `LIST_ARCHIVED` |
| G1 | Pass | Settings e2e: arrows, drag, persists, shop mode follows, reset with Undo, failed save rolls back |
| G2 | Pass | Remembered units: list, forget with Undo, modal falls back |
| H1 | Pass | Focus/visibility refetch and 10 s poll e2e (visibilitychange); polling stops hidden |
| H2 | Pass | 50 interleaved ticks, concurrent ticks lose neither (API). The two-page Playwright tick (QA) also kept both ticks (7 of 21), but note it runs on the localStorage mock (INFO-1) |
| H3 | Pass | API 409 `STALE` with `current`; e2e "stale edits show the latest" |
| H4 | Pass | Two-context e2e: tick on A shows on B within 11 s; add on B appears on A after focus |
| I1 | Pass | Mocked 500 rollback with toast; offline rollback (`lists.e2e.ts:274`, `settings.e2e.ts:95`) |
| I2 | Pass | Offline banner in shop mode; load-error views with Try again |
| J1 | Pass | Section 1 |
| J2 | Pass | `templates.e2e.ts:122` full flow template -> list -> add with remembered unit -> tick all -> archived -> History |
| J3 | Pass | No new fixed-cost resources; GSI2 justified in D-057; 200-item list p95 test < 500 ms (in-memory); "never scans" test |
| J4 | Pass | Spot check of copy ("Shop complete - list archived", "Adding to", "Week of 23 Nov"); no US spellings found in `lists/` and `settings/` |
| K1 | Deferred to user - reviewed | Build this week's list from a weekly template plus search in under 5 min. Flow is short in the mock |
| K2 | Deferred to user - reviewed | Real ALDI shop on two phones. Risks to watch in store: QA-1, INFO-1 |

Count: 46 [S] sub-criteria (A1-A4, B1-B5, C1-C5, D1-D8, E1-E6, F1-F5, G1-G2, H1-H4, I1-I2, J1-J4), all Pass. K1-K2 [U] deferred.

## 4. Defects and findings

| ID | Severity | Description and repro |
|---|---|---|
| QA-1 | Low | Redundant pack size on rows. Sign in (mock), open "Week of ..." list: "Garlic per kg" shows a second line "per kg"; names ending in the size ("Full Cream Milk 2L" with "2 L") repeat it too. Suggest hiding the pack-size line when the product name already ends with it (case/space-insensitive) |
| INFO-1 | Info | The two-page concurrent tick in Playwright uses the shared localStorage mock (read-modify-write per request), so it proves the UI sync, not DynamoDB atomicity; atomicity is proven by the API tests (H2, F3). Real two-phone behaviour is the K2 check |
| INFO-2 | Info | The meta line (pack size, note) is `truncate` (one line). A long note such as "approx. 0.854 kg · Thick cut if they have it" can be cut with an ellipsis on a narrow phone; the full note is in the edit sheet. Not a criterion failure |
| INFO-3 | Info | D-058 known gap (untick landing between the strongly consistent re-read and the archive update archives with the earlier snapshot) is accepted and untested; E6 e2e ticks 15 rows, not 30; a 401 mid-shop uses the shared client handler (E2E-tested only from Search) |

Not defects (checked): FAB and nav never cover the last row; modal Note, "Adding to" and confirm are visible without scrolling at 390x844; remembered units reach search and the modal; aisle order applied to shop mode; delete-then-leave persists; auto-archive then Undo then re-tick re-archives.
