# Search tab and custom product sheet (Stage 1)

Tokens: `tokens.md`. Shell, top app bar, bottom nav, `StatusBanner`: `app-shell.md`. Quantity modal: `quantity-modal.md`. Route `/search` (replaces the Stage 0 placeholder). Spec refs: PRODUCT_SPEC 3.1, 3.2. Copy is Australian English.

Goal: from tapping Search to an item in the list in as few taps as possible. Typical path: tap field, type "milk", tap **Add**, (optional stepper), tap **Add to list** = 3 taps plus typing. Items whose default quantity is fine can be confirmed without touching the stepper.

## 1. Layout (390px)

```
+--------------------------------------+
|  Search                              |  app bar 56px + safe-top (title "Search")
+--------------------------------------+
| [status banner if offline/error]     |
+--------------------------------------+  <- sticky block starts (top: 56 + safe-top)
| +----------------------------------+ |
| | (Search)  milk              (X)  | |  field 56px, radius-md, gutter 16
| +----------------------------------+ |
| ( All )( Fruit & Veg )( Meat & Sea-> |  chips row 44px, h-scroll, snap
+--------------------------------------+  <- sticky block ends (bottom border-subtle when content scrolled)
| 24 results                           |  text-sm muted, aria-live polite
| +---------------+ +---------------+  |
| |   [image  (+)]| |   [image  (+)]|  |  (+) = ListPlus button, top-right of image
| |   173x173     | |               |  |
| |Full Cream Milk| |Lactose Free   |  |  title text-base 600, 2-line clamp
| |Brand name     | |Milk 2L        |  |  brand text-sm muted, 1 line
| |$2.19 . 2 L    | |Brand name     |  |  price text-lg 700 + pack size text-sm muted
| |[    Add      ]| |$2.89 . 2 L    |  |  Add: full width, 48px
| +---------------+ |[    Add      ]|  |
| +---------------+ +---------------+  |
|          (Loading more...)           |
+--------------------------------------+
|  Lists   Search  Templates Settings  |  bottom nav (unchanged)
+--------------------------------------+
```

- Sticky block: `bg`, sits directly under the app bar, includes search field and chip row. It does not move when the on-screen keyboard opens (keyboard overlays; results scroll beneath).
- Content padding: `max(16px, safe-left/right)`, bottom padding = nav height + 16.
- Grid: 2 equal columns, 12px column gap, 12px row gap. At 360px each card is about 164px wide; at 390px about 173px.
- URL state: `/search?q=milk&cat=dairy-eggs` (replace, not push), so returning from another tab or a reload restores the search. Scroll position is preserved per the shell rule.

## 2. Components

### 2.1 SearchField
- `<input type="search">`, `enterkeyhint="search"`, `autocomplete="off"`, `autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"`, `inputmode="search"`. Text `text-base` (16px, avoids iOS zoom).
- 56px tall, `surface` bg, 2px `border`, `radius-md`; focus: 2px `focus` ring plus `accent` border. Leading `Search` icon 24px `text-muted`. Placeholder "Search ALDI products" (`text-muted`).
- Accessible name: visually hidden `<label>` "Search products".
- Clear button: lucide `X` in a 44x44 target inside the right edge, shown only when text is non-empty, `aria-label="Clear search"`. Tap: empties field, keeps focus (keyboard stays up), cancels any pending request, returns to Initial (or category browse if a chip is active).
- Do not autofocus on tab open (it would cover the screen with the keyboard before the user decides). Exception: tapping the active Search tab when already at top focuses the field.
- Behaviour:
  - Debounce 250ms after the last keystroke; trim whitespace; minimum 2 characters. 0-1 characters show Initial (or category browse).
  - Pressing the keyboard Search key: runs the query immediately (skips debounce) and blurs the field so the keyboard drops and results are fully visible.
  - A new query aborts the in-flight request; ignore out-of-order responses.
  - Matching: case-insensitive on name and brand, prefix and word-start matches ranked first. (Engineering detail, no UI.)

