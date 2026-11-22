# Lists tab, shop mode and history (Stage 2)

> **Lead ruling (overrides the shop-mode row interaction below):** per criterion E2, the **whole row is the tick target** (>= 56 px tall) - fastest and most forgiving one-handed in store; an accidental tick is undone by tapping again. Editing opens from a separate trailing edit button (pencil, 44x44, aria-label "Edit {name}"). Swipe-left delete with undo stays.


Tokens: `tokens.md`. Shell, `StatusBanner`, bottom sheet pattern: `app-shell.md`. `Toast`: `search.md` 2.6. Quantity control and edit sheet: `quantity-modal.md` (section 9, Edit mode). Acceptance criteria: `docs/stages/stage-2.md` (D, E, F, H, I). Copy is Australian English.

Routes: `/` Lists tab, `/lists/:id` list (shop mode when active, read-only when archived), `/lists/history` History. Shop mode is the hero screen: designed for one hand, bright light, a moving trolley.

Shared rules used below:
- **BottomSheet**: as in `app-shell.md` section 3 (`surface-raised`, `radius-lg` top, `shadow-sheet`, `scrim`, handle, focus trapped, Esc/scrim/drag dismiss, max-height 90dvh, safe-area padding). Titles are `text-xl`; initial focus on the title (`tabindex="-1"`) unless stated.
- **Undo toasts** use `Toast` with an Undo button (44px). Duration is set per toast (the default 4s is too short to undo). Toast sits above the nav; in shop mode it also sits above the FAB (bottom offset + 72px).
- **Progress** is always shown as "ticked/total" (`12/30`), `font-variant-numeric: tabular-nums`.
- **Mutation failure** (any optimistic change): roll back and show toast "Couldn't save. Check your connection." with "Try again" where safe (stage-2 I1).

---

## 1. Lists tab (`/`)

```
+--------------------------------------+
|  Lists                           (+) |  app bar; (+) Plus 44px, aria-label "New list"
+--------------------------------------+
| [status banner if offline/error]     |
|  THIS WEEK                           |  section label text-xs uppercase muted
| +----------------------------------+ |
| | Week of 23 Nov    [This week]    | |  card: surface, radius-md, 16 pad, whole card is a link
| | 12/30 ticked                     | |  text-lg 700 count; name text-xl
| | [########-----------]            | |  8px bar, accent on border-subtle
| | [ ShoppingCart  Start shopping ] | |  primary 56px (label "Continue shopping" if 1+ ticked)
| +----------------------------------+ |
|  OTHER LISTS                         |
| +----------------------------------+ |
| | Birthday BBQ            3/14   > | |  row 64px, name text-lg, count right, chevron
| +----------------------------------+ |
| | Christmas hamper        0/22   > | |
| +----------------------------------+ |
|  [ History  Past shops          > ]  |  link row 56px, surface, History icon
|                                      |
|                        [ + New list ]|  extended button 56px, accent, right gutter,
+--------------------------------------+     bottom = nav + 16 (hidden when list is empty state)
```

- "This week" card: `Week of 23 Nov` is the list name. Badge `[This week]`: `accent-soft` bg, `accent` text, `Star` icon 14px, `text-xs`. Primary button navigates to `/lists/:id` (same as tapping the card; button is the visible affordance, card link has the name as accessible name, button `aria-hidden` and `tabindex="-1"` to avoid a duplicate stop).
- Empty progress ("0/0"): shows "No items yet" instead of the bar; button reads "Add items" and goes to `/search?list=:id`.
- Other lists: sorted by created date, newest first; progress `ticked/total` right-aligned; `aria-label` "Birthday BBQ, 3 of 14 ticked". An all-ticked active list (possible after Undo of an archive) shows `Check` icon plus "14/14".
- If no list is flagged "this week" but other lists exist, the "THIS WEEK" section is replaced by a dashed `border` card: "No list set for this week" / "Open a list and choose Set as this week, or start a new one." with button "New list".
- History link row: label "History", sub-label "Past shops" `text-sm` muted.
- Limit: 10 active lists. At 10, "New list" opens the sheet's blocked state (section 2.5).

