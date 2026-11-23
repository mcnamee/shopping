# Backlog

Small items deferred from signed-off stages. Highest priority first. Pull into a stage when it touches the same area.

| # | Priority | Item | Origin | Why deferred |
|---|---|---|---|---|
| B-001 | Medium | Splash shows "Try again" when session restore fails only because of the network (today it falls back to sign-in, so an offline cold start looks like being signed out). | Stage 0 engineer gap | Tokens are kept; signing in again works. Do with Stage 5 offline/shop mode, or earlier if users hit it in store. |
| B-002 | Low | Return to the deep-linked page after sign-in should include `/settings` (currently excluded, lands on Lists). | Stage 0 engineer gap | One extra tap; rare path. |
| B-003 | Low | Set-new-password: distinct message when the new password equals the temporary password (today a generic error). | Stage 0 engineer gap | Happens once per user, at first sign-in. |
| B-004 | Medium | Quantity modal: "Remember {unit} for this product" checkbox (household unit override, spec 3.2, docs/ux/quantity-modal.md section 4). Hidden in Stage 1; the pure quantity logic is already in `packages/core/src/quantity.ts`. | Stage 1 UI | Needs the Stage 2 household settings store to persist the override. Build with Stage 2 lists (see the TODO in `apps/web/src/search/QuantityModal.tsx`). |
| B-005 | Low | Record a loose-produce (`weightType 3`) ALDI fixture so `mapProduct` loose -> `kg` is covered end to end (QA LOW-1, D-045). | Stage 1 QA | Unit inference tests already cover the rule. Do when next touching the scraper. |
| B-006 | Medium | Offline shop mode: read cache plus queued ticks that replay on reconnect (Stage 2 only shows clear offline/error states). | Stage 2 cut (D-051) | Polling + optimistic UI is enough for a store with signal; spec puts offline in Stage 5. |
| B-007 | Medium | "Copy to new list" from an archived list in History. | Stage 2 cut | Templates cover the repeat-shop case. |
| B-008 | Low | Save an active list as a new template. | Stage 2 cut | Templates can be built from search. |
| B-009 | Low | Edit the ALDI category -> household group mapping (spec 3.6). | Stage 2 cut | Defaults (D-039) are good; aisle order editing covers the in-store need. |
| B-010 | Low | Rename or add household groups. | Stage 2 cut | 15 default groups suffice. |
| B-011 | Low | Delete archived lists (and their purchase rows). | Stage 2 cut | History is small; rows feed Stage 3. |
| B-012 | Low | Shop-mode row: show a long note in full (wrap to a second line) instead of an ellipsis. | Stage 2 QA INFO-2 | Full note is in the edit sheet; revisit if it bites in store. |
| B-013 | Low | Test top-ups: E6 speed e2e at 30 rows (runs 15); 401 mid-shop e2e from shop mode (only Search today); a test for the accepted D-058 untick/archive race. | Stage 2 QA INFO-3 | Behaviour covered by unit/API tests; race accepted with Undo as recovery. |

| B-OPS-1 | Tidy up orphaned resources from the first failed deploy (user task, needs AWS console) - docs/ops/tidy-orphans.md | Low | open |
