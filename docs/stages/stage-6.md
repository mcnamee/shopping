# Stage 6 - Meal planner (Mela-style)

## Scope and criteria
### A. Data/API
- A1 [S] Meal plan entries (household-shared): {id, date (YYYY-MM-DD, Canberra), meal: 'breakfast'|'lunch'|'dinner'|null, kind: 'recipe'|'text', recipeId?, text?, note?, order, version}. CRUD + move (change date/meal/order). Query by date range (one DynamoDB query, e.g. pk HH#<hh> sk PLAN#<date>#<id>).
- A2 [S] Deleting a recipe leaves its plan entries showing "Recipe deleted" (no crash); entries render recipe title/thumb from the recipe.
- A3 [S] Limits: 20 entries per day; household-scoped; 409 on stale version; validation.
### B. Planner UI (in the Recipes tab)
- B1 [S] Recipes tab top segmented control: Recipes | Plan (4 bottom tabs unchanged). Plan remembers last view per device.
- B2 [S] Week view Monday-Sunday (Australian), prev/next week, "This week" jump, today highlighted. Each day shows Breakfast, Lunch, Dinner sections (empty sections collapsed to a subtle "+ Add" row) plus untimed entries ("Other").
- B3 [S] Add to a day: sheet with meal picker (Breakfast/Lunch/Dinner/None) and either pick a recipe (searchable list with thumbs, favourites first) or type free text (e.g. "Leftovers", "Eat out") with optional note. Also "Add to plan" from a recipe's detail page (pick day + meal).
- B4 [S] Entry actions: open recipe, move to another day/meal, delete with Undo. Recipe entries show thumb + title + total time; text entries show the text.
### C. Shopping from the plan
- C1 [S] "Add this week's ingredients" on the plan (and per-day): collects all recipe entries in the shown week, runs the existing smart match per recipe (cached), shows one review sheet grouped by recipe (Select all/none, target list picker default this week's list, duplicates across recipes merged by matched product, pantry unticked), adds via existing bulk add/to-list with one Undo.
### D. Quality
- D1 [S] Unit + API tests (CRUD, range query, isolation, 409, limits, deleted recipe), component tests, one e2e (plan a week with 2 recipes + "Leftovers", add week's ingredients to list). Axe, tap targets, no horizontal scroll at 390px. Mock API seeded with a sample week.
- D2 [U] Plan a real week on both phones; household sees the same plan.

## Out of scope (backlog)
Drag-and-drop between days; MCP/Siri "what's for dinner" tools; calendar sync; nutrition totals.
