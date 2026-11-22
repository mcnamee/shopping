/**
 * In-memory product search (spec 3.1 / 5.1): the catalogue is ~3k items, so the API
 * Lambda keeps it in memory and ranks with tokenised prefix matching. Also used by the
 * web mock so mock mode ranks exactly like production.
 *
 * Ranking (higher first):
 *   - every query token must match a name or brand token (AND), as an exact word,
 *     a light-stemmed word (banana/bananas, berry/berries) or a word prefix (type-ahead);
 *   - exact word > prefix; name matches outweigh brand matches;
 *   - bonuses when a query token is the name's head noun (last non-size word: "milk" ranks
 *     "Light Milk 2L" above "Milk Chocolate Block"), when all tokens hit the name, and
 *     for earlier positions; shorter names win ties;
 *   - household custom products get a small boost; `boost()` is the hook for purchase
 *     history (Stage 3: "usual product").
 */

export interface SearchableProduct {
  sku: string;
  name: string;
  brand: string | null;
  groupId: string;
  discontinued?: boolean;
  /** Household custom product. */
  custom?: boolean;
}

interface IndexedProduct<T extends SearchableProduct> {
  item: T;
  /** Index of the head noun in `name` (last word that is not a size), or -1. */
  head: number;
  name: string[];
  nameStems: string[];
  brand: string[];
  brandStems: string[];
}

export interface SearchIndex<T extends SearchableProduct> {
  readonly entries: ReadonlyArray<IndexedProduct<T>>;
}

export const MAX_QUERY_LENGTH = 100;
const MAX_QUERY_TOKENS = 8;

const NAME_WEIGHT = 3;
const BRAND_WEIGHT = 1.5;
const EXACT = 1;
const PREFIX_BASE = 0.45;
const PREFIX_SPAN = 0.35;

/** Lowercase, strip accents, '&' -> 'and', drop apostrophes, split on non-alphanumerics. */
export function tokenise(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Very light English plural stemming; enough for grocery names. */
export function stem(token: string): string {
  if (token.length <= 3 || /\d/.test(token)) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('oes')) return token.slice(0, -2);
  if (/(ches|shes|sses|xes)$/.test(token)) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us')) {
    return token.slice(0, -1);
  }
  return token;
}

const SIZE_WORDS = new Set([
  'per',
  'pack',
  'pk',
  'each',
  'ea',
  'x',
  'kg',
  'g',
  'l',
  'ml',
  'approx',
  'bulk',
  'value',
]);

/**
 * Head noun of a product name: English noun phrases put it last, before any size words
 * ("Light Milk 2L" -> milk, "Milk Chocolate Block 200g" -> block).
 */
function headIndex(name: readonly string[]): number {
  for (let i = name.length - 1; i >= 0; i--) {
    const t = name[i] ?? '';
    if (!/\d/.test(t) && !SIZE_WORDS.has(t)) return i;
  }
  return -1;
}

export function buildSearchIndex<T extends SearchableProduct>(items: Iterable<T>): SearchIndex<T> {
  const entries: IndexedProduct<T>[] = [];
  for (const item of items) {
    const name = tokenise(item.name);
    const brand = tokenise(item.brand);
    entries.push({
      item,
      head: headIndex(name),
      name,
      nameStems: name.map(stem),
      brand,
      brandStems: brand.map(stem),
    });
  }
  return { entries };
}

/** Best match quality of one query token against a field, and its position. */
function matchField(
  q: string,
  qStem: string,
  tokens: readonly string[],
  stems: readonly string[],
): { quality: number; position: number } {
  let best = 0;
  let position = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? '';
    let quality = 0;
    if (t === q || stems[i] === qStem) quality = EXACT;
    else if (t.startsWith(q)) quality = PREFIX_BASE + PREFIX_SPAN * (q.length / t.length);
    if (quality > best) {
      best = quality;
      position = i;
      if (quality === EXACT) break;
    }
  }
  return { quality: best, position };
}

export interface SearchOptions<T extends SearchableProduct> {
  /** Filter to one group (household group id). */
  groupId?: string;
  /** Include discontinued catalogue products (default false). */
  includeDiscontinued?: boolean;
  /** Group resolver, for household category-map overrides. Defaults to item.groupId. */
  groupOf?: (item: T) => string;
  /** Extra score, e.g. from purchase history (Stage 3). 0 = neutral. */
  boost?: (item: T) => number;
}

