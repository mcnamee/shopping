# Settings additions (Stage 2)

Tokens: `tokens.md`. Settings page, sheets and Toast: `app-shell.md` 3, `search.md` 2.6. Criteria: `docs/stages/stage-2.md` section G. Copy is Australian English.

## 1. Settings page changes (`/settings`)

New section **SHOPPING** above ACCOUNT. Two link rows in one `surface` card, `radius-md`, 64px rows separated by `border-subtle`, label `text-lg` 600, value `text-sm` `text-muted`, `ChevronRight` 20px right. Each row is an `<a>` (whole row target).

```
|  SHOPPING                            |
|  +--------------------------------+  |
|  | ArrowUpDown  Aisle order     > |  |
|  |              ALDI order        |  |  value: "ALDI order" or "Custom order"
|  |--------------------------------|  |
|  | Tag  Remembered units        > |  |
|  |              3 products        |  |  "None yet", "1 product", "3 products"
|  +--------------------------------+  |
|  ACCOUNT ...                         |
```

Icons: `ArrowUpDown`, `Tag`. Values refetch on focus. Category mapping and connected apps are out of Stage 2 (not shown).

Sub-pages use the app bar variant with back: `[<] Title`, back `ChevronLeft` 44px to `/settings`, page title `<h1>` `text-xl`.

---

## 2. Aisle order (`/settings/aisle-order`)

Purpose: the order of groups in shop mode, so the list follows the walk through the store. Default is the ALDI walk order the catalogue ships with.

```
+--------------------------------------+
| [<] Aisle order                      |
+--------------------------------------+
|  Shop mode follows this order, top   |  text-base muted
|  to bottom. Drag the handle, or use  |
|  the arrows.                         |
|  Saved                               |  status line text-sm muted (aria-live polite)
| +----------------------------------+ |
| | 1  Fruit & Veg    [^] [v]  [::]  | |  row 64px: number | name | up 44 | down 44 | handle 44
| |----------------------------------| |
| | 2  Bakery         [^] [v]  [::]  | |
| | 3  Meat & Seafood [^] [v]  [::]  | |
| | ...                              | |
| | 15 Other          [^] [v]  [::]  | |
| +----------------------------------+ |
|  [ RotateCcw  Reset to ALDI order ]  |  secondary 56px (disabled when already default)
+--------------------------------------+
```

- Rows: the 15 groups (names from `GET /api/groups`: Fruit & Veg, Bakery, Meat & Seafood, Deli, Dairy & Eggs, Pantry, Snacks & Confectionery, Drinks, Health & Beauty, Baby, Household & Cleaning, Pet, Frozen, Liquor, Other, as seeded in `DEFAULT_GROUPS`). Row: position number `text-sm` 700 muted tabular (24px column), name `text-lg` 600 (2-line clamp), then three 44x44 controls. At 358px content width the name column is about 170px.
- **Move up / Move down**: `ChevronUp` / `ChevronDown` buttons, `aria-label="Move {name} up"` / `"Move {name} down"`. Up is `aria-disabled` on the first row and down on the last (40% opacity, stays in focus order). Tapping swaps the row with its neighbour (150ms slide; instant under reduced motion). **Focus stays on the same button of the moved row** (if that button becomes disabled at an end, focus moves to the other arrow). Live region (polite): "Dairy & Eggs moved up. Position 4 of 15."
- **Drag handle**: `GripVertical` 24px in 44x44, `touch-action: none`, pointer only (`aria-hidden="true"`, `tabindex="-1"`): the arrow buttons are the keyboard and screen reader path. Drag: lift (scale 1.02, `shadow-sheet` in light / `border` in dark, 150ms), other rows shift, auto-scroll near the viewport edges, drop to commit. Escape or dragging out of the list cancels. Haptic tick on pickup where supported.
- Row `<li>` inside `<ol aria-label="Aisle order">`; numbers renumber live.
- **Saving**: each change saves immediately (debounced 400ms so quick successive moves send once). Status line shows "Saving..." then "Saved" (with `Check` 14px, `success`). On failure: roll back to the last saved order and show inline `danger-soft` banner above the list, "Couldn't save the new order. Please try again." with "Try again" button (`role="alert"`). Concurrent change from the other phone (409): banner `warning-soft` "Changed on another phone." with "Show latest".
- **Reset to ALDI order**: opens `alertdialog` sheet, title "Reset the aisle order?", body "Groups go back to the usual ALDI walk order. Your lists will follow it straight away.", buttons "Reset order" (primary) / "Cancel" (initial focus). Disabled (`aria-disabled`, helper text-sm "Already using the ALDI order.") when the order equals the default. Success: toast "Aisle order reset to ALDI order" with Undo (5s) restoring the custom order.
- **Settings value** on the previous screen switches between "ALDI order" and "Custom order" by comparing to the default.
- The Search category chips and shop mode group order both read this order (new groups, if ever added, append before "Other").

### States
| State | Content |
|---|---|
| Loading | 15 skeleton rows (64px); controls hidden. Delay 150ms. |
| Error | `CloudOff`, "Couldn't load your aisle order", "Something went wrong. Please try again.", "Try again". |
| Offline | Shell Offline banner; controls `aria-disabled`; helper "You're offline. Reconnect to change the order." |
| Saved | Status line "Saved". |

---

## 3. Remembered units (`/settings/units`)

Purpose: products where you chose a different unit and ticked "Remember {unit} for this product" in the quantity modal (`quantity-modal.md` section 4). Spec 3.2, backlog B-004.

```
+--------------------------------------+
| [<] Remembered units                 |
+--------------------------------------+
|  Trolley opens these products in the |
|  unit you chose last time.           |
|  [ (Search) Filter products       ]  |  filter field 56px, shown only with 8+ rows
| +----------------------------------+ |
| | [img] Riverina Fresh Milk        | |  row 72px: thumb 48 | name + meta | remove 44
| |       Opens in L (usually pack)  | |  meta text-sm muted
| |                          [Trash] | |
| |----------------------------------| |
| | [img] Loose Bananas              | |
| |       Opens in each (usually kg) | |
| +----------------------------------+ |
+--------------------------------------+
```

- Row: thumb 48x48 (same image rules and initial fallback as `search.md` 2.3), name `text-lg` 600 2-line clamp, meta `text-sm` `text-muted`: "Opens in {unit} (usually {default unit})". Unit labels as in the quantity modal (each, pack, kg, g, L, mL).
- Remove: `Trash2` icon button 44x44, `aria-label="Forget {unit} for {name}"`. Immediate, no confirm; the row collapses; toast "{name} will open in {default unit} again" with Undo (5s). Failure: rollback with toast "Couldn't save. Check your connection."
- Sorted by name A to Z. No add or edit here (set from the quantity modal only). Count in the Settings row reflects rows.
- Filter field (8+ rows only): `<input type="search">`, placeholder "Filter products", label hidden "Filter remembered units", matches on name, no debounce, "No matches for 'xyz'." text when empty.

### States
| State | Content |
|---|---|
| Loading | 4 skeleton rows. |
| Empty | `Tag` 48px on `accent-soft` circle. Heading "No remembered units". Body "When you pick a different unit in the quantity box and tick Remember, it shows up here." No button. |
| Error | `CloudOff`, "Couldn't load remembered units", "Try again". |
| Offline | Shell Offline banner; Remove buttons `aria-disabled`; tapping shows toast "You're offline. Reconnect to change this." |

Focus: after removing, focus moves to the next row's Remove button (or the page heading when the list is empty). Live region: "{name} forgotten. {n} remaining."