### 2.2 CategoryChips
- `role="radiogroup"` `aria-label="Filter by category"`; each chip is `role="radio"` (single select). Chips: **All** (default), Fruit & Veg, Meat & Seafood, Dairy & Eggs, Bakery, Pantry, Frozen, Drinks, Snacks, Health & Beauty, Household, Baby, Pet, Liquor, Other.
- Chip: 44px tall, padding 0 16px, `radius-full`, `text-base` 600, gap 8px, row padding-left 16px (first chip aligns with gutter), scrolls horizontally with scroll-snap, no visible scrollbar, right edge fades to hint more. Row has `overscroll-behavior-x: contain` so it never triggers browser back-swipe.
- Unselected: `surface` bg, 2px `border` outline, `text`. Selected: `accent` bg, `on-accent` text, `Check` icon 16px before label (not colour alone). Pressed: `accent-strong`.
- Selecting a chip scrolls it fully into view, resets results scroll to top, and runs the search with the category filter. Tapping the selected chip again returns to **All**.
- With no query, a selected chip means "browse that category" (all products in it, A to Z). With a query, it narrows the results.
- Category list is the household group list from Settings (3.6); order as above unless the household has changed it. Group names come from data, so do not hard-code widths.

### 2.3 ProductCard (`<li>` in `<ul>` grid)
- Card: `surface-raised` bg, 1px `border-subtle`, `radius-md`, overflow hidden. Not itself tappable (no card-level action in Stage 1; avoids accidental taps while scrolling); all actions are the two buttons.
- Image: square (`aspect-ratio: 1`), `#FFFFFF` bg in both themes (product photos have white backgrounds), `object-fit: contain`, 8px inner padding, `loading="lazy"`, `decoding="async"`, explicit width/height to prevent layout shift. `alt=""` (decorative; the title is adjacent).
- Image fallback (no URL, load error, or still loading): `surface` bg block with the product's first letter (uppercase, `text-2xl`, `accent`) centred. Loading: shimmer `surface` -> `border-subtle`; static under reduced motion.
- Template button (top-right of image): lucide `ListPlus` 20px in a 44x44 hit area (visual disc 36px, `surface-raised` at 90% opacity with 1px `border-subtle`, icon `text`), 4px inset from the corner. `aria-label="Add {product name} to a template"`. Subtle by design but never below 44px target. Stage 1 tap: toast "Templates arrive soon" (see 2.6). It does not open anything.
- Text block (padding 12px, gap 4px):
  - Title: `text-base` 600, `text`, max 2 lines (`line-clamp-2`), min-height reserved for 2 lines so buttons align across a row.
  - Brand: `text-sm` `text-muted`, 1 line truncate. Omit the line if no brand (reserve height).
  - Price + pack size on one line: price `text-lg` 700 `text` (e.g. "$2.19"), then " . 2 L" `text-sm` `text-muted` (separator is a middle dot, with spaces). If no price, show only the pack size. Pack size comes from scraped text, shown as-is; for per-kg lines show "per kg".
- **Add** button: full card width (inside the 12px padding, so about 149px), 48px tall, `accent` bg, `on-accent` text, `text-lg`, `radius-md`, lucide `Plus` 20px left of the label. `aria-label="Add {product name} to list"`. Pressed `accent-strong`. Opens the Quantity modal with that product.
- After the modal confirms, the card's Add button shows `Check` + "Added" for 1.5s (same size, `success-soft` bg, `success` text), then reverts. It stays tappable (adding again is allowed).
- Card order is stable while paging; appending never re-sorts.

### 2.4 Results meta line
- "24 results" / "1 result" above the grid, `text-sm` `text-muted`, `aria-live="polite"`. When browsing a category: "Dairy & Eggs, 86 products". Hidden while loading.

### 2.5 Infinite scroll
- Page size 24. A sentinel 400px before the end triggers the next page (IntersectionObserver). Show once the first page has loaded.
- Footer while fetching: centred 24px spinner `accent` + "Loading more..." `text-sm` `text-muted`, `role="status"`; two skeleton cards may appear in the grid.
- End of results (when total <= loaded and at least one page): centred `text-sm` `text-muted`: "That's everything for 'milk'." (category browse: "That's everything in Dairy & Eggs."), followed by the secondary button "Can't find it? Add a custom item" (see 5).
- Load-more failure: keep existing cards; footer shows inline `danger` text "Couldn't load more." + 44px "Try again" text button. Do not clear the grid.
- Keep the DOM light: render all loaded cards but images lazy; if more than about 200 cards, engineering may virtualise (no visual change).

