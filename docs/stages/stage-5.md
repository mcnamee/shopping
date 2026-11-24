# Stage 5 - Recipes: acceptance criteria

Goal: keep the household's recipes (Mela-style) in Trolley, cook from a readable screen, and send chosen ingredients to a list in a few taps.
Decisions: D-103 to D-110. Tags: **[S]** in session (unit, API integration against DynamoDB Local or fake, CDK assertions, Playwright at 390 px with mocked auth); **[U]** by the user after deploy.

## Out of scope (backlog B-019..B-026)
Mela import, meal planner, scaling servings, matching ingredients to ALDI products, MCP/Siri recipe tools, free-text lines on templates or typed straight onto a list, recipes in the offline cache, markdown in recipe text, orphan-photo sweep.

## A. Navigation
- A1 [S] Bottom nav has 5 tabs in order Lists, Search, Recipes, Templates, Settings; Recipes route `/recipes`, icon `ChefHat`. At 360 and 390 px every label shows in full on one line, no truncation or overlap (Playwright screenshot at 390). Deep link to `/recipes...` survives sign-in (D-100 list).

## B. Recipes data and API (D-104, D-105, D-107)
- B1 [S] Recipe fields: title (required, <= 120), description (<= 2,000), photo (optional), categories (<= 10 tags, each <= 30, trimmed, case-insensitive dedupe), yield, prep time, cook time, total time (free text, each <= 30), ingredients (<= 200 lines, <= 10,000 chars), instructions (<= 20,000), notes (<= 5,000), nutrition (<= 1,000), source URL (`http(s)` only, <= 2,000), favourite. Over-limit -> 400 VALIDATION naming the field.
- B2 [S] `GET /recipes` returns summaries only (id, title, categories, yield, totalTime, thumb URL, favourite, updatedAt) via projection; `GET/PUT/DELETE /recipes/{id}`; `PATCH /recipes/{id}` `{ favourite }` needs no version; PUT needs version (409 STALE). 409 LIMIT at 500 recipes.
- B3 [S] Household-scoped: another household's recipe id is 404 everywhere (test).
- B4 [S] `POST /recipes/photo-upload` returns presigned POSTs for a full image and a thumb (`image/jpeg`, content-length-range <= 3 MB / 300 KB, 5 min expiry) under `recipes/<hh>/<uuid>`; PUT accepts only keys under the caller's household prefix. Replacing or removing a photo deletes the old objects; deleting a recipe deletes its photo (test with S3 mock).
- B5 [S] Photos served same-origin at `/media/recipes/...` via a CloudFront behaviour to a private bucket (OAC), long immutable cache, SPA fallback does not swallow it; bucket blocks public access (CDK assertions).

## C. Recipes screen (list)
- C1 [S] Cards: thumbnail (placeholder icon when none), title (2 lines max), total time and yield meta, star if favourite. Sorted by title A-Z.
- C2 [S] Search box filters by title as you type (case/accent-insensitive, client-side). Category chips (all used tags, A-Z) and a "Favourites" chip filter; filters combine with search. "No recipes match" state with Clear filters.
- C3 [S] Empty state: "No recipes yet" + "Add recipe" button. "Add recipe" also in the top bar.

## D. Add / edit / delete
- D1 [S] One form page (`/recipes/new`, `/recipes/:id/edit`) with every B1 field; ingredients and instructions are auto-growing textareas with hints. Save disabled until title set; field errors inline.
- D2 [S] Photo: "Add photo" opens the phone picker (`accept="image/*"`, camera or library). Client resizes to max 1600 px JPEG (~0.82) plus a 400 px thumb, EXIF orientation respected, preview shown; Remove photo available. Upload failure keeps the form and says "Photo didn't upload. Try again."
- D3 [S] Leaving with unsaved changes asks "Discard changes?". 409 STALE says "Changed on the other phone" and reloads.
- D4 [S] Delete (from edit page) confirms "Delete {title}? This can't be undone." then returns to Recipes.

