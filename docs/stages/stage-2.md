# Stage 2 - Lists and templates (MVP, usable in store): acceptance criteria

Goal: build this week's list from templates and search, then do a real ALDI shop on one or two phones: grouped in aisle order, tick into the trolley, list archives itself when done.
Decisions: D-046 to D-051. Tags as Stage 1: **[S]** in session (unit, API integration against DynamoDB Local or fake, CDK assertions, Playwright at 390 px with mocked auth and seeded catalogue); **[U]** by the user on real phones after deploy.

## Out of scope (backlog B-006 to B-011)
Offline cache or queued edits (only clear error states here), editing the category -> group mapping, renaming/adding groups, save-list-as-template, copy an archived list, deleting archived lists, Suggest items (Stage 3), prices/totals.

## A. Data and API rules (all new endpoints)
- A1 [S] Every new route has the JWT authoriser (CDK assertion) and returns 401 without a token; household comes only from the token. Integration test with two households: lists, items, templates, settings and purchase rows of one are never readable or writable by the other (404, not 403), including by guessing ids; any `householdId` in input is ignored.
- A2 [S] Validation returns 400 with field messages: names 1-60 chars; note <= 200; qty > 0, a multiple of the unit's step (spec 3.2) and <= 999; unit in `each|pack|kg|g|L|mL`; template `type` in `weekly|meal`; product must be a known catalogue SKU or the household's own custom product. Limits: 200 items per list, 100 per template, 50 templates, 10 active lists (409 with a clear message when exceeded).
- A3 [S] Items store a product snapshot (name, brand, image URL, pack size, groupId, unitType) so lists, templates and history render if the product is later discontinued or the catalogue is unavailable (D-047).
- A4 [S] Data model per spec 5.1: list items are separate rows (`HH#<hh>#LIST#<id>` / `ITEM#<id>`); templates embed items; settings in `HH#<hh>` / `SETTINGS`; purchase rows per D-050.

## B. Templates (Templates tab)
- B1 [S] List all templates (name, type badge Weekly/Meal, item count), sorted weekly first then by name; empty state explains templates with a "New template" button.
- B2 [S] Create, rename, change type and delete (confirm dialog) a template.
- B3 [S] Template detail: add items via search (same quantity modal), edit qty/unit/note, remove item. Saved changes survive reload.
- B4 [S] Adding a product already in the template with the same unit sums the quantity (merge rule D-046); a different unit is a separate row.
- B5 [S] Search's add-to-template icon (and the modal's target picker, C3) adds to a chosen template; replaces the D-026 "Templates arrive in Stage 2" toast. Toast: "Added 2 x Milk 2L to Tacos".

## C. Quantity modal changes
- C1 [S] Confirm now persists: default target is the "this week" list. Toast "Added 1.5 kg Potatoes to Week of 23 Nov" with Undo; replaces the D-026 toast. Undo removes the add (or reverts a merged quantity).
- C2 [S] If no list is flagged "this week", confirm creates a blank list named "Week of <Monday's date, e.g. 23 Nov>", flags it and adds the item (D-048).
- C3 [S] Target picker in the modal: this week's list (default), other active lists, templates. The choice is shown on the confirm button ("Add to Tacos").
- C4 [S] Adding a product already on the target list with the same unit sums quantity atomically (no lost update when both phones add milk at once); different unit = new row (D-046).
- C5 [S] "Remember {unit} for this product" checkbox (B-004) appears when the unit differs from the product default; ticking it saves a household unit override; next time the modal opens with that unit preselected, on both phones.

## D. Lists (Lists tab)
- D1 [S] Lists screen: active lists, "this week" first with a badge, then by created date; each shows name and progress ("12/30"). Link to History. Empty state with "New list".
- D2 [S] New list: name (default "Week of <Monday>"), start blank or from one or more templates (multi-select, weekly templates pre-selected). Templates merge by D-046; result shows the merged count.
- D3 [S] Add template(s) to an existing active list uses the same merge rule.
- D4 [S] Exactly zero or one active list is "this week"; setting it on one list clears it on the other (single atomic write); the first list created is flagged automatically; archiving the flagged list clears the flag.
- D5 [S] Rename an active list; delete an active list (confirm dialog; its items go too).
- D6 [S] Edit an item: tap opens the quantity modal prefilled (qty, unit, note); save updates the row.
- D7 [S] Delete an item (swipe or menu, both have an accessible button path) with a 5 s Undo toast; Undo restores qty, unit, note and ticked state.
- D8 [S] Add from search while on a list (an "Add items" button opens Search with that list as target).