export interface ScoredProduct<T> {
  item: T;
  score: number;
}

/** Score one entry; null when it does not match every query token. */
function scoreEntry<T extends SearchableProduct>(
  entry: IndexedProduct<T>,
  queryTokens: readonly string[],
  queryStems: readonly string[],
): number | null {
  let score = 0;
  let allInName = true;
  let firstPosition = Number.POSITIVE_INFINITY;
  let headQuality = 0;
  for (let i = 0; i < queryTokens.length; i++) {
    const q = queryTokens[i] ?? '';
    const qs = queryStems[i] ?? q;
    const inName = matchField(q, qs, entry.name, entry.nameStems);
    const inBrand = matchField(q, qs, entry.brand, entry.brandStems);
    const nameScore = inName.quality * NAME_WEIGHT;
    const brandScore = inBrand.quality * BRAND_WEIGHT;
    if (nameScore === 0 && brandScore === 0) return null;
    if (nameScore >= brandScore) {
      score += nameScore;
      firstPosition = Math.min(firstPosition, inName.position);
      if (inName.position === entry.head) headQuality = Math.max(headQuality, inName.quality);
    } else {
      score += brandScore;
      allInName = false;
    }
  }
  if (allInName) score += 1;
  // The query names what the product *is* ("milk" -> Light Milk, not Milk Chocolate).
  score += 1.5 * headQuality;
  if (Number.isFinite(firstPosition)) score += 0.3 / (1 + firstPosition);
  // Prefer concise names ("Milk 2L" over "Milk Chocolate Digestives 300g").
  score -= 0.02 * entry.name.length;
  return score;
}

export function searchProducts<T extends SearchableProduct>(
  index: SearchIndex<T>,
  query: string,
  options: SearchOptions<T> = {},
): ScoredProduct<T>[] {
  const queryTokens = tokenise(query.slice(0, MAX_QUERY_LENGTH)).slice(0, MAX_QUERY_TOKENS);
  const queryStems = queryTokens.map(stem);
  const groupOf = options.groupOf ?? ((item: T) => item.groupId);
  const results: ScoredProduct<T>[] = [];

  for (const entry of index.entries) {
    const { item } = entry;
    if (item.discontinued && !options.includeDiscontinued) continue;
    if (options.groupId && groupOf(item) !== options.groupId) continue;

    let score = 0;
    if (queryTokens.length > 0) {
      const s = scoreEntry(entry, queryTokens, queryStems);
      if (s === null) continue;
      score = s;
    }
    if (item.custom) score += 0.25;
    if (options.boost) score += options.boost(item);
    results.push({ item, score });
  }

  return results.sort(compareScored);
}

/** Result order: score desc, then name, then sku (stable across pages). */
export function compareScored<T extends SearchableProduct>(
  a: ScoredProduct<T>,
  b: ScoredProduct<T>,
): number {
  return (
    b.score - a.score ||
    a.item.name.localeCompare(b.item.name, 'en-AU') ||
    a.item.sku.localeCompare(b.item.sku)
  );
}

/** Merge already-ranked lists (e.g. catalogue + household custom products). */
export function mergeRanked<T extends SearchableProduct>(
  ...lists: ReadonlyArray<ScoredProduct<T>>[]
): ScoredProduct<T>[] {
  return lists.flat().sort(compareScored);
}

// ---------------------------------------------------------------------------------------
// Opaque pagination cursor (offset into the ranked result list).

export function encodeCursor(offset: number): string {
  return btoa(`o:${offset}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Returns the offset, or null for a malformed cursor. */
export function decodeCursor(cursor: string): number | null {
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(cursor)) return null;
  let raw: string;
  try {
    const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    raw = atob(b64);
  } catch {
    return null;
  }
  const m = /^o:(\d{1,6})$/.exec(raw);
  return m ? Number(m[1]) : null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function paginate<T>(all: readonly T[], offset: number, limit: number): Page<T> {
  const items = all.slice(offset, offset + limit);
  const next = offset + limit;
  return { items, nextCursor: next < all.length ? encodeCursor(next) : null };
}
