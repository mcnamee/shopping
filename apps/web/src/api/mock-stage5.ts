/**
 * Stage 5 mock API (recipes, ingredients to list, photo upload) for VITE_MOCK_AUTH.
 * Mirrors services/api/src/recipes/routes.ts with the same @trolley/core validation and
 * filtering. Recipes live in the Stage 2 mock household state (localStorage), seeded on
 * first use with four recipes, three with `#` ingredient headings.
 *
 * Photos: POST /api/recipes/photo-upload returns presigned-POST-shaped objects whose url is
 * `mock://media`. `uploadRecipePhoto` (./recipePhotos) hands the blobs to `mockStorePhoto`,
 * which keeps them in memory as data URLs, so a recipe saved with that photoKey shows its
 * photo until the page reloads (then the placeholder; fine for a mock).
 */
import {
  defaultListName,
  filterRecipes,
  isValidEntityId,
  parsePatchRecipeRequest,
  parseRecipeInput,
  parseRecipeToListRequest,
  parseLineText,
  parseUpdateRecipeRequest,
  RECIPE_LIMITS,
  RECIPE_PHOTO_MAX_BYTES,
  RECIPE_THUMB_MAX_BYTES,
  recipePhotoKey,
  recipeSummary,
  recipeThumbKey,
  textLineInput,
  type BulkAddItemResult,
  type LineInput,
  type Recipe,
  type RecipePhotoUploadResponse,
  type RecipesResponse,
  type RecipeToListResponse,
  type ParsedRecipe,
} from '@trolley/core';
import {
  activeList,
  addItem,
  clone,
  conflict,
  createList,
  detail,
  json,
  MockFailure,
  newId,
  notFound,
  nowIso,
  read,
  unwrap,
  write,
  type MockHousehold,
} from './mock-stage2';

export const MOCK_MEDIA_ORIGIN = 'mock://media';

const media = new Map<string, string>();

/** Keep an uploaded photo (S3 key `media/<photoKey>`) as a data URL for this page's lifetime. */
export async function mockStorePhoto(s3Key: string, blob: Blob): Promise<void> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
  media.set(s3Key, url);
}

/** Test helper. */
export function resetMockMedia(): void {
  media.clear();
}

const urlFor = (photoKey: string | null, thumb: boolean): string | null => {
  if (!photoKey) return null;
  return media.get(`media/${thumb ? recipeThumbKey(photoKey) : photoKey}`) ?? null;
};

const view = (r: Recipe): Recipe => ({
  ...clone(r),
  photoUrl: urlFor(r.photoKey, false),
  thumbUrl: urlFor(r.photoKey, true),
});

// ------------------------------------------------------------------ seed

const SEED_AT = '2026-11-01T09:00:00.000Z';
const seedId = (n: number) => `00000000-0000-4000-8000-0000000000c${n}`;

function seedRecipe(n: number, r: Partial<Recipe> & { title: string }): Recipe {
  return {
    id: seedId(n),
    description: '',
    photoKey: null,
    photoUrl: null,
    thumbUrl: null,
    categories: [],
    yield: '',
    prepTime: '',
    cookTime: '',
    totalTime: '',
    ingredients: '',
    instructions: '',
    notes: '',
    nutrition: '',
    sourceUrl: '',
    favourite: false,
    version: 1,
    createdAt: SEED_AT,
    updatedAt: SEED_AT,
    ...r,
  };
}

export const MOCK_RECIPE_IDS = {
  lambCurry: seedId(1),
  greekSalad: seedId(2),
  pancakes: seedId(3),
  bareBones: seedId(4),
} as const;