## E. Shop mode (default list view)
- E1 [S] Items grouped by household group, groups in the household aisle order (F1); empty groups hidden; group header shows ticked/total.
- E2 [S] Each row: product name, quantity with unit in bold ("1.5 kg", "2 x"), pack size, note (visible, not truncated to nothing). Whole row is the tick target, >= 56 px tall; a separate small control opens edit.
- E3 [S] Tick: row greys, gets a strike-through and moves to the bottom of its group; untick restores it to its place (order within a group: by name). State conveyed to screen readers (`aria-checked` or equivalent).
- E4 [S] Sticky header with list name and progress "12/30" plus a progress bar; updates instantly on tick.
- E5 [S] Contrast meets WCAG AA for both normal and ticked rows; no horizontal scroll at 390 px; axe has no serious/critical violations on shop mode, Lists, History, Templates, Settings.
- E6 [S] Ticking 30 items in a row with no network latency added: each tick paints in < 100 ms (optimistic), no row jumps under the finger before the tap completes.

## F. Auto-archive and history
- F1 [S] Ticking the last unticked item archives the list server-side (conditional `active -> archived`, sets `completedAt`), and shows "Shop complete - list archived" with Undo (8 s). Undo returns it to active (all ticked) and removes its purchase rows; it does not re-archive until another tick completes the list (D-049).
- F2 [S] "Finish shop" menu action archives a list with unticked items (confirm: "3 items not ticked. Finish anyway?"); unticked items are recorded as not bought.
- F3 [S] Race: two phones ticking the last two items at the same moment archive the list exactly once (integration test with concurrent requests); the other phone shows the archived state on its next poll.
- F4 [S] On archive, one purchase row per ticked item is written (D-050); none for unticked items; re-archiving after Undo does not duplicate rows.
- F5 [S] History (from Lists): archived lists newest first with completed date and "28/30 bought"; detail is read-only (no tick, edit, add or delete controls; API rejects writes to archived lists with 409).

## G. Settings
- G1 [S] Aisle order: the 15 groups (D-039) in the household's order; reorder by drag and by accessible up/down buttons; saved order is used by shop mode on both phones. "Reset to ALDI order" (confirm) restores the default. Replaces fixed `GET /api/groups` order for this household.
- G2 [S] Unit overrides: list of products with a remembered unit; remove one (modal falls back to the product default).

## H. Sync between two phones
- H1 [S] Lists, list and templates refetch on window focus/visibility; shop mode polls every 10 s only while visible and stops when hidden or navigated away.
- H2 [S] Concurrency: tick/untick and quantity changes are single-row atomic updates (no read-modify-write of the whole list); integration test: two clients ticking different items concurrently lose neither tick; 50 interleaved ticks end in the expected state.
- H3 [S] Item and template edits use a version check; a stale edit gets 409, the client refetches and shows "Changed on another phone - showing latest" without losing the other phone's change.
- H4 [S] Playwright two-context test: phone A ticks, phone B (shop mode) shows it within 11 s; B adds an item, A sees it after focus.

## I. Errors and optimistic UI
- I1 [S] Every mutation is optimistic and rolls back on failure with toast "Couldn't save. Check your connection." (and "Try again" where safe); tested with a mocked 500 and with the network offline.
- I2 [S] When the browser is offline, shop mode shows a banner "You're offline - ticks won't save until you're back"; screens that fail to load show an error with "Try again", never a blank page.

## J. Quality and cost
- J1 [S] Unit tests for merge rule, quantity validation per unit, this-week flag, archive/undo and purchase-row keys; lint, typecheck, all tests, `cdk synth` pass; `npm audit` re-checked (D-044).
- J2 [S] Playwright end-to-end at 390 px: create template -> new list from it -> add from search with unit override -> shop mode tick all -> archived -> visible in History.
- J3 [S] No new fixed-cost resources; any new GSI justified in DECISIONS; API p95 < 500 ms for list load with 200 items (local benchmark).
- J4 [S] UI copy in Australian English.

## K. In store (user)
- K1 [U] Build this week's list from a weekly template plus search in under 5 minutes.
- K2 [U] Do a real ALDI Casey shop with both phones on the same list: groups in walk order, ticks show on the other phone, list archives at the end and appears in History.

## Done when
All [S] criteria pass in QA's report and the build is deployed. K1-K2 [U] are the user's in-store confirmation; a failure there that traces to a criterion reopens it.
