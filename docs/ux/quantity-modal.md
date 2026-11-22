# Quantity modal (Stage 1, updated for Stage 2)

Bottom sheet opened by **Add** on a search card (`search.md`), the **ListPlus** (template) icon on a card, and after saving a custom product. Stage 2 adds a target row (section 10) and an Edit mode used from shop mode and template pages (section 9). Tokens: `tokens.md`. Sheet pattern, scrim, focus rules: `app-shell.md` section 3 (sign out confirm). Toast: `search.md` 2.6. Spec ref: PRODUCT_SPEC 3.2. Copy is Australian English.

## 1. Layout (390px)

```
+--------------------------------------+
|               ------                 |  drag handle, 44px tall touch zone
|  [img] Full Cream Milk           (X) |  header: thumb 56px, name text-lg 2-line clamp,
|  [56 ] 2 L . Brand name              |  pack size + brand text-sm muted, close X 44px
|                                      |
|  Quantity                            |  label text-sm 600
|  +------+  +----------------+ +----+ |
|  |  -   |  |    1   L       | | +  | |  stepper: 56px buttons, value field 56px, text-2xl
|  +------+  +----------------+ +----+ |
|  ( 0.5 L )( 1 L )( 1.5 L )( 2 L )    |  presets row (kg/g/L/mL only), chips 44px
|                                      |
|  Unit                                |  label text-sm muted
|  [each][pack][ kg ][ g ][ L ][ mL ]  |  segmented, 44px, text-sm, secondary look
|                                      |
|  Note (optional)                     |  label text-sm 600
|  [ e.g. get white if red is out   ]  |  textarea 2 rows, 140 max
|  [ of stock                       ]  |
|                                      |
|  Adding to                           |  target row, 56px, tappable (section 10)
|  [ Week of 23 Nov (This week)  v ]   |  label text-sm muted, value text-lg 600
|                                      |
|  [     Add to Week of 23 Nov    ]    |  primary 56px, sticky footer, label names the target
|  [        Cancel                ]    |  secondary 56px
|  (safe-bottom)                       |
+--------------------------------------+
```

- Sheet: `surface-raised`, `radius-lg` top corners, `shadow-sheet`, `scrim` behind, side padding 16px, max-height 90dvh. Header and footer are fixed within the sheet; the middle (quantity, unit, note) scrolls if the sheet or keyboard leaves too little room. Footer has `border-subtle` top border and bottom padding `max(safe-bottom, 16px)`.
- All key controls (stepper, presets, Add) sit in the lower half of the screen for one-handed use. Opening animation: slide up 150ms; reduced motion: fade.
- Wireframe shows the common case (1 x 2 L milk). For `each`/`pack`, the presets row is absent and the sheet is shorter.

## 2. Header
- Thumb: 56x56, `radius-sm`, same image rules and initial fallback as the card.
- Name: `text-lg` (600), up to 2 lines. Beneath: pack size then " . " then brand, `text-sm` `text-muted`, 1 line truncate. Custom products show "Custom item" instead of brand.
- Close: lucide `X`, 44x44, `aria-label="Close"`. Same as Cancel.

## 3. Quantity control by unit type

| unitType | Default | Step | Min | Max | Typed precision | Presets |
|---|---|---|---|---|---|---|
| `each` | 1 | 1 | 1 | 99 | whole | none |
| `pack` | 1 | 1 | 1 | 99 | whole | none |
| `kg` | 1 | 0.25 | 0.05 | 20 | 2 dp | 0.5, 1, 1.5, 2 |
| `g` | 500 | 100 | 10 | 20000 | whole | 250, 500, 1000 |
| `L` | 1 | 0.5 | 0.1 | 20 | 2 dp | 0.5, 1, 1.5, 2 |
| `mL` | 500 | 250 | 50 | 20000 | whole | 250, 500, 750, 1000 |

The modal opens at the default for the product's effective `unitType` (household override if one exists, else the inferred one).