### States
| State | Content |
|---|---|
| Loading | Skeleton card (110px) plus 2 skeleton rows; `aria-busy="true"`, hidden "Loading lists". Skeletons only after 150ms. |
| Empty (no active lists) | Icon `ListChecks` 48px on `accent-soft` circle. Heading "No lists yet". Body "Start this week's shop from scratch or from a template." Primary "Plus New list" 56px; secondary "History" link only if archived lists exist. |
| Error | `CloudOff`, "Couldn't load your lists", body "Something went wrong. Please try again.", primary "Try again" (`role="alert"` on heading block). Server unreachable body: "Can't reach Trolley right now." |
| Offline | Shell Offline banner; cached lists stay visible; "New list" disabled with `aria-disabled` and tapping shows toast "You're offline. Reconnect to create a list." |

Refetch on focus and visibility; no polling here.

---

## 2. New list sheet

Opened from (+) / "New list" / empty state. BottomSheet, title "New list".

```
+--------------------------------------+
|                ----                  |
|  New list                        (X) |
|                                      |
|  Name                                |
|  [ Week of 23 Nov                 ]  |  input 56px, max 60, selects all on focus
|                                      |
|  Start with                          |
|  [ Blank  ][ From templates ]        |  segmented 2 x 48px (radiogroup)
|                                      |
|  (templates, when chosen:)           |
|  [x] Weekly basics   [Weekly]  24    |  rows 56px, checkbox 24px in 44px target,
|  [ ] Tacos            [Meal]    9    |  badge + item count right
|  [ ] Roast night      [Meal]   11    |
|  Matching items are combined, so     |  helper text-sm muted
|  you won't get doubles.              |
|                                      |
|  [x] Set as this week's list         |  checkbox row 56px (see rules)
|                                      |
|  [ Create list ]                     |  primary 56px, sticky footer
|  [ Cancel ]                          |  secondary 56px
+--------------------------------------+
```

- **Name**: default "Week of {d MMM}" (no leading zero, e.g. "Week of 23 Nov"), where the date is the Monday of the current week, or the coming Monday on Saturday and Sunday. Today (Sun 22 Nov 2026) gives "Week of 23 Nov". Required, trimmed, 1-60 chars. Error messages: empty "Enter a name for this list."; over 60 "Keep it to 60 characters or fewer." Duplicate names are allowed.
- **Start with**: Blank (default) or From templates. Choosing From templates reveals the checklist and pre-ticks every `weekly` template (spec: weekly basics are the common case). Footer button label tracks the choice: "Create list" (blank, or no template ticked), "Create from 2 templates" (n >= 2), "Create from Weekly basics" (n = 1, truncated 20 chars).
- **Template rows**: sorted weekly first, then by name. Row is the checkbox (whole row toggles). Badge as in `templates.md` section 1.
- **No templates yet**: instead of the checklist, text "You haven't made any templates yet." with link-button "Go to Templates" (closes the sheet, routes to `/templates`). Create button still creates a blank list.
- **Set as this week's list**: checked by default when no list is flagged; unchecked and offered when one already is, with helper "Replaces Week of 16 Nov as this week's list." Hidden helper otherwise. The first list ever created is always flagged (the row is checked and `aria-disabled`).
- **Suggest items (Stage 3)**: reserved slot below the templates checklist, not rendered in Stage 2.
- **Creating**: button "Creating..." with spinner; controls disabled. Success: close sheet, route to `/lists/:id`, toast "Created Week of 23 Nov" (blank) or "Created Week of 23 Nov with 31 items" (from templates; add " (4 combined)" when matching items were merged).
- **Error**: inline `danger-soft` banner above the footer, "Couldn't create that list. Please try again." (`role="alert"`); values kept.
- **Limit blocked state** (10 active lists, or 409): the sheet shows only the heading, `warning-soft` banner "You have 10 lists on the go, which is the most Trolley allows. Archive or delete one first." and a single "OK" button.
- Offline: Create disabled, helper "You're offline. Reconnect to create a list."

