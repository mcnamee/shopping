/**
 * Recipes (Stage 5, D-104 to D-107, docs/stages/stage-5.md B): types, limits, request
 * validation and the ingredient/method text parsers. Pure, shared by services/api and the
 * web mock. All user text is plain text (no markdown or HTML rendering, D-107).
 */
import { ENTITY_ID_PATTERN, cleanText, type Parsed } from './lists';

export const RECIPE_LIMITS = {
  recipes: 500,
  title: 120,
  description: 2000,
  categories: 10,
  category: 30,
  yield: 30,
  time: 30,
  ingredientLines: 200,
  ingredientChars: 10_000,
  instructions: 20_000,
  notes: 5000,
  nutrition: 1000,
  sourceUrl: 2000,
  /** Lines in one POST /recipes/{id}/to-list (same as a bulk add). */
  toListLines: 50,
} as const;

/** Photo upload caps (B4): the full image and its thumbnail, both JPEG. */
export const RECIPE_PHOTO_MAX_BYTES = 3 * 1024 * 1024;
export const RECIPE_THUMB_MAX_BYTES = 300 * 1024;

/** Where an imported recipe came from (B-019): lets a re-import skip what is already here. */
export interface RecipeSource {
  app: 'mela';
  /** The id the source app gave the recipe (<= 1000 chars). */
  id: string;
}

export const RECIPE_SOURCE_ID_MAX = 1000;

export interface Recipe {
  id: string;
  title: string;
  description: string;
  /** `recipes/<household>/<uuid>.jpg` in the photo bucket, or null. */
  photoKey: string | null;
  /** Same-origin URLs derived from photoKey (`/media/...`), or null. */
  photoUrl: string | null;
  thumbUrl: string | null;
  categories: string[];
  yield: string;
  prepTime: string;
  cookTime: string;
  totalTime: string;
  /** One per line; a line starting `#` is a heading. */
  ingredients: string;
  /** Paragraphs are steps; a line starting `#` is a heading. */
  instructions: string;
  notes: string;
  nutrition: string;
  /** http(s) URL or ''. */
  sourceUrl: string;
  favourite: boolean;
  /** Import origin, or null for recipes typed in. */
  source: RecipeSource | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/recipes rows (projection, no long text). */
export interface RecipeSummary {
  id: string;
  title: string;
  categories: string[];
  yield: string;
  totalTime: string;
  thumbUrl: string | null;
  favourite: boolean;
  /** Web address and import origin, so an import can spot duplicates (B-019). */
  sourceUrl: string;
  source: RecipeSource | null;
  updatedAt: string;
}

export interface RecipesResponse {
  recipes: RecipeSummary[];
}

/** POST /api/recipes body; PUT adds `version`. Absent text fields mean empty. */
export interface RecipeInput {
  title: string;
  description?: string;
  categories?: string[];
  yield?: string;
  prepTime?: string;
  cookTime?: string;
  totalTime?: string;
  ingredients?: string;
  instructions?: string;
  notes?: string;
  nutrition?: string;
  sourceUrl?: string;
  favourite?: boolean;
  /** Import origin (B-019). Absent: unchanged (PUT) or none (POST); null: clear. */
  source?: RecipeSource | null;
  /** From POST /recipes/photo-upload. Absent: unchanged (PUT); null: remove. */
  photoKey?: string | null;
}

export interface UpdateRecipeRequest extends RecipeInput {
  version: number;
}

export interface PatchRecipeRequest {
  favourite: boolean;
}

/** One S3 presigned POST (fields are posted first, then `file` last). */
export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
  /** Object key the file lands on. */
  key: string;
  /** Largest file accepted, in bytes. */
  maxBytes: number;
}

/** POST /api/recipes/photo-upload (200). `photoKey` is what the recipe then stores. */
export interface RecipePhotoUploadResponse {
  photoKey: string;
  full: PresignedPost;
  thumb: PresignedPost;
  /** Seconds the POSTs stay valid. */
  expiresIn: number;
}

/** What the validated fields look like (all text present). */
export interface ParsedRecipe {
  title: string;
  description: string;
  categories: string[];
  yield: string;
  prepTime: string;
  cookTime: string;
  totalTime: string;
  ingredients: string;
  instructions: string;
  notes: string;
  nutrition: string;
  sourceUrl: string;
  favourite: boolean | undefined;
  /** undefined: leave as is. */
  source: RecipeSource | null | undefined;
  /** undefined: leave as is. */
  photoKey: string | null | undefined;
}