### 2.6 Toast (new shared component `Toast`, also used by quantity modal)
- Fixed, centred horizontally, margin 16px each side, max-width 358px; bottom = nav height (64) + `max(safe-bottom, 8px)` + 12px, so it floats just above the bottom nav and is within thumb reach. Above the on-screen keyboard it is hidden behind the keyboard; that is acceptable because none of its messages are critical.
- Inverted surface so it reads in any light: bg `text`, text `bg` (swaps in dark mode), `text-base` 600, min-height 48px, padding 12px 16px, `radius-md`, optional leading 20px icon (`Info`), optional text button at right (44px, `bg` text colour underlined) for Undo in later stages.
- `role="status"` `aria-live="polite"`; one toast at a time (new replaces old); auto-dismiss after 4s; pauses while pressed; swipe down dismisses. Enter/exit 150ms fade and 8px slide; reduced motion: fade only.
- Stage 1 messages: "Templates arrive soon" (template icon); "Lists arrive soon - added to your draft" (quantity modal confirm).

## 3. States

### 3.1 Initial (no query, "All" selected)
```
+--------------------------------------+
| [ (Search) Search ALDI products    ] |
| (All)(Fruit & Veg)(Meat & Seafood)-> |
|                                      |
|              ( Search )              |  icon 48px accent on accent-soft 96px circle
|        Find your ALDI items          |  text-xl
|    Type a product name, or pick a    |  text-base muted, max-w 280
|    category above to browse.         |
|                                      |
|   [ Plus  Add a custom item  ]       |  secondary button 56px
|                                      |
|  Your regular items will show up     |  text-sm muted, centred
|  here after a few shops.             |  (reserved "Popular" slot; Stage 1 note only)
+--------------------------------------+
```
- Same empty-state pattern as `app-shell.md` section 2 (icon circle, heading, body).
- Secondary button: transparent bg, 2px `accent` border, `accent` text, `text-lg`, `radius-md`, opens the custom product sheet with an empty name.
- Later stages replace the muted note with a "Your usuals" horizontal row of purchased items; the slot sits below the prompt.

### 3.2 Loading (first page)
- Replace the grid with 6 skeleton cards (same dimensions as real cards: image block, 3 text bars, button block in `surface`). Shimmer 1.2s; static under reduced motion. Grid has `aria-busy="true"`; visually hidden status "Searching".
- Do not flash on fast responses: show skeletons only if the request exceeds 150ms; until then keep the previous results dimmed to 60% opacity.
- Skeletons are not interactive; chips and field stay usable.

### 3.3 Results
As in section 1.

### 3.4 No results
```
+--------------------------------------+
|           ( SearchX )                |  lucide SearchX 48px, accent on accent-soft circle
|       No matches for 'xyz'           |  text-xl, query truncated to 24 chars + ellipsis
|   Check the spelling, try a shorter  |  text-base muted
|   word, or pick "All" categories.    |  (second clause only if a chip other than All is on)
|                                      |
|  [ Plus  Add 'xyz' as a custom item ]|  primary button 56px, full width, wraps to 2 lines
+--------------------------------------+
```
- Primary CTA label: "Add 'xyz' as a custom item" (query trimmed, truncated to 24 chars with ellipsis in the label; full text goes into the sheet). Opens the custom product sheet (section 5) with Name prefilled from the query and Group prefilled from the active chip (else "Other").
- Category browse with no products (unlikely): heading "Nothing in Dairy & Eggs yet", body "Products appear here after the next ALDI catalogue update.", plus the same secondary "Add a custom item" button.

### 3.5 Error (first page failed)
```
+--------------------------------------+
|           ( CloudOff )               |  lucide CloudOff 48px, danger on danger-soft circle
|     Couldn't load products           |  text-xl
|   Something went wrong. Please try   |  text-base muted
|   again.                             |
|        [ RefreshCw  Try again ]      |  primary 56px
+--------------------------------------+
```
- `role="alert"` on the heading block. "Try again" repeats the last query and moves focus to the results heading. Server unreachable uses "Can't reach Trolley right now." as the body. Also raise the shell `StatusBanner` error variant per app-shell 5 only if the failure is network-level; do not duplicate messages (the banner covers the generic case, this inline state is the only one shown on this screen to avoid two alerts: when this state is visible, suppress the banner for this screen).
- Search field and chips remain usable; editing the query retries automatically.

### 3.6 Offline
- Shell `StatusBanner` Offline shows at top (unchanged).
- Previously loaded results for the current query stay visible and the **Add** button still works (quantity modal and its draft toast do not need the network in Stage 1).
- New query with no cached data: inline state like Error but with `WifiOff` (`warning-text` on `warning-soft` circle), heading "You're offline", body "Search needs a connection. Your last results are still here if you scroll up." (omit second sentence when none), button "Try again" disabled until the `online` event, then auto-retries.
- Creating a custom product requires a connection: the sheet's Save button is disabled with helper "You're offline. Reconnect to save a custom item." (the name is kept).