Focus: initial focus on the Name field only when the user opens via keyboard; on touch, focus the title so the on-screen keyboard does not cover the templates.

---

## 3. Shop mode (`/lists/:id`, active list)

### 3.1 Layout (390px)

```
+--------------------------------------+
| (safe-top)                           |
| [<] Week of 23 Nov    12/30   [ ... ]|  header 56px: back 44 | title block | count | overflow 44
|     Updated just now                 |  sub-line text-sm muted (inside the 56px block)
| [#######-------------------------]   |  progress bar 4px full width, no gutter
+--------------------------------------+  <- sticky block ends (border-subtle bottom)
| [status banner if offline/error]     |
| FRUIT & VEG                    2/5   |  group header 40px, text-xs 700 uppercase muted
|--------------------------------------|
| [ (  ) ] Bananas             6       |  row min 64px: tick 56 | name+meta | qty
|   tick   Loose, ripe ones            |   name text-lg 2-line clamp; note text-sm muted 1 line
|--------------------------------------|
| [ (  ) ] Potatoes         1.5 kg     |
|--------------------------------------|
| [ (v ) ] ~~Broccoli~~       ~~1~~    |  ticked: strikethrough + muted, at bottom of group
| DAIRY & EGGS                   0/3   |
|--------------------------------------|
| [ (  ) ] Full Cream Milk     2 x     |
|   tick   2 L . Get lactose free if.. |  pack size then note on the meta line
| ...                                  |
|                        [ + Add items ]|  extended FAB 56px, accent, right gutter 16,
+--------------------------------------+     bottom = nav 64 + safe + 16
|  Lists   Search  Templates Settings  |  bottom nav stays (Lists active)
+--------------------------------------+
```

The page keeps the bottom nav (consistent with the shell and one tap to Search/Lists). Content bottom padding = nav + 56 FAB + 32, so the last row clears the FAB.

### 3.2 Header (sticky)
- Replaces the shell app bar on this route: `surface` bg, `border-subtle` bottom border, height 56px + `safe-top`.
- Back: lucide `ChevronLeft` in 44px, `aria-label="Back to lists"`.
- Title block: line 1 list name `text-xl` truncate; line 2 sync indicator `text-sm` `text-muted` (section 3.8). The name is the page `<h1>`. Tapping the title does nothing (rename lives in the menu, avoids accidental edits).
- Count: `12/30` `text-lg` 700 in a pill (`accent-soft` bg, `accent` text, `radius-full`, padding 4px 12px). At all ticked the pill becomes `success-soft`/`success` with `Check`. `aria-label="12 of 30 ticked"`.
- Overflow: `MoreVertical` 44px, `aria-label="List options"`, `aria-haspopup="dialog"`, opens the options sheet (3.7).
- Progress bar: 4px, `accent` fill on `border-subtle`, width = ticked/total, 150ms transition (none when reduced motion); `role="progressbar"` `aria-valuenow/max`, `aria-label="Items ticked"`; hidden when total is 0.
- Large text: title block may wrap the name to 2 lines and the sub-line drops below; header grows, never clips.

### 3.3 Group headers
- Order follows the household aisle order (`settings-stage2.md`); groups with no items are hidden. Header text is the group name, right side `ticked/total` `text-sm` 700 tabular. A group with everything ticked shows `Check` icon 16px in `success` before the count.
- Header is a 44px+ button toggling collapse (`aria-expanded`), chevron 20px on the left of the label. Default expanded; collapse state is per session per list (not stored). Collapsed headers still show the count. Non-sticky (the sticky list header already takes the top; keeps rows visible).
- Group `<section aria-labelledby>`; items in `<ul>`.

