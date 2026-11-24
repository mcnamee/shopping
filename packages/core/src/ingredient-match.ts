/**
 * Match recipe ingredient lines to ALDI products (D-115). Same resolution order as the
 * chatbot (D-099): templates > purchase history > catalogue, but a catalogue-only match is
 * returned only when confident (every core word is a whole word of the product's name and
 * it is clearly the best result); otherwise the line stays free text, with a few
 * alternatives to pick from. I/O is injected so the API and the mock share the rules.
 */
import type { ProductSummary, RecipeMatchProduct, RecipeMatchRow } from './api-types';
import {
  clearMatchIndex,
  mostBoughtUnit,
  nameMatchesAll,
  pickTemplateItem,
  type TemplateCandidate,
  rankHistoryMatches,
  templateMatches,
  type HistoryPurchase,
  type TemplateLike,
} from './assistant';
import { parseIngredient, type ParsedIngredient } from './ingredients';
import type { UnitType } from './product';
import { tokenise } from './search';

export const MAX_ALTERNATIVES = 3;

export interface MatchPurchase extends HistoryPurchase {
  qty?: number;
}

export interface MatchSources {
  templates: readonly TemplateLike[];
  purchases: readonly MatchPurchase[];
  /** Remembered units (D-052/D-053), by product id. */
  unitOverrides: Readonly<Record<string, { unit: UnitType } | undefined>>;
  /** The product when the household can add it now (custom, or on the shelf), else null. */
  available(productId: string): Promise<ProductSummary | null>;
  /** Ranked catalogue + custom search (notAtStore and discontinued already excluded). */
  search(query: string): Promise<Array<{ item: ProductSummary; score: number }>>;
}

export interface IngredientMatch {
  match: RecipeMatchProduct | null;
  alternatives: RecipeMatchProduct[];
}

const productOf = (
  p: ProductSummary,
  source: RecipeMatchProduct['source'],
  qty: number,
  unit: UnitType,
): RecipeMatchProduct => ({
  productId: p.sku,
  name: p.name,
  imageUrl: p.imageUrl,
  packSize: p.packSize,
  unit,
  qty,
  source,
});

/** Match one core ingredient name (see `parseIngredient`) against the household's products. */
export async function matchIngredientName(
  name: string,
  src: MatchSources,
): Promise<IngredientMatch> {
  const cache = new Map<string, Promise<ProductSummary | null>>();
  const avail = (id: string) => {
    let p = cache.get(id);
    if (!p) cache.set(id, (p = src.available(id)));
    return p;
  };
  const defaults = (p: ProductSummary, source: 'catalogue'): RecipeMatchProduct =>
    productOf(p, source, 1, src.unitOverrides[p.sku]?.unit ?? p.defaultUnitType ?? p.unitType);

  const seen = new Set<string>();
  const alternatives: RecipeMatchProduct[] = [];
  const addAlt = (p: RecipeMatchProduct) => {
    if (seen.has(p.productId) || alternatives.length >= MAX_ALTERNATIVES) return;
    seen.add(p.productId);
    alternatives.push(p);
  };
  const chosen: { match: RecipeMatchProduct | null } = { match: null };
  const take = (p: RecipeMatchProduct) => {
    chosen.match = p;
    seen.add(p.productId);
  };

  // (1) Templates, highest tier first (D-099).
  const fromTemplates: TemplateCandidate[] = [];
  for (const c of templateMatches(src.templates, name)) {
    if (await avail(c.productId)) fromTemplates.push(c);
  }
  const pick = pickTemplateItem(fromTemplates, name, src.purchases);
  const tplProduct = async (c: TemplateCandidate) =>
    productOf((await avail(c.productId)) as ProductSummary, 'template', c.qty, c.unit);
  if (pick.kind === 'one') take(await tplProduct(pick.candidate));
  else if (pick.kind === 'tied') {
    for (const c of pick.candidates.slice(0, MAX_ALTERNATIVES)) addAlt(await tplProduct(c));
  }
  for (const c of fromTemplates) {
    if (alternatives.length >= MAX_ALTERNATIVES) break;
    if (!seen.has(c.productId)) addAlt(await tplProduct(c));
  }

  // (2) Purchase history: the household's usual product.
  const historyProduct = async (m: { productId: string }) => {
    const p = await avail(m.productId);
    if (!p) return null;
    const unit = mostBoughtUnit(src.purchases, m.productId) ?? p.defaultUnitType ?? p.unitType;
    const latest = src.purchases
      .filter((x) => x.productId === m.productId && x.unit === unit)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    return productOf(p, 'history', latest?.qty && latest.qty > 0 ? latest.qty : 1, unit);
  };
  for (const m of rankHistoryMatches(src.purchases, name).slice(0, 6)) {
    if (seen.has(m.productId)) continue;
    const p = await historyProduct(m);
    if (!p) continue;
    if (!chosen.match && pick.kind === 'none') take(p);
    else addAlt(p);
  }

  // (3) Catalogue: confident only.
  const ranked = await src.search(name);
  if (!chosen.match && pick.kind === 'none') {
    const i = clearMatchIndex(
      name,
      ranked.map((r) => ({ name: r.item.name, score: r.score })),
    );
    const hit = i === null ? undefined : ranked[i]?.item;
    if (hit && nameMatchesAll(name, hit.name) && !seen.has(hit.sku)) {
      take(defaults(hit, 'catalogue'));
    }
  }
  // Alternatives: results with every word first, then products sharing the head noun
  // ("chopped tomatoes" -> Diced Tomatoes, Cherry Tomatoes).
  for (const r of ranked) {
    if (nameMatchesAll(name, r.item.name) && !seen.has(r.item.sku)) {
      addAlt(defaults(r.item, 'catalogue'));
    }
  }
  const words = tokenise(name);
  const headWord = words[words.length - 1];
  if (alternatives.length < MAX_ALTERNATIVES && words.length > 1 && headWord) {
    for (const r of await src.search(headWord)) {
      if (!seen.has(r.item.sku)) addAlt(defaults(r.item, 'catalogue'));
    }
  }
  return { match: chosen.match, alternatives };
}

/** Rows for parsed ingredient lines. Runs with a small concurrency; order is preserved. */
export async function matchIngredients(
  parsed: readonly ParsedIngredient[],
  src: MatchSources,
  nameFor: (p: ParsedIngredient) => string = (p) => p.name,
): Promise<RecipeMatchRow[]> {
  const out: RecipeMatchRow[] = new Array<RecipeMatchRow>(parsed.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= parsed.length) return;
      const p = parsed[i] as ParsedIngredient;
      const name = nameFor(p);
      const m = await matchIngredientName(name, src);
      out[i] = {
        line: p.original,
        name,
        match: m.match,
        alternatives: m.alternatives,
        pantry: p.pantry,
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, parsed.length) }, worker));
  return out;
}

/** Parse then match the lines of a recipe (headings already removed). */
export function matchRecipeLines(lines: readonly string[], src: MatchSources) {
  return matchIngredients(lines.map(parseIngredient), src);
}
