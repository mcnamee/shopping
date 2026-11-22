# Templates tab (Stage 2)

Tokens: `tokens.md`. Shell, `StatusBanner`, BottomSheet: `app-shell.md`. `Toast`: `search.md` 2.6. Item edit sheet and target picker: `quantity-modal.md` sections 9 and 10. Template-to-list merging and the New list sheet: `lists.md`. Criteria: `docs/stages/stage-2.md` section B. Routes: `/templates`, `/templates/new`, `/templates/:id`. Copy is Australian English.

Merge rule everywhere (D-046): same product and same unit sums the quantity; a different unit is a separate row.

---

## 1. Templates list (`/templates`)

```
+--------------------------------------+
|  Templates                       (+) |  app bar; (+) Plus 44px, aria-label "New template"
+--------------------------------------+
| [status banner if offline/error]     |
| ( All )( Weekly )( Meal )            |  filter chips 44px (same CategoryChips style, radiogroup)
| +----------------------------------+ |
| | Weekly basics     [Weekly]     > | |  card: surface, radius-md, padding 16, min 88px
| | 24 items                         | |  text-sm muted
| | Milk, Bananas, Bread, Eggs, +20  | |  preview 1 line, text-sm muted, ellipsis
| +----------------------------------+ |
| | Tacos             [ Meal ]     > | |
| | 9 items                          | |
| | Mince, Taco shells, Cheese, +6   | |
| +----------------------------------+ |
|                                      |
|                  [ + New template ]  |  extended button 56px, accent, right gutter,
+--------------------------------------+     bottom = nav + 16
```

- Sorted weekly first, then by name A to Z (B1). Whole card is a link to `/templates/:id`; accessible name "Weekly basics, weekly template, 24 items".
- **Type badge** (`TypeBadge`, `text-xs` 700, `radius-full`, padding 4px 10px, icon 14px + text; never colour alone):
  - Weekly: `accent-soft` bg, `accent` text, icon `CalendarDays`, label "Weekly".
  - Meal: `surface-raised` bg, 1px `border`, `text` text, icon `UtensilsCrossed`, label "Meal".
- Preview line: first 3 item names (by group order) then ", +N" when more; hidden for empty templates (shows "No items yet").
- Chips: All (default), Weekly, Meal; filter is client side, remembered in the URL (`?type=meal`, replace). Empty filter result: "No meal templates yet" with the "New template" button preset to Meal.
- Limit 50 templates: at 50, "New template" shows toast "You have 50 templates, which is the most Trolley allows."

### States
| State | Content |
|---|---|
| Loading | 3 skeleton cards (88px). Delay 150ms. `aria-busy`, hidden "Loading templates". |
| Empty | `LayoutTemplate` 48px on `accent-soft` circle. Heading "No templates yet". Body "Save your regular shops, like your weekly basics or a favourite meal, and reuse them in a tap." Primary "Plus New template" 56px. Secondary link-button "Add from Search" (goes to `/search`) is not shown (needs a template first). |
| Error | `CloudOff`, "Couldn't load your templates", "Something went wrong. Please try again.", "Try again". |
| Offline | Shell Offline banner; cached cards stay; "New template" disabled with toast "You're offline. Reconnect to create a template." |

---

## 2. Create / edit template (`/templates/new`, `/templates/:id`)

Full-screen page (not a sheet): there is a list of items to manage. Same page for create and edit.

```
+--------------------------------------+
| [<] Weekly basics            [ Save ]|  header 56px: back 44 | title (name or "New template") | Save 44px text button
+--------------------------------------+
|  Name                                |
|  [ Weekly basics                  ]  |  input 56px, max 60
|                                      |
|  Type                                |
|  [ Weekly ][ Meal ]                  |  segmented, 2 x 48px, radiogroup
|  For items you buy most weeks.       |  helper text-sm muted, changes with choice
|                                      |
|  ITEMS (24)                          |  label text-xs uppercase muted
| +----------------------------------+ |
| | Full Cream Milk     2 x  [Trash] | |  row 64px: body (edit) | qty | delete 44
| | 2 L . Riverina Fresh             | |  meta: pack size . note
| +----------------------------------+ |
| | Bananas             6    [Trash] | |
| | Loose, ripe ones                 | |
| +----------------------------------+ |
|  [ + Add items ]                     |  secondary (accent outline) 56px, full width
|                                      |
|  [ ListPlus  Add to a list ]         |  secondary 56px (edit mode with items only)
|  [ Delete template ]                 |  danger text button 56px (edit mode only)
+--------------------------------------+
```

The bottom nav stays visible; page padding-bottom = nav + 16.

