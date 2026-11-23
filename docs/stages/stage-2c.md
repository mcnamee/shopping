# Stage 2c - Polish round 2 (user feedback 23 Nov)

- A [S] Text size setting (Settings > Display): Small / Medium / Large, where Large = today's size; default Medium. Per device (localStorage, try/catch), applied by scaling the root font size so all rem-based type and spacing scale; tap targets stay >= 44px (tick rows >= 48px at Small).
- B [S] Shop-mode tick box ~20% smaller (visual box and icon); the whole row is still the tick target.
- C [S] "Eggs" is its own aisle group, separate from Dairy. Existing household aisle orders insert Eggs right after Dairy; existing products, list items and template items that are eggs move to Eggs without a re-scrape (map at read time and/or one-off migration); scraper maps ALDI egg categories to Eggs going forward.
- D [S] Bug: the list options bottom sheet sometimes renders clipped (bottom rows cut off, list visible below the sheet; screenshot shows "Delete list" hidden). Likely the visualViewport sizing added in Stage 2b computing a stale/short height. Sheet height must be correct on open every time (no keyboard), and still keyboard-safe.
- E [S] Page headers (shell app bar and sticky PageHeader in shop mode etc.) stay fixed at the top during iOS rubber-band overscroll; the content keeps native bounce. (Header must not move/bounce with the page.)
- [U] Check on iPhone: header doesn't bounce, options sheet always fully visible, text size feels right.
