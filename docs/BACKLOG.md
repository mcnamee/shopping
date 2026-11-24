# Backlog

Small items deferred from signed-off stages. Highest priority first. Pull into a stage when it touches the same area.

| # | Priority | Item | Origin | Why deferred |
|---|---|---|---|---|
| B-001 | Medium | Splash shows "Try again" when session restore fails only because of the network (today it falls back to sign-in, so an offline cold start looks like being signed out). | Stage 0 engineer gap | Tokens are kept; signing in again works. Do with Stage 5 offline/shop mode, or earlier if users hit it in store. **Done (D-102).** |
| B-002 | Low | Return to the deep-linked page after sign-in should include `/settings` (currently excluded, lands on Lists). | Stage 0 engineer gap | One extra tap; rare path. **Done: /settings and sub-pages honoured (D-100).** |
| B-003 | Low | Set-new-password: distinct message when the new password equals the temporary password (today a generic error). | Stage 0 engineer gap | Happens once per user, at first sign-in. **Done: client-side check against the temp password typed at sign-in (D-100).** |
| B-004 | Medium | Quantity modal: "Remember {unit} for this product" checkbox (household unit override, spec 3.2, docs/ux/quantity-modal.md section 4). Hidden in Stage 1; the pure quantity logic is already in `packages/core/src/quantity.ts`. | Stage 1 UI | Needs the Stage 2 household settings store to persist the override. Build with Stage 2 lists (see the TODO in `apps/web/src/search/QuantityModal.tsx`). |
| B-005 | Low | Record a loose-produce (`weightType 3`) ALDI fixture so `mapProduct` loose -> `kg` is covered end to end (QA LOW-1, D-045). | Stage 1 QA | Unit inference tests already cover the rule. Do when next touching the scraper. **Done: recorded bananas (weightType 3) fixture already existed; test now covers every weightType 3 fixture end to end. A fresh api.aldi.com.au fetch returned 403 from this sandbox, so no second product was added.** |
| B-006 | Medium | Offline shop mode: read cache plus queued ticks that replay on reconnect (Stage 2 only shows clear offline/error states). | Stage 2 cut (D-051) | Polling + optimistic UI is enough for a store with signal; spec puts offline in Stage 5. **Done (D-102).** |
| B-009 | Low | Edit the ALDI category -> household group mapping (spec 3.6). | Stage 2 cut | Defaults (D-039) are good; aisle order editing covers the in-store need. |
| B-010 | Low | Rename or add household groups. | Stage 2 cut | 15 default groups suffice. |
| B-011 | Low | Delete archived lists (and their purchase rows). | Stage 2 cut | History is small; rows feed Stage 3. |
| B-012 | Low | Shop-mode row: show a long note in full (wrap to a second line) instead of an ellipsis. | Stage 2 QA INFO-2 | Full note is in the edit sheet; revisit if it bites in store. **Done (D-102).** |
| B-013 | Low | Test top-ups: E6 speed e2e at 30 rows (runs 15); 401 mid-shop e2e from shop mode (only Search today); a test for the accepted D-058 untick/archive race. | Stage 2 QA INFO-3 (D-058 race test done; e2e items remain) | Behaviour covered by unit/API tests; race accepted with Undo as recovery. **Web parts done: E6 speed e2e at 30 rows, 401 mid-shop e2e (D-102).** |

| B-OPS-1 | Tidy up orphaned resources from the first failed deploy (user task, needs AWS console) - docs/ops/tidy-orphans.md | Low | open |
| B-014 | Low | MCP: suggestions tool (run Stage 3 engine from a chatbot). | Stage 4 cut | Add later once MCP use is proven. |
| B-015 | Low | MCP: tick items, change qty of an existing line, pick a list other than this week's, templates. | Stage 4 cut | Core ask is adding/reading this week's list. |
| B-016 | Low | MCP: read-only grants / per-tool scopes. | Stage 4 cut | Two trusted users; one scope is enough. |
| B-017 | Low | OAuth: pre-registered client id/secret (non-DCR clients). | Stage 4 cut | Claude and ChatGPT both use DCR. |
| B-018 | Rate-limit /oauth/authorize and /oauth/token per client/IP (QA Stage 4 D-2) | Low | open |  **Done (D-101).**
| B-019 | Medium | Mela import: `.melarecipe` / `.melarecipes` files (JSON, base64 images) into recipes. | Stage 5 cut | Manual entry first; import is its own parsing/upload job. |
| B-020 | Medium | Meal planner: pick recipes (and meal templates) for the week, then send combined ingredients to this week's list. | Stage 5 cut / spec Stage 5 | Needs recipes in use first. |
| B-021 | Low | Scale servings (adjust ingredient quantities). | Stage 5 cut | Needs ingredient quantity parsing. |
| B-022 | Low | Match recipe ingredients to ALDI products (turn text lines into product lines). | Stage 5 cut (D-106) | Fuzzy; free text works in store. |
| B-023 | Low | MCP/Siri recipe tools (find a recipe, add its ingredients). | Stage 5 cut | Prove recipes in the app first. |
| B-024 | Low | Free-text lines typed straight onto a list, and on templates. | Stage 5 cut (D-103) | Recipe path only for now. |
| B-025 | Low | Recipes in the offline read cache (cook without signal). | Stage 5 cut (D-110) | Kitchens have Wi-Fi. |
| B-026 | Low | Sweep orphaned recipe photos; markdown/step highlight in cooking view. | Stage 5 cut (D-105, D-107) | Negligible cost; polish. |
| B-027 | Low | Recipes: reject a photoKey already used by another recipe (QA Stage 5 D2; UI cannot produce it). | Stage 5 QA | open |