// ---------------------------------------------------------------------------------------
// Photo keys (D-105)

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export function recipePhotoKey(householdId: string, uuid: string): string {
  return `recipes/${householdId}/${uuid}.jpg`;
}

export function recipeThumbKey(photoKey: string): string {
  return photoKey.replace(/\.jpg$/, '-thumb.jpg');
}

/** True only for `recipes/<this household>/<uuid>.jpg`. */
export function isRecipePhotoKey(householdId: string, key: unknown): key is string {
  return (
    typeof key === 'string' &&
    new RegExp(`^recipes/${householdId.replace(/[^\w-]/g, '')}/${UUID}\\.jpg$`).test(key) &&
    key.startsWith(`recipes/${householdId}/`)
  );
}

/** Same-origin URL CloudFront serves the object from (`/media/...`). */
export function recipeMediaUrl(key: string): string {
  return `/media/${key}`;
}

// ---------------------------------------------------------------------------------------
// Validation (B1)

const fail = (message: string, field: string): { ok: false; message: string; field: string } => ({
  ok: false,
  message,
  field,
});

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Multi-line text: LF newlines, control characters removed, ends trimmed. */
export function cleanMultiline(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\p{Cc}\u2028\u2029]/gu, (c) => (c === '\n' || c === '\t' ? c : ' '))
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function singleLine(
  body: Record<string, unknown>,
  field: string,
  max: number,
  label: string,
  required = false,
): Parsed<string> {
  const v = body[field];
  if (v === undefined || v === null) {
    return required ? fail(`Enter a ${label}.`, field) : { ok: true, value: '' };
  }
  if (typeof v !== 'string') return fail(`${label} must be text`, field);
  const s = cleanText(v);
  if (required && !s) return fail(`Enter a ${label}.`, field);
  if (s.length > max) return fail(`Keep ${label} to ${max} characters or fewer.`, field);
  return { ok: true, value: s };
}

function multiline(
  body: Record<string, unknown>,
  field: string,
  max: number,
  label: string,
): Parsed<string> {
  const v = body[field];
  if (v === undefined || v === null) return { ok: true, value: '' };
  if (typeof v !== 'string') return fail(`${label} must be text`, field);
  const s = cleanMultiline(v);
  if (s.length > max) return fail(`Keep ${label} to ${max} characters or fewer.`, field);
  return { ok: true, value: s };
}

export function parseRecipeCategories(value: unknown): Parsed<string[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return fail('categories must be a list', 'categories');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') return fail('Each category must be text', 'categories');
    const c = cleanText(raw);
    if (!c) continue;
    if (c.length > RECIPE_LIMITS.category) {
      return fail(
        `Keep each category to ${RECIPE_LIMITS.category} characters or fewer.`,
        'categories',
      );
    }
    const k = c.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  if (out.length > RECIPE_LIMITS.categories) {
    return fail(`Use up to ${RECIPE_LIMITS.categories} categories.`, 'categories');
  }
  return { ok: true, value: out };
}

/** http(s) URL (<= 2000 chars) or '' for none. */
export function parseSourceUrl(value: unknown): Parsed<string> {
  if (value === undefined || value === null) return { ok: true, value: '' };
  if (typeof value !== 'string') return fail('Source must be a web address', 'sourceUrl');
  const s = value.trim();
  if (!s) return { ok: true, value: '' };
  if (s.length > RECIPE_LIMITS.sourceUrl) {
    return fail(
      `Keep the web address to ${RECIPE_LIMITS.sourceUrl} characters or fewer.`,
      'sourceUrl',
    );
  }
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return fail('Enter a web address starting with http:// or https://', 'sourceUrl');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return fail('Enter a web address starting with http:// or https://', 'sourceUrl');
  }
  return { ok: true, value: s };
}

export function parseRecipeSource(value: unknown): Parsed<RecipeSource | null | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (!isObject(value) || value.app !== 'mela' || typeof value.id !== 'string') {
    return fail('source must be { app: "mela", id }', 'source');
  }
  const id = value.id.trim();
  if (!id || id.length > RECIPE_SOURCE_ID_MAX || /[\p{Cc}]/u.test(id)) {
    return fail(`source id must be 1 to ${RECIPE_SOURCE_ID_MAX} characters`, 'source');
  }
  return { ok: true, value: { app: 'mela', id } };
}

