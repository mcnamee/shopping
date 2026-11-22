# Suggest items (Stage 3)

Review flow for AI auto-generate (PRODUCT_SPEC 3.5). Tokens: `tokens.md`. Reuses `BottomSheet` (`lists.md` section 0 / `app-shell.md` section 3), `Toast` with Undo (`search.md` 2.6, `lists.md` undo rules), the stepper and quantity rules (`quantity-modal.md` section 3), and chips (`quantity-modal.md` presets). Copy is Australian English. The flow never writes to the list until the user confirms.

## 1. Entry points

| Where | Control | Notes |
|---|---|---|
| Shop mode options sheet (`lists.md` 3.7) | Row "Suggest items", lucide `Sparkles` 24px, placed under "Add from template" | Main entry on a list with items. Active lists only (not archived). |
| Empty list state (`lists.md` 3.11) | Third button under "Add items" and "Add from template": "Suggest items" (secondary, `Sparkles`), 56px | Shop mode header stays uncluttered: no extra header icon. |
| New list sheet (`lists.md` 2) | Third option in "Start with" segmented: `[ Blank ][ From templates ][ Suggestions ]` (label "Suggestions", segment aria-label "Start with suggestions") | Replaces the reserved "Suggest items" slot. Choosing it hides the template checklist and shows helper "We'll look at what you usually buy and suggest items to review." Footer button reads "Create and suggest". |
| Offline | Row/buttons `aria-disabled`; tap shows toast "You're offline. Reconnect to get suggestions." | Suggestions need the server. |

"Create and suggest": creates a blank list first (name and "Set as this week" rules as in `lists.md` 2), routes to `/lists/:id`, then opens the Suggestions sheet at once in its loading state. If the user cancels or adds nothing, the blank list stays (toast on close: "Created Week of 23 Nov"). Create failure uses the sheet's existing error banner.

## 2. Sheet states

One `BottomSheet`, title "Suggested items" (`text-xl`), height up to 90dvh, header close X 44px. Body swaps between states below; the footer exists only in Review. Initial focus: title.

### 2.1 Loading (up to about 8s)

```
+--------------------------------------+
|                ----                  |
|  Suggested items                 (X) |
|                                      |
|  (spinner)  Looking at what you      |  text-lg 600; spinner 24px accent
|  usually buy...                      |
|  This can take a few seconds.        |  text-sm muted, appears after 3s
|                                      |
|  FRUIT & VEG                         |  skeleton group header
|  [ ] [=========]          [-- 1 +]   |  skeleton rows x 6, 64px,
|      [=====]                         |  shimmer (static in reduced motion)
|  [ ] [==========]         [-- 2 +]   |
|  DAIRY & EGGS                        |
|  [ ] [========]           [-- 1 +]   |
|                                      |
|  [        Cancel        ]            |  secondary 56px, sticky footer
+--------------------------------------+
```

- Progress copy rotates once, never more: 0 to 4s "Looking at what you usually buy..."; after 4s "Checking what's due this week..."; after 8s "Nearly there..." (never an error before the timeout).
- Cancel (also Close, Esc, scrim, drag) aborts the request and closes with no toast. Nothing is added.
- Timeout (20s) or request failure: deterministic suggestions are returned by the server in the same call, so this only shows when the server is unreachable. Body: `CircleAlert`, "Couldn't get suggestions right now." with "Try again" (primary 56px) and "Close". `role="alert"`.
- Live region: announces "Looking for suggestions" once on open, then "Suggestions ready, 14 items" or the empty/cold-start message.

### 2.2 Review

```
+--------------------------------------+
|                ----                  |
|  Suggested items                 (X) |
|  14 of 14 selected   [Select none]   |  text-sm; toggle text button 44px
|                                      |
|  FRUIT & VEG                    4    |  group header 40px, text-xs 700 uppercase,
|--------------------------------------|  count of rows in group
| [x] Bananas            [ - 6 + ]     |  row min 72px: checkbox | name+reason | stepper
|     Usually every week               |  reason text-sm muted, 1 line, ellipsis
|--------------------------------------|
| [x] Potatoes        [ - 1.5 kg + ]   |
|     Last bought 27 days ago - usual..|
|--------------------------------------|
| [x] Carrots 1 kg       [ - 1 + ]     |
|     From Weekly basics  [Template]   |  source badge, see below
| DAIRY & EGGS                    3    |
| [ ] Full Cream Milk 2 L [ - 2 + ]    |  unticked row: stepper disabled look, 60% text
|     Usually every 2 weeks            |
| ...                                  |
|--------------------------------------|
| [   Add 14 items   ]                 |  primary 56px, sticky footer
| [      Cancel      ]                 |  secondary 56px
+--------------------------------------+
```