## 4. Interaction summary

| Action | Result |
|---|---|
| Type 2+ chars | After 250ms, results (skeleton if >150ms) |
| Keyboard Search key | Immediate query, keyboard dismissed |
| Clear (X) | Empty field, focus kept, cancel request |
| Tap chip | Filter; scroll results to top; chip scrolled into view |
| Tap **Add** | Opens Quantity modal for that product (`quantity-modal.md`) |
| Tap ListPlus | Toast "Templates arrive soon" (Stage 2: template picker) |
| Scroll near end | Next page loads |
| Tap "Add 'xyz' as a custom item" | Custom product sheet |
| Pull to refresh | Not supported (avoids conflict with sticky header); Try again buttons only |

Focus order: search field, clear button, chips, then for each card: template button, Add button. Returning from the modal restores focus to the Add button that opened it.

## 5. Custom product sheet

Bottom sheet reusing the shell sheet pattern (`surface-raised`, `radius-lg` top corners, `shadow-sheet`, `scrim`, drag handle, focus trapped, `role="dialog"` `aria-modal="true"` `aria-labelledby` the heading, Esc/scrim/Cancel/drag down closes, safe-area bottom padding). Sheet max-height 90dvh; body scrolls; footer buttons stay pinned above the keyboard.

```
+--------------------------------------+
|                ----                  |  drag handle
|  Add a custom item               (X) |  heading text-xl; X 44px
|  For things not in the ALDI range,   |  text-sm muted
|  like butcher or market items.       |
|                                      |
|  Name                                |  label text-sm 600
|  [ xyz                            ]  |  input 56px, required, max 80
|                                      |
|  Group                               |
|  [ Fruit & Veg                  v ]  |  native <select> 56px
|                                      |
|  How do you buy it?                  |
|  [each][pack][ kg ][ g ][ L ][ mL ]  |  segmented, 6 x 44px min
|  Weighed or measured items work      |  helper text-sm muted (changes with choice)
|  best as kg or L.                    |
|                                      |
|  [ Save and choose quantity ]        |  primary 56px
|  [ Cancel ]                          |  secondary 56px
+--------------------------------------+
```

- **Name**: required, trimmed, 1-80 chars, `autocapitalize="sentences"`, `enterkeyhint="next"`. Prefilled from the search query (title-cased first letter only). Focus lands here on open only when the name is empty; when prefilled, focus lands on the sheet heading so the keyboard does not hide the form.
- **Group**: native select (best on phones) listing the category groups in chip order, excluding "All". Prefill: active chip, else "Other". Label "Group" with helper none.
- **How do you buy it? (unit type)**: segmented radiogroup; options each, pack, kg, g, L, mL; default "each", or "kg" if group is Fruit & Veg or Meat & Seafood. Selected: `accent` bg, `on-accent` text plus `Check`; unselected: `surface`, 2px `border`. Helper copy by selection:
  - each: "Counted one by one, like bananas."
  - pack: "Sold as a packet or bottle, like a 1 kg bag of rice."
  - kg / g: "Sold by weight, like loose potatoes."
  - L / mL: "Sold by volume, like milk."
- **Save and choose quantity**: validates, creates the custom product (household scoped), closes this sheet, and opens the Quantity modal for the new product. The new product also appears in future searches (marked with a small "Custom" tag in place of the brand line on its card: `text-sm` `accent`, `Tag` icon 14px).
- Validation (on blur and on submit): Name empty -> "Enter a name for this item." Name over 80 -> "Keep it to 80 characters or fewer." Errors: `danger` text with `CircleAlert` icon under the field, `aria-describedby`, border `danger`; focus moves to the first invalid field on submit.
- Duplicate name (case-insensitive, same household): not blocked; inline `text-sm` hint "You already have a custom item called 'Lamb mince'. Use it instead?" with a 44px text button "Use existing" that opens the quantity modal for the existing one.
- Saving: button "Saving..." with spinner, all controls disabled.
- Save error: inline `danger-soft` banner inside the sheet above the buttons, "Couldn't save that item. Please try again." (`role="alert"`); form values kept; button reverts to "Save and choose quantity". Offline: button disabled, helper "You're offline. Reconnect to save a custom item."
- Cancel with unsaved name text closes without confirmation (low cost to retype).