/** Non-blank lines of an ingredients/method text. */
function nonBlankLines(text: string): string[] {
  return text.split('\n').filter((l) => l.trim() !== '');
}

/**
 * Validate a create/update body. `householdId` scopes `photoKey` (it must be under
 * `recipes/<household>/`, B4). Over-limit fields give a 400 naming the field (B1).
 */
export function parseRecipeInput(body: unknown, householdId: string): Parsed<ParsedRecipe> {
  if (!isObject(body)) return { ok: false, message: 'Body must be a JSON object' };
  const title = singleLine(body, 'title', RECIPE_LIMITS.title, 'title', true);
  if (!title.ok) return title;
  const description = multiline(body, 'description', RECIPE_LIMITS.description, 'the description');
  if (!description.ok) return description;
  const categories = parseRecipeCategories(body.categories);
  if (!categories.ok) return categories;
  const yld = singleLine(body, 'yield', RECIPE_LIMITS.yield, 'yield');
  if (!yld.ok) return yld;
  const prepTime = singleLine(body, 'prepTime', RECIPE_LIMITS.time, 'prep time');
  if (!prepTime.ok) return prepTime;
  const cookTime = singleLine(body, 'cookTime', RECIPE_LIMITS.time, 'cook time');
  if (!cookTime.ok) return cookTime;
  const totalTime = singleLine(body, 'totalTime', RECIPE_LIMITS.time, 'total time');
  if (!totalTime.ok) return totalTime;
  const ingredients = multiline(body, 'ingredients', RECIPE_LIMITS.ingredientChars, 'ingredients');
  if (!ingredients.ok) return ingredients;
  if (nonBlankLines(ingredients.value).length > RECIPE_LIMITS.ingredientLines) {
    return fail(`Use up to ${RECIPE_LIMITS.ingredientLines} ingredient lines.`, 'ingredients');
  }
  const instructions = multiline(body, 'instructions', RECIPE_LIMITS.instructions, 'the method');
  if (!instructions.ok) return instructions;
  const notes = multiline(body, 'notes', RECIPE_LIMITS.notes, 'notes');
  if (!notes.ok) return notes;
  const nutrition = multiline(body, 'nutrition', RECIPE_LIMITS.nutrition, 'nutrition');
  if (!nutrition.ok) return nutrition;
  const sourceUrl = parseSourceUrl(body.sourceUrl);
  if (!sourceUrl.ok) return sourceUrl;
  if (body.favourite !== undefined && typeof body.favourite !== 'boolean') {
    return fail('favourite must be true or false', 'favourite');
  }
  const source = parseRecipeSource(body.source);
  if (!source.ok) return source;
  let photoKey: string | null | undefined;
  if (body.photoKey === null) photoKey = null;
  else if (body.photoKey !== undefined) {
    if (!isRecipePhotoKey(householdId, body.photoKey)) return fail('Unknown photo', 'photoKey');
    photoKey = body.photoKey;
  }
  return {
    ok: true,
    value: {
      title: title.value,
      description: description.value,
      categories: categories.value,
      yield: yld.value,
      prepTime: prepTime.value,
      cookTime: cookTime.value,
      totalTime: totalTime.value,
      ingredients: ingredients.value,
      instructions: instructions.value,
      notes: notes.value,
      nutrition: nutrition.value,
      sourceUrl: sourceUrl.value,
      favourite: body.favourite as boolean | undefined,
      source: source.value,
      photoKey,
    },
  };
}

/** PUT body: recipe fields plus `version`. */
export function parseUpdateRecipeRequest(
  body: unknown,
  householdId: string,
): Parsed<ParsedRecipe & { version: number }> {
  const r = parseRecipeInput(body, householdId);
  if (!r.ok) return r;
  const v = (body as Record<string, unknown>).version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    return fail('version is required', 'version');
  }
  return { ok: true, value: { ...r.value, version: v } };
}

export function parsePatchRecipeRequest(body: unknown): Parsed<{ favourite: boolean }> {
  if (!isObject(body) || typeof body.favourite !== 'boolean') {
    return fail('favourite must be true or false', 'favourite');
  }
  return { ok: true, value: { favourite: body.favourite } };
}

export function isRecipeId(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
}

