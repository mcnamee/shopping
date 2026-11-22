# Stage 2b QA

Branch claude/elegant-ride-dzzdob (a91713c + 31e1575). Suite run once: lint, typecheck, unit (all workspaces), build, synth all green; e2e 113/113 passed (iphone-13), no flakes.

## Criteria
| ID | Result | Evidence |
|---|---|---|
| A1 keyboard-safe sheets | Pass (code) / Deferred (device) | BottomSheet compacts below 480px visual viewport: sheet scrolls as a whole, focused text field `scrollIntoView` on focusin plus 300ms re-reveal. All text-field sheets (edit item, quantity modal note, custom product, rename list, new list, suggest) use BottomSheet. Real iOS keyboard not testable here. |
| A2 e2e 390x380 | Pass | stage2b.e2e.ts: Note field within 0..381 and height > 0. Covers edit sheet only. |
| B1/B2 thumbnails | Pass (e2e/axe) / Deferred (phones) | stage2b e2e checks rows show thumbnails; tap-target specs still green. |
| C1 aisle-grouped template editor | Pass | templates e2e + axe green. |
| D1 Regulars type and badge | Pass | e2e creates Regulars template; badge uses Repeat icon plus text. |
| D2 Review regulars sheet | Pass | New list flow and list options "Review regulars" wired (ListPage, NewListSheet); offline guarded. |
| D3 never auto-added | Pass | suggestions.ts `weeklyLines` filters `type === 'weekly'` only; from-template is an explicit pick list. Core test covers regulars. |
| E1 investigation | Pass | D-080 documents findings. |
| E2 notAtStore | Pass | Unit tests: flagged hidden by default; flag lapses at `onSaleDate <= storeToday()` (routes pass `today`); product by SKU route is independent of the flag. Not verifiable until re-scrape (existing rows have no flag). |

## Defects
- Low: e2e for A covers only the edit sheet. Quantity modal note, custom product and rename list rely on the shared BottomSheet code path; not individually exercised at 390x380. Repro: open each at short viewport. Not blocking.
- Low (note): the template editor has no separate rename sheet (name is an inline field on the page), so it is outside BottomSheet; page scroll behaviour with keyboard there is untested.
- Info: past-dated sold-out Special Buys remain visible (D-080 limit).

## Release recommendation
Ship. No blocking defects. [U] checklist after deploy:
- [U] iPhone: type a note in edit item and quantity modal with the keyboard open; field and text stay readable.
- [U] Thumbnails load on both phones (shop mode, archived, template rows).
- [U] Dispatch scrape-fallback.yml once with Dry run UNticked to populate notAtStore; then confirm spirits and future Special Buys no longer appear in search.
- [U] Create a Regulars template, start a new list, confirm review sheet items start unticked.
