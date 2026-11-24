/**
 * Recipes (HH#<hh> / RECIPE#<id>, all fields embedded; spec 5.1, D-104). Writes are
 * conditional on the row version (PUT) or just on existence (favourite toggle, D-107).
 * The list read uses a projection so the long text fields stay out of the response path.
 */
import { randomUUID } from 'node:crypto';
import {
  keys,
  RECIPE_LIMITS,
  recipeMediaUrl,
  recipeThumbKey,
  type ParsedRecipe,
  type Recipe,
  type RecipeSummary,
} from '@trolley/core';
import { ConditionFailed, type Db, type DbItem } from '../db';
import { fail } from '../http';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function urls(photoKey: string | null) {
  return {
    photoUrl: photoKey ? recipeMediaUrl(photoKey) : null,
    thumbUrl: photoKey ? recipeMediaUrl(recipeThumbKey(photoKey)) : null,
  };
}

export function toRecipe(row: DbItem): Recipe | null {
  if (row.entity !== 'Recipe' || typeof row.id !== 'string' || typeof row.title !== 'string') {
    return null;
  }
  const photoKey = typeof row.photoKey === 'string' && row.photoKey ? row.photoKey : null;
  return {
    id: row.id,
    title: row.title,
    description: str(row.description),
    photoKey,
    ...urls(photoKey),
    categories: Array.isArray(row.categories)
      ? row.categories.filter((c): c is string => typeof c === 'string')
      : [],
    yield: str(row.yield),
    prepTime: str(row.prepTime),
    cookTime: str(row.cookTime),
    totalTime: str(row.totalTime),
    ingredients: str(row.ingredients),
    instructions: str(row.instructions),
    notes: str(row.notes),
    nutrition: str(row.nutrition),
    sourceUrl: str(row.sourceUrl),
    favourite: row.favourite === true,
    version: typeof row.version === 'number' ? row.version : 1,
    createdAt: str(row.createdAt),
    updatedAt: str(row.updatedAt),
  };
}

/** Attributes the list endpoint reads (projection). */
const SUMMARY_ATTRS = [
  'entity',
  'id',
  'title',
  'categories',
  'yield',
  'totalTime',
  'photoKey',
  'favourite',
  'updatedAt',
] as const;

export class RecipeStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  private key(hh: string, id: string) {
    return { pk: keys.householdPk(hh), sk: keys.recipeSk(id) };
  }

  private toDb(hh: string, r: Recipe): DbItem {
    return {
      ...this.key(hh, r.id),
      entity: 'Recipe',
      id: r.id,
      title: r.title,
      description: r.description,
      photoKey: r.photoKey,
      categories: r.categories,
      yield: r.yield,
      prepTime: r.prepTime,
      cookTime: r.cookTime,
      totalTime: r.totalTime,
      ingredients: r.ingredients,
      instructions: r.instructions,
      notes: r.notes,
      nutrition: r.nutrition,
      sourceUrl: r.sourceUrl,
      favourite: r.favourite,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async summaries(hh: string): Promise<RecipeSummary[]> {
    const rows = await this.db.queryProjected(
      keys.householdPk(hh),
      keys.recipeSkPrefix,
      SUMMARY_ATTRS,
    );
    return rows.flatMap((row) => {
      const r = toRecipe(row);
      return r
        ? [
            {
              id: r.id,
              title: r.title,
              categories: r.categories,
              yield: r.yield,
              totalTime: r.totalTime,
              thumbUrl: r.thumbUrl,
              favourite: r.favourite,
              updatedAt: r.updatedAt,
            },
          ]
        : [];
    });
  }

  async get(hh: string, id: string): Promise<Recipe | null> {
    const row = await this.db.get(this.key(hh, id));
    return row ? toRecipe(row) : null;
  }

  async mustGet(hh: string, id: string): Promise<Recipe> {
    return (await this.get(hh, id)) ?? fail.notFound();
  }

  async create(hh: string, input: ParsedRecipe): Promise<Recipe> {
    const count = await this.db.count(keys.householdPk(hh), keys.recipeSkPrefix);
    if (count >= RECIPE_LIMITS.recipes) {
      return fail.conflict(
        'LIMIT',
        `You can have up to ${RECIPE_LIMITS.recipes} recipes. Delete one first.`,
      );
    }
    const at = this.now().toISOString();
    const photoKey = input.photoKey ?? null;
    const r: Recipe = {
      id: this.newId(),
      title: input.title,
      description: input.description,
      photoKey,
      ...urls(photoKey),
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
      favourite: input.favourite ?? false,
      version: 1,
      createdAt: at,
      updatedAt: at,
    };
    await this.db.put(this.toDb(hh, r), { condition: 'attribute_not_exists(pk)' });
    return r;
  }

  /**
   * Replace a recipe's fields if its version is unchanged (409 STALE otherwise). An absent
   * `photoKey` keeps the photo; `previousPhotoKey` is what the caller should now delete
   * when the photo changed.
   */
  async update(
    hh: string,
    id: string,
    input: ParsedRecipe & { version: number },
  ): Promise<{ recipe: Recipe; previousPhotoKey: string | null }> {
    const read = await this.mustGet(hh, id);
    if (read.version !== input.version) {
      return fail.conflict('STALE', 'Changed on another phone', read);
    }
    const photoKey = input.photoKey === undefined ? read.photoKey : input.photoKey;
    const next: Recipe = {
      ...read,
      title: input.title,
      description: input.description,
      photoKey,
      ...urls(photoKey),
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
      favourite: input.favourite ?? read.favourite,
      version: read.version + 1,
      updatedAt: this.now().toISOString(),
    };
    try {
      await this.db.put(this.toDb(hh, next), {
        condition: '#ver = :v',
        names: { '#ver': 'version' },
        values: { ':v': read.version },
      });
    } catch (err) {
      if (!(err instanceof ConditionFailed)) throw err;
      const current = await this.get(hh, id);
      return current
        ? fail.conflict('STALE', 'Changed on another phone', current)
        : fail.notFound();
    }
    return {
      recipe: next,
      previousPhotoKey: read.photoKey && read.photoKey !== photoKey ? read.photoKey : null,
    };
  }

  /** Favourite toggle: no version needed, and it does not bump the version (D-107). */
  async setFavourite(hh: string, id: string, favourite: boolean): Promise<Recipe> {
    let row: DbItem;
    try {
      row = await this.db.update(this.key(hh, id), 'SET favourite = :f', {
        condition: 'attribute_exists(pk)',
        values: { ':f': favourite },
      });
    } catch (err) {
      if (err instanceof ConditionFailed) return fail.notFound();
      throw err;
    }
    return toRecipe(row) ?? fail.notFound();
  }

  /** Delete; returns the photo key to clean up. */
  async delete(hh: string, id: string): Promise<string | null> {
    const read = await this.mustGet(hh, id);
    try {
      await this.db.delete(this.key(hh, id), { condition: 'attribute_exists(pk)' });
    } catch (err) {
      if (err instanceof ConditionFailed) return fail.notFound();
      throw err;
    }
    return read.photoKey;
  }
}