### 2.1 Fields
- **Name**: required, trimmed, 1-60 chars, `autocapitalize="sentences"`, placeholder "e.g. Weekly basics". Errors: empty "Enter a name for this template."; over 60 "Keep it to 60 characters or fewer." Shown on blur and on Save, with `CircleAlert` icon and `aria-describedby`; focus moves to the invalid field. On `/templates/new` initial focus goes to the Name field only if the user used a keyboard; on touch to the page heading.
- **Type**: segmented radiogroup Weekly / Meal. Default Weekly, or Meal if arrived from the Meal filter. Selected: `accent` bg, `on-accent`, `Check` icon; unselected: `surface`, 2px `border`. Helpers: Weekly "For items you buy most weeks. Pre-ticked when you start a new list." Meal "For a specific meal, like tacos. Add it to a list when you need it." Changing type is saved with the rest.
- **Save**: header text button (44px, `accent`, 700) and mirrored by the keyboard Enter on Name. Disabled (`aria-disabled`) until something changed. Saving: "Saving..." spinner. Success: toast "Saved Weekly basics"; on create, route replaces to `/templates/:id` (so Back goes to the list). Failure: inline `danger-soft` banner under the header, "Couldn't save that template. Please try again." Stale edit (409): banner `warning-soft` "Changed on another phone." with button "Show latest".
- **Unsaved changes**: Back with edits asks via BottomSheet `alertdialog` "Discard changes?" / "Your changes to this template haven't been saved." / "Discard" (danger) / "Keep editing" (initial focus). Item edits (below) save immediately and are not part of this guard.

### 2.2 Items list
- Each item saves immediately against the template (no Save needed), so a created template must exist first: on `/templates/new`, tapping "Add items" or "Add from search" validates the name, saves the template (name and type), then continues. Copy on the button while saving "Saving...".
- Row: body button `aria-label="Edit {name}"` (name `text-lg` 600 2-line clamp; meta `text-sm` muted 1 line: `{packSize} . {note}`), quantity `text-lg` 700 right (`2 x`, `1.5 kg`; same format as `lists.md` 3.4), trash icon button 44x44 (`Trash2`, `aria-label="Remove {name}"`).
- Sort: by household aisle order (group), then name; shown as one flat list without group headers.
- **Edit**: tap the row body opens the quantity modal in **Edit mode** (no target row, no "Remove from list" button; Remove lives on the row). Button "Save". 
- **Delete**: trash icon removes immediately; toast "Removed {name}" with Undo (5s). Undo restores qty/unit/note. No swipe on this screen (the trash button is already one tap and avoids gesture conflicts with page scrolling).
- **Add items**: button "Plus Add items" navigates to `/search?template=:id` (see `lists.md` 3.10 for the Search context bar: "Adding to template Weekly basics" with Done). The quantity modal opens in template mode with this template preselected. Returning to the template page refetches; newly added rows highlight 2s (`accent-soft`).
- Merge on add: same product and unit sums; toast "Added 2 x Milk 2L to Weekly basics" (summed: "Now 4 x Milk 2L in Weekly basics").
- Limit 100 items: adding fails with banner in the modal "This template is full (100 items). Remove something first."
- **Add to a list** (edit mode, 1+ items): opens a BottomSheet "Add to a list" with active lists as 56px radio rows (this week first, badge "This week"), plus "New list" row (opens the New list sheet with this template pre-ticked). Primary "Add to {list}" (truncate 20 chars). Result toast "Added 24 items to Week of 23 Nov (4 combined)" with Undo (8s) when merged quantities can be reverted. No lists: sheet shows "You don't have a list yet." with "New list".
- **Delete template**: danger text button, 56px. Confirm alertdialog: title "Delete {name}?", body "Lists you've already made from it won't change.", buttons "Delete template" (danger) / "Cancel" (initial focus). Success: route to `/templates`, toast "Deleted {name}" (no undo).

### 2.3 States
| State | Content |
|---|---|
| Loading (edit) | Name and type skeletons, 4 skeleton item rows. |
| Empty items | In place of rows: dashed `border` box, `ShoppingBasket` 32px `text-muted`, "No items yet", "Add the things you buy for this." plus the "Add items" button below as usual. "Add to a list" hidden. |
| Error (load) | `CloudOff`, "Couldn't load this template", "Try again". 404: "That template isn't here any more." + "Back to templates". |
| Offline | Shell Offline banner; fields and buttons that need the network show `aria-disabled`; Save helper "You're offline. Reconnect to save." (name and edits kept in the form). |
| Item mutation failure | Roll back; toast "Couldn't save. Check your connection." with "Try again". |

### 2.4 A11y and focus
- `<h1>` is the page title (template name, or "New template"). Items are a `<ul aria-label="Items in {name}">`.
- Tab order: Back, Save, Name, Type, each item (body, trash), Add items, Add to a list, Delete template.
- Focus after removing an item moves to the next item's body (or "Add items" when none remain); after adding via Search, returning focus goes to the page heading.
- Live region: "Removed Bananas. 23 items.", "Saved."
- Tap targets: body 64px tall, trash 44, header Save 44, segmented 48, buttons 56.