function seedRecipes(): Recipe[] {
  return [
    seedRecipe(1, {
      title: 'Lamb curry',
      description: 'A slow, mild curry that is better the next day.',
      categories: ['Dinner', 'Curry'],
      yield: 'Serves 4',
      prepTime: '15 min',
      cookTime: '2 hr',
      totalTime: '2 hr 15 min',
      ingredients: [
        '# Curry',
        '500g lamb shoulder, diced',
        '2 large onions, sliced',
        '3 cloves garlic, crushed',
        '2 tbsp curry paste',
        '400ml coconut milk',
        '1 cup chicken stock',
        '# To serve',
        '2 cups basmati rice',
        '1 bunch coriander',
        '1/2 cup natural yoghurt',
      ].join('\n'),
      instructions: [
        '# Curry',
        'Brown the lamb in batches, then set aside.',
        '',
        'Fry the onions and garlic until soft. Stir in the curry paste for 1 minute.',
        '',
        'Return the lamb, add the coconut milk and stock, then simmer for 2 hours.',
        '',
        '# To serve',
        'Cook the rice. Serve the curry over rice with coriander and yoghurt.',
      ].join('\n'),
      notes: 'Freezes well for up to 3 months.',
      nutrition: '520 kcal per serve',
      sourceUrl: 'https://www.example.com/recipes/lamb-curry',
      favourite: true,
    }),
    seedRecipe(2, {
      title: 'Greek salad',
      categories: ['Lunch', 'Salad'],
      yield: 'Serves 2',
      totalTime: '10 min',
      ingredients: [
        '# Salad',
        '2 tomatoes, wedged',
        '1 cucumber, chopped',
        '1/2 red onion, sliced',
        '1/2 cup kalamata olives',
        '150g feta',
        '# Dressing',
        '3 tbsp olive oil',
        '1 tbsp red wine vinegar',
        '1 tsp dried oregano',
      ].join('\n'),
      instructions:
        'Combine the salad ingredients in a bowl.\nWhisk the dressing, pour over and toss.\nTop with the feta.',
    }),
    seedRecipe(3, {
      title: 'Fluffy pancakes',
      categories: ['Breakfast'],
      yield: 'Makes 8',
      prepTime: '5 min',
      cookTime: '15 min',
      totalTime: '20 min',
      ingredients:
        '1 1/2 cups self raising flour\n2 tbsp sugar\n1 1/4 cups milk\n1 egg\n40g butter, melted\nMaple syrup, to serve',
      instructions:
        'Whisk the flour and sugar. Add the milk, egg and butter and mix until just combined.\n\nCook 1/4 cup scoops in a buttered pan until bubbles form, then flip.',
    }),
    seedRecipe(4, {
      title: 'Toast with Vegemite',
      ingredients: '2 slices bread\nButter\nVegemite',
    }),
  ];
}

function recipesOf(hh: MockHousehold): Recipe[] {
  hh.recipes ??= seedRecipes();
  return hh.recipes;
}

function findRecipe(hh: MockHousehold, id: string | undefined): Recipe {
  if (!isValidEntityId(id)) return notFound();
  return recipesOf(hh).find((r) => r.id === id) ?? notFound();
}

// ------------------------------------------------------------------ routes

function applyInput(r: Recipe, input: ParsedRecipe): void {
  const photoKey = input.photoKey === undefined ? r.photoKey : input.photoKey;
  Object.assign(r, {
    title: input.title,
    description: input.description,
    categories: input.categories,
    yield: input.yield,
    prepTime: input.prepTime,
    cookTime: input.cookTime,
    totalTime: input.totalTime,
    ingredients: input.ingredients,
    instructions: input.instructions,
    notes: input.notes,
    nutrition: input.nutrition,
    sourceUrl: input.sourceUrl,
    favourite: input.favourite ?? r.favourite,
    photoKey,
  });
}

