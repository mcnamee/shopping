# Recipes

## Import from Mela

1. In Mela, select the recipes you want, then Share > Export, and save the file to Files (a `.melarecipes` file for many recipes, or a `.melarecipe` for one).
2. In Trolley, open Recipes and tap Import from Mela (the upload icon at the top, or the button when you have no recipes yet).
3. Pick the file. Trolley lists what it found; recipes already in Trolley are marked "Already in Trolley - will skip". Untick any you do not want, then tap Import.
4. Wait for "Importing 12 of 40..." to finish (you can Cancel; recipes already imported stay). The summary shows how many were imported, skipped as duplicates and failed, with reasons.

Notes:
- Imports are safe to repeat: recipes are matched on their Mela id, then on exact title and link.
- Only the first photo of each recipe is kept. Times such as "15" become "15 min" and a yield of "10" becomes "Serves 10".
- Text longer than Trolley allows is shortened (the summary says which recipes). Trolley holds up to 500 recipes.

## Meal planner (Stage 6)
Recipes tab > **Plan** shows a Monday-Sunday week (prev/next, "This week", today highlighted). Each day lists Breakfast, Lunch, Dinner and Other; empty meals are small "+ Breakfast" style buttons.
- **Add:** tap a "+" (or the calendar icon on a recipe page, "Add to plan"). Pick the day and meal (Breakfast, Lunch, Dinner or None), then a recipe (favourites first, searchable) or "Other" for free text such as "Leftovers" or "Eat out", with an optional note.
- **Change:** tap an entry to open the recipe, move it to another day or meal, or delete it (Undo for 8 seconds). If a recipe is deleted, its entries stay and read "Recipe deleted".
- **Shop:** "Add this week's ingredients" (or the list icon on a day) opens one review sheet grouped by recipe. Pantry items start unticked, the same product in two recipes is combined, pick the list (this week's by default), and one Undo takes it all back.
- A day holds up to 20 entries. The plan is shared by the household and needs a connection. Decisions D-117 to D-121; API in docs/api.md.

### Recurring meals
Recipes > Plan > **Recurring meals** (pushed screen, back button) lists repeating meals by weekday, e.g. "Every Friday · Dinner" or "Every 2nd Thursday · Dinner (next 3 Dec)".
- **Add/edit:** pick a recipe or "Something else", meal, weekday, how often (every 1-4 weeks), the start date (the first one; fortnights are counted from it), an optional end date and note. Pause keeps a meal but hides it. Delete asks first. Up to 30 per household.
- **On the plan:** recurring meals show with a small repeat icon. Tap one to open the recipe, **Skip this week** (Undo in the toast), **Change this week only** (skips it and adds a normal entry you can edit) or **Edit recurring meal**.
- **Make this recurring:** in any normal entry's sheet, prefilled from its day, meal and recipe.
- "Add ingredients for these 7 days" includes recurring meals (not skipped ones). Decisions D-124 to D-128.