### 3.4 Item row
- Row: `bg`, bottom border `border-subtle`, min-height 64px, padding 8px 16px 8px 0, grid `[tick 56px] [body 1fr] [qty auto]`.
- **Tick control** (left): `<button role="checkbox" aria-checked>` hit area 56 x 64 (full row height), visual box 32px, 3px `border`, `radius-sm`; ticked: `accent` fill, `on-accent` `Check` 22px stroke 3. Pressed: `accent-soft` behind. `aria-label` "{name}, {qty} {unit}". Press feedback within 100ms (optimistic, stage-2 E6); haptic `navigator.vibrate(10)` where supported.
- **Body** (edit target): name `text-lg` 600, 2-line clamp; meta line `text-sm` `text-muted`, 1 line ellipsis: `{packSize} . {note}` (omit absent parts; note prefixed by `MessageSquare` 14px when no pack size, else after the dot). Full note is shown in the edit sheet. Body is a `<button>` with `aria-label="Edit {name}"`; hit area full width of body+qty.
- **Quantity** (right, part of the edit button): `text-lg` 700. Format: `each`/`pack` as `2 x` (hidden when 1: show `1 x` anyway for consistency); weight/volume as `1.5 kg`, `500 g`, `2 L`, `750 mL`. Max width 96px, never wraps; long values shrink the name column.
- **Ticked**: name and qty `text-muted` with `line-through` (not opacity, so contrast stays above 4.5:1; also the checkbox changes), meta line unchanged. Never conveyed by colour alone: strikethrough plus filled check.
- **Order within a group**: unticked by name (A to Z), then ticked by name (E3). Untick returns the row to its alphabetical place.
- **Sink animation**: after ticking, the row stays put for 500ms (so a mis-tap can be undone with a second tap without the row moving), then slides to its new position over 150ms. Reduced motion: moves instantly after 500ms. No reorder while a finger is down anywhere in the list or a swipe is active; queued reorders apply on touch end. Announce via live region "Broccoli ticked. 13 of 30."
- Rows are `<li>`; focus ring inset 2px `focus`.

### 3.5 Swipe left to delete (shortcut)
- Touch drag left on the row body (horizontal intent only, threshold 10px, vertical scroll wins if |dy| > |dx|). Reveals a `danger` panel behind the row with `Trash2` 24px + "Delete" `text-lg` `on-danger`, width 96px.
- Release past 40% of row width or flick: delete immediately. Release between 15% and 40%: row rests open at 96px; the revealed panel is a 96 x row-height button "Delete {name}". Tap elsewhere or scroll closes it. Less than 15%: snaps back.
- Immediately on delete: row collapses (150ms), toast "Removed {name}" with **Undo**, 5 seconds (stage-2 D7). Undo restores qty, unit, note and ticked state at its sorted place. The delete request is sent when the toast ends (or at once on leaving the screen); failure restores the row and shows the rollback toast.
- Accessible path (swipe is not discoverable by assistive tech): the Edit sheet has "Remove from list" (section 3.6). The rows do not expose custom actions.
- Disabled in archived lists. First-time hint: none (the edit sheet covers it); no tutorial overlay.

### 3.6 Edit item sheet
Tap the row body. This is the quantity modal in **Edit mode** (`quantity-modal.md` section 9): header with product image/name, quantity stepper, presets, unit segments (with "Remember {unit}" checkbox), note, footer **Save** / Cancel, plus a text button "Remove from list" (`danger`, 56px, below Cancel). No target row.
- Save: updates the row, closes, no toast on success (the row itself changes). Failure: rollback toast.
- Remove: same behaviour as swipe delete (toast "Removed {name}" with Undo 5s).
- Stale edit (409, other phone changed the item): sheet closes, toast "Changed on another phone - showing latest", row shows latest.
- Focus returns to the row's body button on close.

### 3.7 Options sheet (overflow)
BottomSheet titled with the list name; rows 56px, icon 24px left, label `text-lg`:

| Row | Icon | Behaviour |
|---|---|---|
| Rename list | `Pencil` | Opens rename sheet (below). |
| Set as this week | `Star` | Hidden when already this week (instead a non-interactive row "This is this week's list" with `Check`, `text-muted`). Success toast "Week of 23 Nov is now this week's list". |
| Add from template | `LayoutTemplate` | Opens the template checklist sheet (same rows as New list, button "Add to list"); toast "Added 12 items (4 combined)". |
| Finish shop | `CircleCheck` | Hidden when everything is ticked. Opens confirm: title "Finish this shop?", body "3 items aren't ticked. They'll be left off your history." (singular "1 item isn't ticked."), buttons "Finish and archive" (primary) / "Keep shopping". Archives, same result as 3.9. |
| Delete list | `Trash2` (`danger` text) | Confirm alertdialog: title "Delete {name}?", body "This also deletes its {n} items. This can't be undone.", buttons "Delete list" (danger) / "Cancel" (initial focus Cancel). On success route to `/`, toast "Deleted {name}" (no undo). |