- **Grouping and order**: by the household's aisle order (same groups and order as shop mode, `lists.md` 3.3). Within a group: template items first, then history by name. Empty groups are not shown. Group headers are static (not collapsible) so everything is scannable in one scroll.
- **Row**: whole left area (checkbox 24px in a 44px target plus name) toggles selection, min row 72px. Name `text-lg` 600, 2-line clamp; pack size appended after the name in `text-muted` when known ("Full Cream Milk 2 L"). Reason line `text-sm` `text-muted`, 1 line, ellipsis; full text in the row's accessible description.
- **Pre-ticked**: every suggestion starts ticked. Unticked rows dim (text-muted colour, no strikethrough) and their stepper is `aria-disabled`; qty is kept if re-ticked.
- **Compact stepper**: [minus 44x44] [value, min 56px wide, `text-lg` 700, centred] [plus 44x44]; unit suffix after the value for non-`each` units ("1.5 kg"). Same rules as `quantity-modal.md` section 3 (step, min, max by unit type, rounding, disabled at limits, hold-to-repeat 400ms at 8 per second). Value is a tappable text input (`inputmode` per unit); on blur out-of-range or invalid values clamp to the nearest limit and announce "Quantity set to 99, the maximum". No unit change, note or presets here; edit those later in the list. Aria: group "Quantity for Bananas", buttons "Decrease quantity for Bananas" / "Increase quantity for Bananas".
- **Reason copy** (one line, always sentence case, hyphen as separator, no jargon):
  - Regular: "Usually every week" / "Usually every 2 weeks" / "Usually every 4 weeks" (round to nearest whole week; under 10 days: "Usually every few days").
  - Due: "Last bought 27 days ago - usually every 4 weeks".
  - Template: "From Weekly basics" (template name, truncated 24 chars).
  - Both template and history: show the history reason, badge still says Template.
  - Fallback when the reason is missing: "Bought before".
- **Source badge** (subtle): compact pill after the reason, `text-xs` 600, `surface` bg, 1px `border-subtle`, `text-muted`, never `accent`. Template items: icon `LayoutTemplate` 14px + "Template". History items: no badge (history is the default, so only the exception is marked, keeping rows quiet). Badge is read as part of the description ("From template").
- **Select all/none**: single text button in the sub-header, label toggles "Select none" (when all ticked) / "Select all" (otherwise); counter text "14 of 14 selected". `aria-live="polite"` on the counter. Min 44px target.
- **Footer**: primary "Add 14 items" (count tracks ticks; singular "Add 1 item"; at 0 the label is "Add items" and the button is `aria-disabled`, tapping announces "Tick at least one item"). Cancel closes with no changes and no confirmation. Footer sticky with `border-subtle` top border, bottom padding `max(safe-bottom, 16px)`. The list scrolls above it; the footer plus stepper rows sit in the lower half for one-handed use.
- **Submitting**: button "Adding..." with spinner, controls disabled. Failure: `danger-soft` banner above footer "Couldn't add those items. Please try again." (`role="alert"`), ticks and quantities kept. List-full: "Adding these would go over the 200 item limit. Untick a few and try again." (counts as the banner; button stays enabled).
- **Merging**: if a suggested product already appeared on the list the server drops it (spec 3.5 step 3), so Review never shows duplicates.
- Long lists: no cap; scroll. Keep the group header sticky (40px) while scrolling its rows.

### 2.3 Cold start (fewer than 3 archived lists)

Sheet opens straight into Review showing the Weekly template items only (reasons all "From Weekly basics"), with an info banner (`accent-soft` bg, `Info` icon, `text-sm`) above the first group:

> Not enough history yet - here are your Weekly template items. Suggestions get smarter after a few shops.

Wording deviates from the brief's "we've added" on purpose: nothing is added until the user confirms. If the household has no Weekly template either, show variant B of 2.4.

