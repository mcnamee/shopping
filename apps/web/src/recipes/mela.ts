/**
 * Mela import (B-019, D-113): parse `.melarecipe` (one JSON recipe) and `.melarecipes` (a
 * zip of them) in the browser, map to RecipeInput, spot duplicates, and run the import one
 * recipe at a time. Tolerant by design: missing fields, numbers for strings, extra fields.
 */
import {
  RECIPE_LIMITS,
  cleanMultiline,
  cleanText,
  type Recipe,
  type RecipeInput,
  type RecipeSummary,
} from '@trolley/core';
import { inflateSync, strFromU8 } from 'fflate';

/** One recipe as read from a Mela file (everything already coerced to plain values). */
export interface MelaRecipe {
  /** Mela's own id, or '' when the file has none. */
  id: string;
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
  link: string;
  favourite: boolean;
  /** First image, base64 (no data: prefix), or null. */
  image: string | null;
}

export interface MelaParseResult {
  recipes: MelaRecipe[];
  /** Files or entries that could not be read, as "name: reason". */
  problems: string[];
}

const MAX_ENTRY_BYTES = 40 * 1024 * 1024;
const MAX_ENTRIES = 1000;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/**
 * Times as Mela users type them: "15", "10min", "10 MINUTES", "1h", "2h25min" become
 * "15 min", "10 min", "1 hr", "2 hr 25 min"; anything else stays as written.
 */
export function melaTime(v: unknown): string {
  const t = text(v).trim();
  const bare = /^\d+(?:\.\d+)?$/.test(t);
  const m =
    /^(?:(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h))?\s*(?:(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m))?$/i.exec(
      t,
    );
  if (!t || (!bare && (!m || (m[1] === undefined && m[2] === undefined)))) return t;
  const mins = Math.round(bare ? Number(t) : Number(m?.[1] ?? 0) * 60 + Number(m?.[2] ?? 0));
  if (mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const rest = mins % 60;
  return h ? `${h} hr${rest ? ` ${rest} min` : ''}` : `${rest} min`;
}

/** "10" and "SERVES: 5" read as "Serves N"; "4 - 6 people" and "2 loaves" stay. */
export function melaYield(v: unknown): string {
  const t = text(v).trim();
  const m = /^(?:serves?\s*:?\s*)?(\d+)$/i.exec(t);
  return m ? `Serves ${m[1]}` : t;
}

/** Mela writes nutrition with **bold**; the app shows plain text. */
const unbold = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*\*/g, '');

function bool(v: unknown): boolean {
  return v === true || v === 1 || (typeof v === 'string' && /^(true|yes|1)$/i.test(v.trim()));
}

function list(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  return raw.flatMap((x) => {
    const s = text(x).trim();
    return s ? [s] : [];
  });
}

function firstImage(v: unknown): string | null {
  if (!Array.isArray(v)) return null;
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const s = x.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    if (s) return s;
  }
  return null;
}

/** Map one parsed JSON value to a MelaRecipe, or null when it is not a recipe object. */
export function readMelaRecipe(json: unknown): MelaRecipe | null {
  if (!isObject(json)) return null;
  const title = cleanText(text(json.title));
  const ingredients = text(json.ingredients);
  const instructions = text(json.instructions);
  if (!title && !ingredients.trim() && !instructions.trim()) return null;
  return {
    id: text(json.id).trim(),
    title: title || 'Untitled recipe',
    description: text(json.text),
    categories: list(json.categories),
    yield: melaYield(json.yield),
    prepTime: melaTime(json.prepTime),
    cookTime: melaTime(json.cookTime),
    totalTime: melaTime(json.totalTime),
    ingredients,
    instructions,
    notes: text(json.notes),
    nutrition: unbold(text(json.nutrition)),
    link: text(json.link).trim(),
    favourite: bool(json.favorite ?? json.favourite),
    image: firstImage(json.images),
  };
}