/** POST /recipes/{id}/to-list body: `lines` (1..50 texts), optional `listId`. */
export function parseRecipeToListRequest(
  body: unknown,
): Parsed<{ lines: string[]; listId: string | null }> {
  if (!isObject(body) || !Array.isArray(body.lines)) return fail('lines must be a list', 'lines');
  if (body.lines.length < 1 || body.lines.length > RECIPE_LIMITS.toListLines) {
    return fail(`Add 1 to ${RECIPE_LIMITS.toListLines} lines at a time`, 'lines');
  }
  if (body.lines.some((l) => typeof l !== 'string')) return fail('Each line must be text', 'lines');
  let listId: string | null = null;
  if (body.listId !== undefined && body.listId !== null) {
    if (!isRecipeId(body.listId)) return fail('Unknown list', 'listId');
    listId = body.listId;
  }
  return { ok: true, value: { lines: body.lines as string[], listId } };
}

// ---------------------------------------------------------------------------------------
// Views and filtering (B2, C1, C2)

export function recipeSummary(r: Recipe): RecipeSummary {
  return {
    id: r.id,
    title: r.title,
    categories: r.categories,
    yield: r.yield,
    totalTime: r.totalTime,
    thumbUrl: r.thumbUrl,
    favourite: r.favourite,
    sourceUrl: r.sourceUrl,
    source: r.source,
    updatedAt: r.updatedAt,
  };
}

/** Lower-case, accent-free text for matching. */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export interface RecipeFilter {
  q?: string | undefined;
  category?: string | undefined;
  favourite?: boolean | undefined;
}

/** Filter (title search, category, favourites; combined) and sort A-Z by title. */
export function filterRecipes<T extends RecipeSummary>(
  recipes: readonly T[],
  f: RecipeFilter = {},
): T[] {
  const q = f.q ? foldText(f.q.trim()) : '';
  const cat = f.category ? foldText(f.category.trim()) : '';
  return recipes
    .filter(
      (r) =>
        (!q || foldText(r.title).includes(q)) &&
        (!cat || r.categories.some((c) => foldText(c) === cat)) &&
        (!f.favourite || r.favourite),
    )
    .sort(
      (a, b) =>
        a.title.localeCompare(b.title, 'en-AU', { sensitivity: 'base' }) ||
        a.id.localeCompare(b.id),
    );
}

// ---------------------------------------------------------------------------------------
// Ingredient and method parsing (E2)

export type IngredientLine =
  { kind: 'heading'; text: string } | { kind: 'ingredient'; text: string };

const HEADING_RE = /^\s*#+\s*(.*)$/;

/** Ingredients: one per line, `#` lines are headings (the `#` stripped), blanks dropped. */
export function parseIngredientLines(text: string): IngredientLine[] {
  const out: IngredientLine[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const h = HEADING_RE.exec(line);
    if (h) {
      const t = (h[1] ?? '').trim();
      if (t) out.push({ kind: 'heading', text: t });
    } else {
      out.push({ kind: 'ingredient', text: line });
    }
  }
  return out;
}

/** The ingredient texts only (no headings), e.g. to pre-tick in the "Add to list" sheet. */
export function ingredientTexts(text: string): string[] {
  return parseIngredientLines(text).flatMap((l) => (l.kind === 'ingredient' ? [l.text] : []));
}

export type MethodBlock =
  { kind: 'heading'; text: string } | { kind: 'step'; n: number; text: string };

/**
 * Method: paragraphs (split on blank lines, or on single newlines when there are no blank
 * lines) are numbered steps; `#` lines are headings and do not restart the numbering.
 */
export function parseMethodBlocks(text: string): MethodBlock[] {
  const t = text.replace(/\r\n?/g, '\n').trim();
  if (!t) return [];
  const paragraphs = /\n[ \t]*\n/.test(t) ? t.split(/\n[ \t]*\n/) : t.split('\n');
  const out: MethodBlock[] = [];
  let n = 0;
  for (const para of paragraphs) {
    let buf: string[] = [];
    const flush = () => {
      const s = buf.join('\n').trim();
      buf = [];
      if (s) {
        n += 1;
        out.push({ kind: 'step', n, text: s });
      }
    };
    for (const raw of para.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const h = HEADING_RE.exec(line);
      if (h) {
        flush();
        const ht = (h[1] ?? '').trim();
        if (ht) out.push({ kind: 'heading', text: ht });
      } else {
        buf.push(line);
      }
    }
    flush();
  }
  return out;
}
