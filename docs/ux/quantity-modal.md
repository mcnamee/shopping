# Quantity modal (Stage 1)

Bottom sheet opened by **Add** on a search card (`search.md`) and after saving a custom product. Tokens: `tokens.md`. Sheet pattern, scrim, focus rules: `app-shell.md` section 3 (sign out confirm). Toast: `search.md` 2.6. Spec ref: PRODUCT_SPEC 3.2. Copy is Australian English.

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
|  (Stage 2: "Add to" list row here)   |  hidden in Stage 1
|                                      |
|  [        Add to list           ]    |  primary 56px, sticky footer
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
- When the chosen unit differs from the product's current default, show beneath the control a 44px checkbox row: "Remember {unit} for this product" (default checked, stored as the household unit override, spec 3.2). Hidden when the unit matches the default.

## 5. Note
- Label "Note (optional)". `<textarea>` 2 rows (auto-grows to 3), `text-base`, `surface` bg, 2px `border`, `radius-md`, padding 12px. Placeholder "e.g. get white if red is out of stock". `maxlength` 140; counter `text-sm` `text-muted` ("112/140") appears from 100 chars. `enterkeyhint="done"`: Enter blurs instead of inserting a newline (single paragraph notes only).
- On focus, the field scrolls into view above the keyboard.

## 6. Footer and confirm
- Primary **Add to list**: `accent` bg, `on-accent`, `text-lg`, 56px, `radius-md`, full width. Cancel: secondary (transparent, 2px `border`, `text`), 56px.
- Do not rename the button per stage; behaviour sits behind a single "confirm" action so Stage 2 can swap the target without a UI change.
- Stage 1 (no lists yet): confirm saves the item to the local draft (PM to decide where it is stored), closes the sheet with a 150ms slide-down, returns focus to the originating card's Add button (which shows "Added"), and shows the toast "Lists arrive soon - added to your draft". If PM decides the draft is not kept, use the neutral toast "Lists arrive soon" with the same slot and no other change.
- Stage 2 (reserved layout): a "Add to" row (label + select or tappable row, 56px, defaulting to "This week's list") sits between Note and the footer, plus a toast "Added 2 L Full Cream Milk" with an Undo text button.
- Submitting state (if the confirm is async): button "Adding..." with spinner, controls disabled. Failure: inline `danger-soft` banner above the footer, "Couldn't add that item. Please try again." (`role="alert"`), sheet stays open, values kept.

## 7. Keyboard, focus and gestures
- Semantics: `role="dialog"` `aria-modal="true"` `aria-labelledby` = product name. Background content `inert`; page scroll locked.
- Initial focus: the product name heading (`tabindex="-1"`), so no keyboard opens automatically. Focus is trapped; Tab order: Close, quantity minus, value field, plus, presets, unit segments, remember checkbox (if shown), note, Add to list, Cancel. On close, focus returns to the control that opened it.
- Esc, scrim tap, Close, Cancel and drag down all dismiss and discard changes without confirmation.
- Drag to dismiss: drag the handle zone or header. Dismiss if dragged down more than 25% of the sheet height or released with a downward flick; otherwise spring back. The scrollable middle does not initiate dismissal. Reduced motion: no spring, instant snap.
- On-screen keyboard: size the sheet to the visual viewport (`visualViewport` height) so the footer sits directly above the keyboard and the focused field is scrolled into view; if height is below about 480px, the sheet's middle scrolls and the product header collapses to a single line (thumb 40px, name only). The Cancel button may be pushed below the fold, so Close (X) stays the always-visible exit.
- Safe area: sheet padding-bottom `max(safe-bottom, 16px)`; sheet side padding `max(16px, safe-left/right)`.
- Live region (`aria-live="polite"`, visually hidden): announces quantity changes from steppers/presets ("Quantity 1.5 litres"), limits and unit changes. Do not announce on every keystroke of typed entry.

## 8. States
- Normal: as above. Loading: not applicable (all data comes from the card or the saved custom product). If the product image is slow, the initial placeholder shows.
- Discontinued product (opened from a future list): no change in Stage 1.
- Offline: no change; adding to the local draft needs no network. If Stage 2 sends to the API, use the failure banner above with copy "You're offline. Reconnect to add this item."
- Large text: header wraps to 2 lines; stepper keeps 56px buttons; the middle area scrolls rather than shrinking tap targets.
