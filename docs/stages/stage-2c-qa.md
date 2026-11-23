# Stage 2c QA

Run: lint, typecheck, build, synth OK. Unit tests 193+149+70+287+44 pass (one earlier `npm test` run printed a vitest "npm error" in a workspace; two re-runs were fully green, so treated as a flake, not reproduced). E2E: 112 pass, 1 fail (stale test, below); after fix, settings spec 6/6 incl. the new gap test.

| Criterion | Result | Notes |
|---|---|---|
| A Text size (14/15/16, default Medium, per device, try/catch) | Pass | `textSize.ts` unit-checked; new e2e: default 15px, Small 14px, persists across reload, Large 16px. Tap-target e2e checks pass at default size. |
| B Smaller tick box, whole row still the target | Pass | Existing shop-mode e2e (tick, 100 ms optimistic, tap targets) pass. Visual size is [U]. |
| C Eggs aisle (read-time split, order insertion, scraper) | Pass | D-081 helper + order insertion covered by core/api/scraper unit tests; aisle screen shows 16 groups with Eggs after Dairy. |
| D BottomSheet sizing correct on open, keyboard-safe | Pass (automated) / Deferred (device) | e2e pass; real iOS keyboard behaviour is [U]. |
| E Fixed PageHeader with spacer | Pass (automated) / Deferred (device) | New e2e: header y unchanged after window scroll. Rubber-band overscroll only testable on iPhone. |

## Defects
1. Low, test-only (fixed): `apps/web/e2e/settings.e2e.ts` aisle-order test asserted 15 groups; now 16. Product was correct. Not flaky; deterministic since Eggs was added.
2. Low, risk: aisle PUT requires all 16 ids (`parseAisleOrderRequest`, `packages/core/src/lists.ts`). A stale client (PWA cached before deploy) that sends 15 ids gets 400 "Every group must be included" and shows the save-error banner (rolls back; no data loss). Stale clients load the order via GET, which now returns 16 ids, so they only fail if loaded before deploy and saved after. Self-heals on reload. Accepted; no change needed.
3. Trivial: doc comment above `parseAisleOrderRequest` still says "15 group ids".
4. Known limits (D-081, accepted): household category-map override for ALDI egg categories is not applied to the read-time rule; an egg product with no "egg" in its name and no categories stays in Dairy.

Aisle drag e2e: passed first run (no flake seen).

## Release recommendation
Ship. No blocking defects; automated coverage is green. Remaining risks are device-only (iOS).

[U] checklist (iPhone):
- [ ] Pull down/overscroll on a list and shop mode: header stays put, content bounces.
- [ ] Open list options sheet several times (also after rotating): "Delete list" always visible; open with keyboard (rename) and confirm still usable.
- [ ] Settings > Display: Small/Medium/Large feel right; reload keeps choice; taps still comfortable at Small.
- [ ] Shop mode tick box size looks right; tapping anywhere on the row ticks.
- [ ] Eggs shows as its own aisle after Dairy (Settings > Aisle order and in a list with eggs).