export function createStage5MockRoutes() {
  return {
    'GET /api/recipes': read((hh, { url }) => {
      const all = recipesOf(hh).map((r) => recipeSummary(view(r)));
      return json(200, {
        recipes: filterRecipes(all, {
          q: url.searchParams.get('q') ?? undefined,
          category: url.searchParams.get('category') ?? undefined,
          favourite: url.searchParams.get('favourite') === 'true',
        }),
      } satisfies RecipesResponse);
    }),
    'POST /api/recipes': write((hh, { body, householdId }) => {
      const input = unwrap(parseRecipeInput(body, householdId));
      const all = recipesOf(hh);
      if (all.length >= RECIPE_LIMITS.recipes) {
        conflict('LIMIT', `You can have up to ${RECIPE_LIMITS.recipes} recipes. Delete one first.`);
      }
      const at = nowIso();
      const r = seedRecipe(0, { title: input.title });
      Object.assign(r, { id: newId(), version: 1, createdAt: at, updatedAt: at });
      applyInput(r, input);
      all.push(r);
      return json(201, view(r));
    }),
    'POST /api/recipes/photo-upload': write((_hh, { householdId }) => {
      const photoKey = recipePhotoKey(householdId, newId());
      const post = (key: string, maxBytes: number) => ({
        url: MOCK_MEDIA_ORIGIN,
        fields: { key: `media/${key}`, 'Content-Type': 'image/jpeg' },
        key: `media/${key}`,
        maxBytes,
      });
      return json(200, {
        photoKey,
        full: post(photoKey, RECIPE_PHOTO_MAX_BYTES),
        thumb: post(recipeThumbKey(photoKey), RECIPE_THUMB_MAX_BYTES),
        expiresIn: 300,
      } satisfies RecipePhotoUploadResponse);
    }),
    'GET /api/recipes/{recipeId}': read((hh, { params }) =>
      json(200, view(findRecipe(hh, params.recipeId))),
    ),
    'PUT /api/recipes/{recipeId}': write((hh, { params, body, householdId }) => {
      const r = findRecipe(hh, params.recipeId);
      const input = unwrap(parseUpdateRecipeRequest(body, householdId));
      if (input.version !== r.version) conflict('STALE', 'Changed on another phone', view(r));
      const previous = r.photoKey;
      applyInput(r, input);
      if (previous && previous !== r.photoKey) {
        media.delete(`media/${previous}`);
        media.delete(`media/${recipeThumbKey(previous)}`);
      }
      r.version += 1;
      r.updatedAt = nowIso();
      return json(200, view(r));
    }),
    'PATCH /api/recipes/{recipeId}': write((hh, { params, body }) => {
      const r = findRecipe(hh, params.recipeId);
      r.favourite = unwrap(parsePatchRecipeRequest(body)).favourite;
      return json(200, view(r));
    }),
    'DELETE /api/recipes/{recipeId}': write((hh, { params }) => {
      const r = findRecipe(hh, params.recipeId);
      hh.recipes = recipesOf(hh).filter((x) => x !== r);
      if (r.photoKey) {
        media.delete(`media/${r.photoKey}`);
        media.delete(`media/${recipeThumbKey(r.photoKey)}`);
      }
      return json(204, null);
    }),
    'POST /api/recipes/{recipeId}/to-list': write((hh, { params, body, userId }) => {
      const recipe = findRecipe(hh, params.recipeId);
      const input = unwrap(parseRecipeToListRequest(body));
      let list;
      let listCreated = false;
      if (input.listId) {
        list = activeList(hh, input.listId);
      } else {
        list = hh.lists.find((l) => l.id === hh.thisWeekId && l.status === 'active');
        if (!list) {
          list = createList(hh, userId, {
            name: defaultListName(new Date()),
            lines: [],
            thisWeek: true,
          });
          listCreated = true;
        }
      }
      const note = `From ${recipe.title}`.slice(0, 200);
      const seen = new Set<string>();
      const results: BulkAddItemResult[] = input.lines.map((raw): BulkAddItemResult => {
        const text = parseLineText(raw, 'lines');
        if (!text.ok) {
          return {
            ok: false,
            productId: '',
            unit: 'each',
            code: 'VALIDATION',
            message: text.message,
          };
        }
        const line: LineInput = textLineInput(text.value, { note });
        const id = line.product.productId;
        const ref = { productId: id, unit: 'each' as const };
        if (seen.has(id)) {
          return {
            ok: false,
            ...ref,
            code: 'VALIDATION',
            message: 'This line is already in the request.',
          };
        }
        seen.add(id);
        try {
          const { item, merged } = addItem(list, line, userId);
          return {
            ok: true,
            ...ref,
            change: { itemId: item.id, created: !merged, addedQty: 1, version: item.version },
          };
        } catch (err) {
          if (!(err instanceof MockFailure)) throw err;
          return {
            ok: false,
            ...ref,
            code: err.response.status === 409 ? 'LIMIT' : 'VALIDATION',
            message:
              err.response.status === 409
                ? `This list is full (200 items). Remove something first.`
                : 'Could not add this line.',
          };
        }
      });
      const added = results.filter((r) => r.ok).length;
      return json(200, {
        list: detail(hh, list),
        results,
        added,
        failed: results.length - added,
        listId: list.id,
        listCreated,
      } satisfies RecipeToListResponse);
    }),
  };
}
