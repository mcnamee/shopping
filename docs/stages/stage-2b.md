# Stage 2b - Polish from first real use (user feedback 23 Nov)

## Scope and acceptance criteria
### A. Keyboard bug (High)
- A1 [S] With the on-screen keyboard open (iOS Safari/PWA), any bottom sheet with a text field (edit item, quantity modal, custom product, rename) keeps the focused field and what's typed visible above the keyboard. Footer buttons must not squash the body to zero height: when space is short the whole sheet scrolls (footer may scroll with it or collapse to a single row), and the focused field is scrolled into view.
- A2 [S] e2e: emulate a short visual viewport (e.g. 390x380) with the note field focused; the note input is within the visible sheet area and has height > 0.
### B. Product images on lists and templates
- B1 [S] Shop-mode rows, archived list rows, template item rows and the suggestions review rows show a small square product thumbnail (40px, lazy, rounded) left of the name, with the existing letter fallback; custom products use the fallback. Tick target and tap sizes unchanged (row still >= 56px, whole row ticks).
- B2 [S] Ticked rows dim the thumbnail with the text.
### C. Template items grouped like lists
- C1 [S] Template editor shows items grouped by household group in aisle order (same headers and sort as shop mode, no ticks/progress).
### D. New template type: "Regulars"
- D1 [S] Template type options: Weekly, Meal, Regulars ("Things we buy now and then - review each shop"). Badge colour distinct.
- D2 [S] When creating a list (any start option) and from the list options sheet ("Review regulars"), if the household has a Regulars template, a review sheet lists its items grouped by aisle, all UNticked by default; ticking + confirming adds them (bulk add, merge rule, Undo toast). Reuses the suggestions review sheet component.
- D3 [S] Regulars items are not auto-added by suggestions or "from template" defaults unless explicitly picked; suggestions engine treats Regulars like Meal (not weekly).
### E. Store-specific catalogue
- E1 [S] Investigate whether ALDI's API exposes per-store availability beyond `servicePoint` (already G526 Casey). Report findings in DECISIONS.
- E2 [S] If a reliable signal exists, the scraper keeps only products available at the configured store (others marked `notAtStore`, hidden from search by default, never deleted). If none exists, exclude obviously non-store categories (e.g. online-only / Special Buys) if that's what the extra products are, and document the limitation.

## [U]
- Typing a note on iPhone is readable. Thumbnails load on both phones. Search no longer shows products Casey doesn't stock (or limitation understood).