export function parseMelaJson(name: string, bytes: Uint8Array): MelaParseResult {
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(bytes).replace(/^\uFEFF/, ''));
  } catch {
    return { recipes: [], problems: [`${name}: not a Mela recipe file`] };
  }
  const items = Array.isArray(json) ? json : [json];
  const recipes: MelaRecipe[] = [];
  let bad = 0;
  for (const item of items) {
    const r = readMelaRecipe(item);
    if (r) recipes.push(r);
    else bad++;
  }
  return {
    recipes,
    problems: bad
      ? [`${name}: ${bad === 1 ? 'a recipe' : `${bad} recipes`} could not be read`]
      : [],
  };
}

/**
 * Minimal zip reader (central directory, STORE and DEFLATE, ZIP64). Written because fflate
 * mis-slices entries whose sizes live in a ZIP64 extra field, which Mela's exporter writes
 * (checked against a real export). Only `.melarecipe` entries are returned, as lazy slices.
 */
export function readZip(b: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = new Map<string, Uint8Array>();
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no end of central directory');
  let count = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  if ((count === 0xffff || cdOffset === 0xffffffff) && eocd >= 20) {
    if (dv.getUint32(eocd - 20, true) === 0x07064b50) {
      const z = Number(dv.getBigUint64(eocd - 20 + 8, true));
      if (dv.getUint32(z, true) === 0x06064b50) {
        count = Number(dv.getBigUint64(z + 32, true));
        cdOffset = Number(dv.getBigUint64(z + 48, true));
      }
    }
  }
  let p = cdOffset;
  for (let n = 0; n < count && p + 46 <= b.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad central directory');
    const method = dv.getUint16(p + 10, true);
    let csize = dv.getUint32(p + 20, true);
    let usize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    let local = dv.getUint32(p + 42, true);
    const name = strFromU8(b.subarray(p + 46, p + 46 + nameLen));
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = dv.getUint16(e, true);
      const len = dv.getUint16(e + 2, true);
      if (id === 1) {
        let q = e + 4;
        if (usize === 0xffffffff) {
          usize = Number(dv.getBigUint64(q, true));
          q += 8;
        }
        if (csize === 0xffffffff) {
          csize = Number(dv.getBigUint64(q, true));
          q += 8;
        }
        if (local === 0xffffffff) local = Number(dv.getBigUint64(q, true));
      }
      e += 4 + len;
    }
    p = extraEnd + commentLen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)\./.test(name)) continue;
    if (!/\.melarecipe$/i.test(name) || usize > MAX_ENTRY_BYTES) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = b.subarray(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, inflateSync(raw, { out: new Uint8Array(usize) }));
    else throw new Error(`unsupported zip method ${method}`);
  }
  return out;
}

const isZip = (b: Uint8Array) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b;

/** Parse the bytes of one picked file (zip or single JSON, decided by content). */
export async function parseMelaBytes(name: string, bytes: Uint8Array): Promise<MelaParseResult> {
  if (!isZip(bytes)) return parseMelaJson(name, bytes);
  let entries: Map<string, Uint8Array>;
  try {
    entries = readZip(bytes);
  } catch {
    return { recipes: [], problems: [`${name}: could not open the zip file`] };
  }
  const recipes: MelaRecipe[] = [];
  const problems: string[] = [];
  const names = [...entries.keys()];
  for (const n of names.slice(0, MAX_ENTRIES)) {
    // Let the page breathe between recipes: big exports hold tens of MB of images.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const r = parseMelaJson(n.split('/').pop() ?? n, entries.get(n) as Uint8Array);
    recipes.push(...r.recipes);
    problems.push(...r.problems);
  }
  if (names.length > MAX_ENTRIES) problems.push(`${name}: only the first ${MAX_ENTRIES} were read`);
  if (names.length === 0) problems.push(`${name}: no Mela recipes inside`);
  return { recipes, problems };
}

