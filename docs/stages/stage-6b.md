# Stage 6b - Recurring meals

Builds on Stage 6 (meal planner). Decisions D-124 to D-128.

## Criteria
### A. Data/API
- A1 [S] Recurring rule (household-shared): `{id, kind 'recipe'|'text', recipeId?|text?, meal breakfast|lunch|dinner|null, weekday 1-7 (Mon=1), everyWeeks 1-4, startDate (first occurrence, on `weekday`; sets fortnight parity), endDate?, note?, paused, version}`. Max 30 rules per household (409 LIMIT). CRUD under `/api/plan-rules`, household-scoped, 409 STALE on a stale version, unknown recipe = 400 `recipeId`.
- A2 [S] Occurrences are computed in `@trolley/core`, never stored: pure date maths on plain `YYYY-MM-DD` (no time zones, DST-safe), start/end bounds inclusive, paused rules produce none, every-N-weeks parity counted from `startDate`.
- A3 [S] Skips: `PLANSKIP#<ruleId>#<date>` rows (PUT/DELETE `/api/plan-rules/{id}/skips/{date}`, idempotent; 400 if the date is not an occurrence). "Change this week only" = skip + a normal one-off entry (client composes the two calls).
- A4 [S] `GET /plan?from&to` returns `{entries, occurrences}`; occurrences carry `recurring: true`, `ruleId`, minus skips, sorted by date then meal slot. Deleting a rule deletes its skips.
### B. UI
- B1 [S] Plan shows occurrences like entries with a small repeat icon; tapping opens a sheet: Open recipe, Skip this week (Undo toast), Change this week only, Edit recurring meal.
- B2 [S] "Recurring meals" button at the top of Plan opens a pushed screen (`/recipes/recurring`, back button, tab bar hidden). Rules grouped by weekday: "Every Friday · Dinner", "Every 2nd Thursday · Dinner (next 3 Dec)", paused state. Add/edit sheet: recipe picker or free text, meal, weekday, frequency (Every week / 2 / 3 / 4 weeks), starts (default next matching weekday), optional end date, note, pause toggle; delete with confirm.
- B3 [S] "Make this recurring" in a normal entry's sheet (prefilled from its date, meal, recipe/text, note).
- B4 [S] "Add ingredients for these 7 days" includes recurring occurrences (minus skips).
### C. Quality
- C1 [S] Mock API seeded with Pizza (every Friday dinner) and Chicken wraps (every 2nd Thursday dinner). Core occurrence tests (parity, DST dates, bounds, paused), API tests (CRUD, range merge, skips, isolation, limit, 409), component tests, one e2e (every-2-weeks rule, right days, skip a week, ingredients include it), axe, tap targets, no horizontal scroll at 390px.

## Out of scope
Per-occurrence edits beyond skip/one-off; recurring rules in the MCP tools; calendar sync.