### Stepper
- Layout: [minus 56x56] [value field flex, 56px] [plus 56x56], gap 8px. Buttons: `surface` bg, 2px `border`, `radius-md`, lucide `Minus`/`Plus` 24px, `aria-label="Decrease quantity"` / `"Increase quantity"`. Pressed: `accent-soft`. Press-and-hold repeats after 400ms at 8 steps per second (not faster).
- Minus disabled when `value - step < min`; plus disabled when `value + step > max`. Disabled: 40% opacity and `aria-disabled="true"` (stays in focus order). Hitting a limit announces "Minimum reached" / "Maximum reached" through the live region.
- Value field: `<input type="text" inputmode="decimal">` for kg/L (`inputmode="numeric"` for whole-number units), `text-2xl` 700, centred, 2px `border`, `radius-md`, unit suffix in `text-lg` `text-muted` after the number (rendered outside the input, `aria-hidden`; unit is included in the field's accessible name: "Quantity in kg"). Selects all text on focus. `enterkeyhint="done"`: Enter commits the value and blurs.
- Stepper results are rounded to the unit's precision to avoid float artefacts (e.g. 0.75 not 0.7500001). Stepping from an off-grid typed value (e.g. 1.3 kg) goes to the next multiple of the step (1.5 / 1.25) in the pressed direction.
- Presets: chips 44px tall, `radius-full`, `text-base` 600, label includes the unit ("0.5 L", "250 g"; 1000 g shows "1 kg" label but sets 1000 g). Selected when equal to the current value: `accent` bg, `on-accent`, `Check` icon; else `surface` with 2px `border`. Row wraps if needed (no horizontal scroll, max 4 chips).

### Typed entry and validation
- Accepts digits and one decimal separator (`.` or `,`, normalised to `.`); strip other characters as typed.
- Validate on blur, on Enter and on tapping Add to list. While typing show no error (avoids flicker).
- Invalid -> field border `danger`, `CircleAlert` icon + `text-sm` `danger` message directly below the stepper, `aria-invalid="true"`, `aria-describedby`. The Add button is `aria-disabled` and, if activated, moves focus to the field.
- Messages:
  - Empty: "Enter a quantity."
  - Not a number: "Use numbers only, like 1.5."
  - Whole-number units with decimals: "Use a whole number, like 2."
  - Below min / above max: "Enter an amount from 0.05 to 20 kg." (min/max and unit from the table; whole numbers use "from 1 to 99")
  - Too many decimals (kg/L): rounds to 2 dp silently; no error.
- On blur with a valid value, reformat (trim trailing zeros: "1.50" becomes "1.5").

## 4. Unit override (secondary)
- Label "Unit" `text-sm` `text-muted`; segmented control (radiogroup) with each, pack, kg, g, L, mL, 44px tall, `text-sm` 600, equal widths (about 58px each at 358px). Selected: `accent-soft` bg, `accent` text, 2px `accent` border, `Check` icon omitted for space but the border and 600 weight differ (no colour-only: selected segment also has a thicker 2px border vs 1px). Unselected: `surface`, 1px `border`. Visually quieter than the stepper and presets.
- Changing unit: converts within a family (kg<->g, L<->mL; e.g. 1.5 kg becomes 1500 g, 500 mL becomes 0.5 L; result clamped to the new range); changing between families (e.g. kg to each) resets to the new unit's default. Presets and step update immediately; the live region announces "Unit changed to grams, quantity 1500".
- Stage 2 enables this (backlog B-004). When the chosen unit differs from the product's effective default (household override if any, else the inferred unit), show beneath the control a 44px-tall checkbox row (whole row toggles, 24px box): "Remember {unit} for this product", default checked, helper `text-sm` muted "Next time it opens in {unit}. You can undo this in Settings." Hidden when the unit matches the effective default.
- On confirm with the box ticked, the unit is saved as the household unit override (both phones); unticked applies the unit to this item only. The override is listed in Settings > Remembered units (`settings-stage2.md`).
- If an override exists and the user switches back to the inferred unit, the same row appears as "Go back to {unit} for this product" (default checked); confirming removes the override.
- If saving the override fails but the item saved, show toast "Added, but couldn't remember the unit." (item is not rolled back).
- In Edit mode and Template mode the checkbox behaves the same.

## 5. Note
- Label "Note (optional)". `<textarea>` 2 rows (auto-grows to 3), `text-base`, `surface` bg, 2px `border`, `radius-md`, padding 12px. Placeholder "e.g. get white if red is out of stock". `maxlength` 140; counter `text-sm` `text-muted` ("112/140") appears from 100 chars. `enterkeyhint="done"`: Enter blurs instead of inserting a newline (single paragraph notes only).
- On focus, the field scrolls into view above the keyboard.

## 6. Footer and confirm
- Primary **Add to list**: `accent` bg, `on-accent`, `text-lg`, 56px, `radius-md`, full width. Cancel: secondary (transparent, 2px `border`, `text`), 56px.
- Stage 2 replaces the Stage 1 draft behaviour (D-026): confirm now persists to the chosen target (section 10).
- Button label names the target (stage-2 C3): "Add to {target name}", truncated to 22 characters with an ellipsis (full name in `aria-label`, e.g. "Add to Week of 23 Nov"). Template targets read "Add to {template name}". Edit mode reads "Save" (section 9).
- On success: close with the 150ms slide-down, return focus to the control that opened the sheet (the card's Add button then shows "Added" for 1.5s; the ListPlus button shows no state), and show a toast with **Undo** (duration 5s; Undo removes the add or reverts a merged quantity). Wording: lists "Added 1.5 kg Potatoes to Week of 23 Nov"; templates "Added 2 x Milk 2L to Tacos" (`each`/`pack` as `2 x`; weights and volumes as `1.5 kg`). When it merged into an existing row (same product and unit, D-046): "Updated Full Cream Milk: now 3 x in Week of 23 Nov" (template: "...in Tacos").
- If no list is flagged "this week" and the target is the default, confirm creates a blank list "Week of {Monday d MMM}", flags it and adds the item (stage-2 C2); toast "Added 1.5 kg Potatoes to a new list, Week of 23 Nov".
- Submitting state (if the confirm is async): button "Adding..." with spinner, controls disabled. Failure: inline `danger-soft` banner above the footer, "Couldn't add that item. Please try again." (`role="alert"`), sheet stays open, values kept. Full target (list 200 items, template 100): banner "This list is full (200 items). Remove something first." / "This template is full (100 items). Remove something first."

## 7. Keyboard, focus and gestures
- Semantics: `role="dialog"` `aria-modal="true"` `aria-labelledby` = product name. Background content `inert`; page scroll locked.
- Initial focus: the product name heading (`tabindex="-1"`), so no keyboard opens automatically. Focus is trapped; Tab order: Close, quantity minus, value field, plus, presets, unit segments, remember checkbox (if shown), note, target row (Add modes), primary button, Cancel, then "Remove from list" (Edit mode, list items only). On close, focus returns to the control that opened it.
- Esc, scrim tap, Close, Cancel and drag down all dismiss and discard changes without confirmation.
- Drag to dismiss: drag the handle zone or header. Dismiss if dragged down more than 25% of the sheet height or released with a downward flick; otherwise spring back. The scrollable middle does not initiate dismissal. Reduced motion: no spring, instant snap.
- On-screen keyboard: size the sheet to the visual viewport (`visualViewport` height) so the footer sits directly above the keyboard and the focused field is scrolled into view; if height is below about 480px, the sheet's middle scrolls and the product header collapses to a single line (thumb 40px, name only). The Cancel button may be pushed below the fold, so Close (X) stays the always-visible exit.
- Safe area: sheet padding-bottom `max(safe-bottom, 16px)`; sheet side padding `max(16px, safe-left/right)`.
- Live region (`aria-live="polite"`, visually hidden): announces quantity changes from steppers/presets ("Quantity 1.5 litres"), limits and unit changes. Do not announce on every keystroke of typed entry.

## 8. States
- Normal: as above. Loading: not applicable (all data comes from the card or the saved custom product). If the product image is slow, the initial placeholder shows.
- Discontinued product (opened from a future list): no change in Stage 1.
- Offline: the primary button stays enabled; on tap the failure banner shows "You're offline. Reconnect to add this item." (Edit mode: "...to save this change."). The target row and picker use cached lists and templates; creating a new list or template inside the picker is disabled offline.
- Large text: header wraps to 2 lines; stepper keeps 56px buttons; the middle area scrolls rather than shrinking tap targets.

## 9. Edit mode (from shop mode rows and template item rows)

Same sheet and controls (header, stepper, presets, unit, remember checkbox, note) prefilled with the row's quantity, unit and note. Differences:
- No target row. Header unchanged (image, name, pack size, brand).
- Primary button "Save" (disabled until something changes; `aria-disabled`). Cancel as before; closing with unsaved changes discards without confirmation.
- List item rows only: under Cancel, a text button "Remove from list" (`Trash2` 20px, `danger` text, 56px). It closes the sheet and runs the delete with toast "Removed {name}" and Undo (5s). Template item rows have their own trash button, so no remove button there.
- Opens with the stepper at the saved quantity even if off the unit's step grid (e.g. 1.3 kg stays 1.3 until stepped).
- Success: no toast; the row updates in place. Stale edit (409): sheet closes, toast "Changed on another phone - showing latest". Failure: banner "Couldn't save that change. Please try again." (`role="alert"`).
- Initial focus: product name heading, as for Add. On close, focus returns to the row's edit button.

## 10. Target row and picker (Add modes)

### 10.1 Which target is preselected
1. Search opened with context (`?list=` or `?template=`, `lists.md` 3.10): that list or template.
2. Opened from the **ListPlus** icon: the template last used in this session, else the picker opens first (10.4); with a single template it is preselected.
3. Opened from **Add**: the same target as the last confirmed add in this session if it is still active; else the "this week" list.
4. No active lists at all: the row reads "New list: Week of 23 Nov" (created on confirm, flagged this week).
The mode (list or template) follows the target; the ListPlus icon only sets the starting target.

### 10.2 Row
- Label "Adding to" (list) or "Adding to template" (template), `text-sm` `text-muted`; value `text-lg` 600 one line with ellipsis, then lucide `ChevronDown` 20px. The whole row is a 56px button: `surface`, 2px `border`, `radius-md`, padding 0 16px; `aria-haspopup="dialog"`, `aria-label="Adding to Week of 23 Nov, this week. Change"`.
- Value text: list names as-is, with " (This week)" suffix on the flagged one (`text-muted` weight 400). Template value shows the type badge (`templates.md` TypeBadge, compact) after the name. Pressed `accent-soft`.

### 10.3 Picker view
Tapping the row swaps the sheet body to the picker (no stacked sheet): header changes to `[<] Choose where to add` (back `ChevronLeft` 44px returns to the form with the selection kept); footer buttons are replaced by none (selection is immediate, a tap on a row selects and returns). Focus moves to the picker heading; back restores focus to the target row.

```
+--------------------------------------+
|  [<]  Choose where to add            |
|  LISTS                               |  label text-xs uppercase muted
|  ( ) Week of 23 Nov    [This week] 12/30 |  radio rows 56px, selected: accent border + Check
|  ( ) Birthday BBQ                 3/14   |
|  [ + New list ]                      |  row 56px, accent text, Plus icon
|  TEMPLATES                           |
|  ( ) Weekly basics         [Weekly] 24   |
|  ( ) Tacos                 [ Meal ]   9  |
|  [ + New template ]                  |
+--------------------------------------+
```

- `role="radiogroup"` `aria-label="Add to"` across both sections; rows are `role="radio"`. Selected row: 2px `accent` border, `accent-soft` bg, `Check` icon (not colour alone). Lists: this week first, then newest. Templates: weekly first, then by name. Right side shows progress (`12/30`) or item count.
- **New list**: reveals an inline mini form in place of the row: Name input (default "Week of 23 Nov", 1-60 chars), button "Create and select" 56px (creates a blank list, flags it this week when none is flagged) and "Cancel". Offline: disabled.
- **New template**: inline Name input (placeholder "e.g. Tacos"), Type segmented (Weekly / Meal, default Meal when opened from ListPlus), "Create and select". Same validation as `templates.md` 2.1.
- Empty sections: when there are no lists, only the "New list" row shows under LISTS; same for templates with "You don't have any templates yet." text-sm muted above the row.
- Loading (lists not cached): 3 skeleton rows. Error: inline "Couldn't load your lists. Try again." with `Try again` text button; the form stays usable with the last known target.
- Choosing a target also updates the primary button label and the label above the row.

### 10.4 ListPlus first-open
When ListPlus opens with no remembered template, the sheet opens straight on the picker (templates section first and scrolled into view, lists section below). After choosing, the form appears. With zero templates the picker shows only the "New template" row expanded.