Rename sheet: title "Rename list", Name input prefilled (selected), same validation as 2, buttons "Save" / "Cancel". Failure inline "Couldn't rename that list. Please try again."

### 3.8 Sync indicator ("Updated just now")
- Sub-line under the list name, `text-sm` `text-muted`, `aria-live="off"` (never chatty). Text: under 15s "Updated just now"; then "Updated 30 s ago" (to 59 s), "Updated 1 min ago", "Updated 5 min ago", then "Updated at 2:41 pm". Refreshes every 5s while visible.
- A successful poll or mutation resets it. During a fetch show a 12px `RefreshCw` spinner before the text (static icon under reduced motion). Polling every 10s while the page is visible, plus refetch on focus/visibility; stops when hidden or navigated away; pauses while a sheet is open or a swipe is active.
- Poll failing (2 consecutive): text becomes "Can't update. Retrying..." in `warning-text` with `WifiOff` icon (14px), still subtle, no banner. Recovers silently to "Updated just now".
- Incoming changes from the other phone merge without moving the row under the user's finger (3.4). New items from the other phone get a 2s `accent-soft` highlight on the row, and the live region announces "1 item added on another phone." (politely).

### 3.9 Shop complete (auto-archive with Undo)
Ticking the last unticked item (own tick) archives the list (stage-2 F1):
1. Optimistic: list flips to archived state in place (read-only, section 4.2 layout minus the back-to-history note), header count pill turns `success` with `Check`, FAB and swipe disappear.
2. Banner under the header, `success-soft` / `success`, `PartyPopper` icon (fallback `CircleCheck`), 56px: "Shop complete! This list is archived." with no action; stays until the user leaves.
3. Toast (8 seconds): "Shop complete - list archived" with **Undo**.
4. Undo: list returns to active in place with everything ticked, banner and toast clear; it does not re-archive until another tick completes it again (stage-2 D-049). Untick any item to carry on shopping.
5. Rollback on failure: list stays active, toast "Couldn't archive. Check your connection." with "Try again".
- If the completing tick happens on the other phone, this phone shows the archived state on its next poll plus the toast-less banner "This list was finished on another phone." (`info`, `accent-soft` / `accent`, `Info` icon).
- Empty lists (0 items) never archive.
- Focus: stays on the tick control, which becomes inert; live region announces "Shop complete. List archived."

### 3.10 Add items
Extended FAB "Add items" (lucide `Plus` 24 + label `text-lg`, `accent`, `on-accent`, `radius-full`, 56px tall, padding 0 20px, shadow `shadow-sheet` light, `border-subtle` ring in dark). Navigates to `/search?list=:id` (push, so back returns to the list at the same scroll). Hidden when archived or when the on-screen keyboard is open.

**Search list context** (changes to the Search screen, to mirror in `search.md`): when `?list=` is present a context bar sits under the app bar above the sticky field: 48px, `accent-soft`, `ShoppingCart` icon, text "Adding to Week of 23 Nov" (`text-base` 600, truncate), right button "Done" (44px, `accent` text, returns to `/lists/:id`). The quantity modal opens with that list preselected. The tab bar stays; tapping Lists returns to `/`. Same for `?template=:id` ("Adding to template Weekly basics", Done returns to `/templates/:id`). Context is dropped when the user leaves Search through the bottom nav.