## E. Detail (cooking view)
- E1 [S] Photo, title, description, meta row (Prep, Cook, Total, Serves, only those set), categories, Ingredients, Method, Notes, Nutrition, Source link (opens new tab, `rel="noopener noreferrer"`, shows host). Text is `text-lg`; all user text rendered as plain text (no HTML).
- E2 [S] Ingredients: one per line; lines starting `#` render as subheadings (the `#` stripped); blank lines ignored. Method: each paragraph (split on blank lines, or on single newlines when there are no blank lines) is a numbered step; `#` lines are subheadings and restart nothing. Parser in `packages/core` with tests incl. Mela samples.
- E3 [S] "Keep screen on" toggle, default on: Wake Lock acquired while the detail is visible, re-acquired on `visibilitychange`, released on leave. Toggle hidden where unsupported. Favourite star and Edit in the top bar.

## F. Ingredients to list (D-103, D-106)
- F1 [S] "Add to list" on detail opens a review sheet: all ingredient lines pre-ticked, headings shown as group labels (not selectable), "Select all/none" + "N of M selected" as in suggestions.
- F2 [S] Target picker lists active lists, default this week's; with none, a blank "Week of ..." is created and flagged on confirm (D-048). Primary button "Add N to {list}" (disabled at 0).
- F3 [S] Each selected line becomes a free-text line: text as written, note "From {recipe title}", group from `guessGroup` (core, keyword table, fallback Other; >= 25 test cases). Sent in chunks of <= 50 via bulk add; toast "Added N to {list}" with Undo (bulk undo, D-072).
- F4 [S] Same text already on the list (exact after trim and whitespace collapse) merges: one line, unticked, notes joined per D-046. Different text = separate line. 200-item list limit applies (LIMIT results reported "N not added - list is full").

## G. Free-text lines on lists (D-103)
- G1 [S] Shown in their group in list and shop mode with a text icon instead of a photo, no quantity; note as meta. Tick/untick, edit (text, group, note) and delete like other lines; editing text to match another line merges.
- G2 [S] Archive writes no purchase row for free-text lines; suggestions never see them; offline tick queue works for them (test).
- G3 [S] MCP `get_current_list` shows them; `remove_item` can match them by text; `add_item` unchanged. Text is returned as quoted data (injection test).

## H. Quality
- H1 [S] Full suite green, `npm audit` no high/critical, Lighthouse a11y >= 95 on Recipes and detail, all tap targets >= 44 px.
- H2 [U] Add a real recipe with a phone-camera photo on each phone; the other phone sees it.
- H3 [U] Cook from the detail view: screen stays on for 10 min; send ingredients to this week's list, tick them in store.

## UX notes
- **Patterns reused:** app shell + 5-tab nav (`docs/ux/app-shell.md`, update table and "quarter-width" to fifth-width; 78 px per tab at 390, labels `text-xs` fit), search field and empty states (`search.md`), review sheet + Select all/none + Undo toast (`suggestions.md`), list rows and edit sheet (`lists.md`), list picker as in Search's target. No ux-designer needed.
- **Recipes list:** top bar "Recipes" + "Add recipe" (Plus). Sticky search field ("Search recipes"), then a horizontal scroll row of chips: Favourites first, then categories. Grid of cards, 2 columns at 390 (thumb 1:1, `radius-md`, lazy-loaded), title `text-base` 600, meta `text-sm` muted "45 min · Serves 4".
- **Detail:** full-width photo (16:9 crop, max 40vh), then content with 16 px gutters. Meta as small labelled pairs. Sticky footer button "Add to list" (primary). "Keep screen on" as a switch row under the meta. Steps numbered in `accent` circles, generous line height (1.6).
- **Form:** sections Photo, Basics (title, description, categories as chip input: type + Enter/comma), Times & yield (2-column grid), Ingredients, Method, Notes, Nutrition, Source. Hints: "One per line. Start a line with # for a heading." / "Leave a blank line between steps. Start a line with # for a heading." Sticky Save bar; Delete as destructive text button at the bottom (edit only).
- **Free-text row:** `NotebookText` icon in the 48 px image slot, text as title (wraps to 2 lines), "From Lamb curry" as meta. Edit sheet: Text, Group (select), Note; no quantity stepper.
- **Copy (Australian English):** "Add recipe", "Edit recipe", "No recipes yet", "Add your favourite recipes and send ingredients to your list.", "Keep screen on", "Add 8 to Week of 23 Nov", "Added 8 to Week of 23 Nov" + Undo, "Photo didn't upload. Try again.", "You can have up to 500 recipes."
- **States:** loading skeleton cards; offline: Recipes shows "You're offline" error state (not cached, B-025); photo uploading spinner on the preview; save button "Saving...".