/** Read and parse several picked files. */
export async function parseMelaFiles(files: readonly File[]): Promise<MelaParseResult> {
  const out: MelaParseResult = { recipes: [], problems: [] };
  const seen = new Set<string>();
  for (const f of files) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await f.arrayBuffer());
    } catch {
      out.problems.push(`${f.name}: could not be read`);
      continue;
    }
    const r = await parseMelaBytes(f.name, bytes);
    for (const rec of r.recipes) {
      // The same recipe picked twice (or present in two files) is listed once.
      const k = melaSourceId(rec);
      if (seen.has(k)) continue;
      seen.add(k);
      out.recipes.push(rec);
    }
    out.problems.push(...r.problems);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Mapping

export interface MappedRecipe {
  input: RecipeInput;
  /** Field names that were cut to fit RECIPE_LIMITS, as readable labels. */
  truncated: string[];
}

/** Short deterministic hash (two 32-bit lanes) for ids too long to store as they are. */
function hash(s: string): string {
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}${s.length.toString(16)}`;
}

/** Mela's id (often a long URL with tracking params): kept as is when short, else hashed. */
export function melaSourceId(m: MelaRecipe): string {
  const raw = m.id || `${m.title}|${m.link}`;
  return raw.length <= 200 ? raw : `h:${hash(raw)}`;
}

const nonBlank = (s: string) => s.split('\n').filter((l) => l.trim() !== '');

/** Map a Mela recipe to a RecipeInput that passes server validation (photoKey added later). */
export function mapMelaRecipe(m: MelaRecipe): MappedRecipe {
  const truncated: string[] = [];
  const cut = (value: string, max: number, label: string, multi: boolean) => {
    const clean = multi ? cleanMultiline(value) : cleanText(value);
    if (clean.length <= max) return clean;
    truncated.push(label);
    return clean.slice(0, max).trim();
  };

  let ingredients = cut(m.ingredients, RECIPE_LIMITS.ingredientChars, 'ingredients', true);
  const lines = nonBlank(ingredients);
  if (lines.length > RECIPE_LIMITS.ingredientLines) {
    truncated.push('ingredients');
    ingredients = lines.slice(0, RECIPE_LIMITS.ingredientLines).join('\n');
  }

  const categories: string[] = [];
  const seen = new Set<string>();
  let catCut = false;
  for (const raw of m.categories) {
    let c = cleanText(raw);
    if (!c) continue;
    if (c.length > RECIPE_LIMITS.category) {
      c = c.slice(0, RECIPE_LIMITS.category).trim();
      catCut = true;
    }
    const k = c.toLowerCase();
    if (seen.has(k)) continue;
    if (categories.length >= RECIPE_LIMITS.categories) {
      catCut = true;
      break;
    }
    seen.add(k);
    categories.push(c);
  }
  if (catCut) truncated.push('categories');

  let sourceUrl = m.link.trim();
  try {
    const u = new URL(sourceUrl);
    if (!/^https?:$/.test(u.protocol) || sourceUrl.length > RECIPE_LIMITS.sourceUrl) sourceUrl = '';
  } catch {
    sourceUrl = '';
  }

  const input: RecipeInput = {
    title: cut(m.title, RECIPE_LIMITS.title, 'title', false) || 'Untitled recipe',
    description: cut(m.description, RECIPE_LIMITS.description, 'description', true),
    categories,
    yield: cut(m.yield, RECIPE_LIMITS.yield, 'yield', false),
    prepTime: cut(m.prepTime, RECIPE_LIMITS.time, 'prep time', false),
    cookTime: cut(m.cookTime, RECIPE_LIMITS.time, 'cook time', false),
    totalTime: cut(m.totalTime, RECIPE_LIMITS.time, 'total time', false),
    ingredients,
    instructions: cut(m.instructions, RECIPE_LIMITS.instructions, 'method', true),
    notes: cut(m.notes, RECIPE_LIMITS.notes, 'notes', true),
    nutrition: cut(m.nutrition, RECIPE_LIMITS.nutrition, 'nutrition', true),
    sourceUrl,
    favourite: m.favourite,
    source: { app: 'mela', id: melaSourceId(m) },
  };
  return { input, truncated: [...new Set(truncated)] };
}

// ---------------------------------------------------------------------------------------
// Duplicates

type Known = Pick<RecipeSummary, 'title' | 'sourceUrl' | 'source'>;

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** True when already in Trolley: same Mela id, else (no id match) exact title and link. */
export function isDuplicate(m: MelaRecipe, existing: readonly Known[]): boolean {
  const id = melaSourceId(m);
  if (existing.some((e) => e.source?.app === 'mela' && e.source.id === id)) return true;
  const { title, sourceUrl } = mapMelaRecipe(m).input;
  return existing.some(
    (e) => norm(e.title) === norm(title ?? '') && (e.sourceUrl ?? '') === (sourceUrl ?? ''),
  );
}

// ---------------------------------------------------------------------------------------
// Import run

export type ImportOutcome =
  | { status: 'imported'; title: string; notes: string[] }
  | { status: 'failed'; title: string; reason: string };

export interface ImportSummary {
  imported: number;
  failed: number;
  skippedDuplicates: number;
  cancelled: boolean;
  /** Imported-with-notes and failed recipes. */
  outcomes: ImportOutcome[];
}

export interface ImportDeps {
  /** Decode, resize and upload the image bytes; returns the photoKey. */
  uploadPhoto: (bytes: Uint8Array) => Promise<string>;
  create: (input: RecipeInput) => Promise<Pick<Recipe, 'id'>>;
  /** Readable reason for a thrown error, and whether it is the household recipe limit. */
  describeError: (err: unknown) => { reason: string; limit: boolean };
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface RunOptions {
  recipes: readonly MelaRecipe[];
  /** Recipes already in the household (for the 500 limit). */
  existingCount: number;
  skippedDuplicates: number;
  signal?: AbortSignal;
  /** Called before each recipe with the number finished so far. */
  onProgress?: (done: number, total: number) => void;
}

/** Import one at a time; stops after the current recipe when `signal` aborts. */
export async function runMelaImport(deps: ImportDeps, opts: RunOptions): Promise<ImportSummary> {
  const { recipes, signal, onProgress } = opts;
  const summary: ImportSummary = {
    imported: 0,
    failed: 0,
    skippedDuplicates: opts.skippedDuplicates,
    cancelled: false,
    outcomes: [],
  };
  let count = opts.existingCount;
  let full = false;
  for (let i = 0; i < recipes.length; i++) {
    if (signal?.aborted) {
      summary.cancelled = true;
      break;
    }
    onProgress?.(i, recipes.length);
    const m = recipes[i] as MelaRecipe;
    const { input, truncated } = mapMelaRecipe(m);
    if (full || count >= RECIPE_LIMITS.recipes) {
      full = true;
      summary.failed++;
      summary.outcomes.push({
        status: 'failed',
        title: input.title,
        reason: `Recipe limit reached (${RECIPE_LIMITS.recipes})`,
      });
      continue;
    }
    const notes: string[] = [];
    if (truncated.length) notes.push(`Shortened to fit: ${truncated.join(', ')}`);
    if (m.image) {
      try {
        input.photoKey = await deps.uploadPhoto(base64ToBytes(m.image));
      } catch {
        notes.push("Photo couldn't be read");
      }
    }
    try {
      await deps.create(input);
      count++;
      summary.imported++;
      if (notes.length) summary.outcomes.push({ status: 'imported', title: input.title, notes });
    } catch (err) {
      const d = deps.describeError(err);
      if (d.limit) full = true;
      summary.failed++;
      summary.outcomes.push({ status: 'failed', title: input.title, reason: d.reason });
    }
  }
  onProgress?.(summary.imported + summary.failed, recipes.length);
  return summary;
}

export type ImageType =
  'image/jpeg' | 'image/png' | 'image/heic' | 'image/webp' | 'application/octet-stream';

/** Sniff the image format from its first bytes (Mela exports JPEG, PNG and HEIC). */
export function sniffImageType(b: Uint8Array): ImageType {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  const at = (i: number) => String.fromCharCode(...Array.from(b.subarray(i, i + 4)));
  if (b.length > 12 && at(8) === 'WEBP') return 'image/webp';
  if (b.length > 12 && at(4) === 'ftyp') return 'image/heic';
  return 'application/octet-stream';
}