### 3.11 States
| State | Content |
|---|---|
| Loading | Header with real name if known (from router state) else skeleton bar; 2 group headers with 4 skeleton rows each (tick box + 2 text bars + qty block). `aria-busy`. Delay 150ms. |
| Empty list | Header count "0/0", no progress bar. Centred: `ShoppingBasket` 48px on `accent-soft` circle, "Nothing on this list yet", "Add items from search, or bring in a template." Primary "Add items" 56px (goes to search context), secondary "Add from template" 56px. FAB hidden. |
| Error (load) | `CloudOff`, "Couldn't load this list", "Something went wrong. Please try again.", "Try again". If 404: "That list isn't here any more." with button "Back to lists" (deleted on the other phone). |
| Offline | Replaces the shell Offline banner copy in shop mode: `warning-soft` "You're offline - ticks won't save until you're back" (stage-2 I2). Ticks still paint optimistically but each failed one rolls back with the rollback toast; to avoid a burst, after the first rollback toast the rest are collapsed into one toast "Couldn't save. Check your connection." |
| Mutation conflict | Toast "Changed on another phone - showing latest". |
| All ticked (via load) | Active but all ticked (after Undo): count pill `success`; no banner. |
| Limit (200 items) | Adding via search: modal confirm fails with banner "This list is full (200 items). Remove something first." |

### 3.12 A11y and focus
- Landmarks: header `<header>`, list `<main>` with `<h1>` in header; groups are `<section>` with `<h2>` group names.
- Tab order: Back, Options, group header buttons and rows (tick, edit) in document order, FAB last. Tick `role="checkbox"` toggles with Space; edit button with Enter.
- Live region (polite, hidden): tick/untick results, "n items added on another phone", sync recovery, archive result. Not announced on every poll.
- All targets: tick 56x64, edit full row, header buttons 44, FAB 56. Contrast: text on `bg` >= 17:1; muted >= 7.5:1; ticked state still >= 7:1.
- Reduced motion: no sink slide, no highlight fade, static spinner.
- Safe areas: header pads `safe-top`; rows pad `max(16px, safe-left/right)`; FAB right offset `max(16px, safe-right)`.

---

## 4. History (`/lists/history`) and archived list

### 4.1 History list
```
+--------------------------------------+
| [<] History                          |  app bar variant with back, title text-xl
+--------------------------------------+
|  NOVEMBER 2026                       |  month label text-xs uppercase muted
| +----------------------------------+ |
| | Week of 16 Nov                 > | |  row 72px: name text-lg 600
| | Sun 22 Nov . 28/30 bought        | |  text-sm muted
| +----------------------------------+ |
| | Week of 9 Nov                  > | |
| | Sun 15 Nov . 30/30 bought        | |
|  OCTOBER 2026                        |
|  ...                                 |
|        [ Load more ]                 |  secondary 56px after 20 rows (cursor paging)
+--------------------------------------+
```
- Newest first by `completedAt`; grouped by month; secondary line "{Ddd D MMM} . {ticked}/{total} bought". `aria-label` "Week of 16 Nov, finished Sunday 22 November, 28 of 30 bought".
- Empty: `History` icon, "No past shops yet", "Finished lists show up here so you can look back at what you bought." No button.
- Loading: 5 skeleton rows. Error: `CloudOff` "Couldn't load your history" + "Try again". Load-more failure: inline "Couldn't load more." + "Try again" text button.
- Back from History goes to `/`.

### 4.2 Archived list view (`/lists/:id`, read-only)
Same layout as shop mode with these differences:
- Header: back goes to History (or `/` when arrived via the Shop complete flow); no overflow menu, no FAB, no swipe; sub-line is "Finished Sun 22 Nov" instead of the sync text; no polling.
- Under the header, `accent-soft` banner (`Archive` icon, `text-sm` 600, 48px): "Archived and read-only. Nothing here can be changed."
- Rows: not interactive (no tick, no edit); tick box shown as a static state (ticked = filled check; unticked = empty box with `text-muted` label "Not bought" in the meta line, since unticked items were left off). Order: ticked first by name within group, then not bought (reverse of shop mode, so what was bought leads).
- Count pill shows `28/30` neutral (`surface`, `text`).
- Loading and error states as in 3.11. API 409 on any write is not reachable from the UI.
- A11y: rows are plain `<li>`, state as text ("Bought" / "Not bought" visually hidden prefix on the meta line).