### 2.4 Nothing to suggest

Centred in the body, no footer except one button:

- Variant A (enough history, nothing due or all already on the list): `CircleCheck` 48px on `success-soft` circle, heading "You're all set", body "Nothing else looks due this week.", button "Done" (primary 56px, closes sheet).
- Variant B (cold start and no Weekly template): `ListChecks` 48px on `accent-soft` circle, heading "Nothing to suggest yet", body "Not enough history yet. Suggestions get smarter after a few shops, or add a Weekly template to start with.", buttons "Go to Templates" (primary, routes to `/templates`) and "Close".

The "nothing else looks due" phrasing from the brief is kept in the body; the heading is "You're all set".

## 3. After adding

- Sheet closes (150ms slide-down), focus returns to the control that opened it (options sheet entry returns to the options button; empty list: the list header Options button, since the empty state is replaced).
- Newly added rows land in their aisle groups; briefly highlight them (2s `accent-soft` background fade; no motion under reduced motion, static highlight 2s).
- Toast, 8 seconds, with Undo (44px): "Added 14 items" (singular "Added 1 item"). When some merged with existing rows (race with another phone): "Added 14 items (2 combined)".
- **Undo**: removes the rows this action created and reverts quantities on rows that were merged into, in one request; toast "Removed 14 items" without a second undo. Failure: rollback toast "Couldn't undo. Check your connection." with "Try again".
- Undo and the rest of the toast follow the shop-mode rule: sits above the FAB (bottom offset + 72px).
- Start-with-suggestions flow: toast text is the same ("Added 14 items"); Undo leaves the blank list in place.

## 4. AI unavailable (fallback)

- When the LLM pass fails or times out the server returns the deterministic candidates with rule-based reasons (same wording as section 2.2: "Usually every week", "Last bought 27 days ago - usually every 4 weeks", "From Weekly basics"). The UI shows no error, no banner and no change in layout.
- Decision on the "Simple suggestions" hint: **do not show it.** Reasons and ranking read the same either way, and a hint adds a thing for a shopper to wonder about without giving them an action. The response carries a `source: "rules" | "ai"` field for analytics only. Revisit if testing shows people expect smarter results and are confused.
- Quantities come from the household's average qty (rounded to the unit's step grid) in fallback mode; the stepper rules are unchanged.

## 5. Accessibility

- Sheet: `role="dialog"` `aria-modal="true"` `aria-labelledby` = title; background `inert`; focus trapped; Esc/scrim/drag dismiss as Cancel. Loading Cancel is first in tab order while loading.
- Review semantics: each group is `role="group"` labelled by its header; each row's checkbox is `role="checkbox"` with accessible name "Bananas", description "Usually every week" (and "From template" where relevant), `aria-checked`. Space toggles. Tab order per row: checkbox, minus, value, plus; select all/none button precedes the first group; primary then Cancel last.
- Selection is never colour alone: ticks use a `Check` glyph and unticked rows also show an empty box and dimmed text; the badge has an icon and text.
- Contrast: reason and badge text use `text-muted` on `surface-raised` (7.5:1 or better); minimum body 16px, reason `text-sm` 14px (secondary information only). All targets at least 44px; primary and Cancel 56px; steppers 44px (compact exception noted for the 72px row: two 44px buttons plus value fit within 358px minus 44px checkbox column and a 130px stepper block, with the name column flexing and wrapping to 2 lines at larger text scale).
- Large text: rows grow, reason wraps to 2 lines at 200% scaling, stepper stays 44px; the sheet scrolls and never clips the footer.
- Live region (`aria-live="polite"`): loading start, results ("14 suggestions"), selection count, quantity changes, limit messages, add result. Reduced motion: no shimmer, no slide.
- Dark mode: tokens only; the success and info circles use `success-soft` / `accent-soft`.

## 6. Edge cases

- Product discontinued since history: omitted by the server.
- Sheet reopened: runs again; no caching of unconfirmed results (rows might be stale), but the last request in flight is reused if reopened within 5s.
- List changed on the other phone while Review is open: on confirm the server re-checks duplicates (merge sums quantities) and the toast reports "(n combined)".
- Archived (read-only) list: entry points are not rendered.
- Ticks and quantity edits are lost on dismissal, with no confirm dialog (consistent with `quantity-modal.md`).
