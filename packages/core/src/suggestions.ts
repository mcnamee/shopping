/**
 * Stage 3 "Suggest items" deterministic engine (docs/stages/stage-3.md section A, D-062,
 * D-067, D-069). Pure: purchase rows (D-050/D-054) + templates + what is already on the
 * target list + today's household-local date in, ordered candidates with reasons out.
 * services/api adds product snapshots and the optional AI re-rank; the web mock runs the
 * same function over its seeded history.
 */
import {
  ITEM_QTY_MAX,
  mergeLines,
  normaliseAisleOrder,
  type LineInput,
  type ProductSnapshot,
  type PurchaseRecord,
  type TemplateItem,
  type TemplateType,
} from './lists';
import { effectiveGroupId } from './groups';
import type { UnitType } from './product';
import { QUANTITY_RULES, roundQuantity } from './quantity';

// ---------------------------------------------------------------------------------------
// Tuning constants

/** "Due" when days since last purchase >= DUE_FACTOR x median interval (A2). */
export const DUE_FACTOR = 0.8;
/** Distinct purchase dates needed before a product can be "due" (A2: count >= 2). */
export const MIN_PURCHASES_FOR_DUE = 2;
/**
 * Lapsed: a product not bought for more than max(LAPSED_FACTOR x median, median +
 * LAPSED_GRACE_DAYS) days is no longer suggested from history (the household has
 * probably stopped buying it). Weekly items lapse after 7 weeks, monthly after 4 months
 * (D-069). Template items are unaffected.
 */
export const LAPSED_FACTOR = 4;
export const LAPSED_GRACE_DAYS = 42;
/** Fewer archived lists than this is a cold start: weekly template items only (A6). */
export const COLD_START_MIN_LISTS = 3;
/** Most suggestions returned (A5). */
export const MAX_SUGGESTIONS = 40;
/** Medians at or above this read in weeks ("~4 weeks"), below it in days (A5). */
const WEEKS_FROM_DAYS = 14;

export const COLD_START_NOTE =
  'Suggestions get smarter after a few shops - for now these are from your weekly template.';
export const TEMPLATE_REASON = 'On your weekly template';

// ---------------------------------------------------------------------------------------
// Types

/** The purchase-row fields the engine reads. */
export type PurchaseInput = Pick<
  PurchaseRecord,
  'productId' | 'name' | 'groupId' | 'qty' | 'unit' | 'listId' | 'date'
>;

export interface TemplateInput {
  name: string;
  type: TemplateType;
  items: readonly Pick<TemplateItem, 'product' | 'qty' | 'unit' | 'note'>[];
}

export interface ProductStats {
  productId: string;
  /** Name and group from the most recent purchase row. */
  name: string;
  groupId: string;
  /** Most-bought unit; other units of the product are converted into it where possible. */
  unit: UnitType;
  /** Distinct purchase dates. */
  count: number;
  /** Average quantity per purchase in `unit`, rounded to the unit's precision (D-052). */
  avgQty: number;
  /** Median days between distinct purchase dates; null with fewer than 2 dates. */
  medianIntervalDays: number | null;
  lastDate: string;
  daysSinceLast: number;
}

export type SuggestionOrigin = 'template' | 'history' | 'both';

export interface SuggestionCandidate {
  productId: string;
  name: string;
  groupId: string;
  qty: number;
  unit: UnitType;
  /** Template note (history-only candidates have none). */
  note: string | null;
  origin: SuggestionOrigin;
  fromTemplate: boolean;
  /** Snapshot from the template line; history-only candidates are resolved by the caller. */
  templateProduct: ProductSnapshot | null;
  /** History stats when the product has been bought (also for template items). */
  stats: ProductStats | null;
  /** Deterministic one-line reason (A5). */
  reason: string;
  /** daysSinceLast / median interval when known (higher = more overdue). */
  overdue: number | null;
  /** Sort key, higher first: template items 100 + overdue, history items overdue. */
  score: number;
}

export interface SuggestInput {
  purchases: readonly PurchaseInput[];
  templates: readonly TemplateInput[];
  /** Product ids already on the target list (any unit, ticked or not, A4). */
  exclude?: Iterable<string>;
  /** Household-local date "YYYY-MM-DD" (localDate(now)). */
  today: string;
  /** Household aisle order, to order template items as the shop is walked. */
  aisleOrder?: readonly string[];
  /** Default MAX_SUGGESTIONS. */
  limit?: number;
}

export interface SuggestResult {
  coldStart: boolean;
  /** The cold-start note (A6), else null. */
  note: string | null;
  /** Distinct archived lists seen in the purchase rows. */
  archivedListCount: number;
  candidates: SuggestionCandidate[];
}

// ---------------------------------------------------------------------------------------
// Dates and numbers

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / DAY_MS);
}

/** Whole days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

const FAMILY: Partial<Record<UnitType, { family: string; base: number }>> = {
  kg: { family: 'mass', base: 1000 },
  g: { family: 'mass', base: 1 },
  L: { family: 'volume', base: 1000 },
  mL: { family: 'volume', base: 1 },
};

/** Convert between kg/g and L/mL without clamping; null across families or count units. */
function convert(qty: number, from: UnitType, to: UnitType): number | null {
  if (from === to) return qty;
  const a = FAMILY[from];
  const b = FAMILY[to];
  if (!a || !b || a.family !== b.family) return null;
  return (qty * a.base) / b.base;
}

/** A quantity that is valid for a stored line (D-052): unit precision, min, max. */
export function suggestionQty(value: number, unit: UnitType): number {
  const rounded = roundQuantity(value, unit);
  return Math.min(ITEM_QTY_MAX[unit], Math.max(QUANTITY_RULES[unit].min, rounded));
}

// ---------------------------------------------------------------------------------------
// Stats (A1)

/** Per-product stats from purchase rows; rows dated after `today` are ignored. */
export function productStats(
  purchases: readonly PurchaseInput[],
  today: string,
): Map<string, ProductStats> {
  const byProduct = new Map<string, PurchaseInput[]>();
  for (const p of purchases) {
    if (p.date > today) continue;
    const rows = byProduct.get(p.productId);
    if (rows) rows.push(p);
    else byProduct.set(p.productId, [p]);
  }
  const out = new Map<string, ProductStats>();
  for (const [productId, rows] of byProduct) {
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.listId.localeCompare(b.listId));
    const latest = rows.at(-1) as PurchaseInput;

    // Most-bought unit (by rows); ties go to the unit bought most recently.
    const unitCount = new Map<UnitType, { n: number; last: number }>();
    rows.forEach((r, i) => {
      const u = unitCount.get(r.unit) ?? { n: 0, last: -1 };
      unitCount.set(r.unit, { n: u.n + 1, last: i });
    });
    const unit = [...unitCount.entries()].sort(
      (a, b) => b[1].n - a[1].n || b[1].last - a[1].last,
    )[0]?.[0] as UnitType;

    // Average qty per purchase occasion (list), in `unit`.
    const perList = new Map<string, number>();
    for (const r of rows) {
      const q = convert(r.qty, r.unit, unit);
      if (q === null) continue;
      perList.set(r.listId, (perList.get(r.listId) ?? 0) + q);
    }
    const qtys = [...perList.values()];
    const avg = qtys.reduce((a, b) => a + b, 0) / Math.max(1, qtys.length);

    const dates = [...new Set(rows.map((r) => r.date))];
    const intervals = dates.slice(1).map((d, i) => daysBetween(dates[i] as string, d));
    const lastDate = dates.at(-1) as string;
    out.set(productId, {
      productId,
      name: latest.name,
      groupId: effectiveGroupId({ groupId: latest.groupId, name: latest.name }),
      unit,
      count: dates.length,
      avgQty: suggestionQty(avg, unit),
      medianIntervalDays: median(intervals),
      lastDate,
      daysSinceLast: daysBetween(lastDate, today),
    });
  }
  return out;
}

/** Due rule (A2) plus the lapsed cut-off (D-069). */
export function isDue(stats: Pick<ProductStats, 'count' | 'medianIntervalDays' | 'daysSinceLast'>) {
  const m = stats.medianIntervalDays;
  if (stats.count < MIN_PURCHASES_FOR_DUE || m === null || m <= 0) return false;
  if (stats.daysSinceLast < DUE_FACTOR * m) return false;
  return !isLapsed(stats.daysSinceLast, m);
}

export function isLapsed(daysSinceLast: number, medianIntervalDays: number): boolean {
  return (
    daysSinceLast >
    Math.max(LAPSED_FACTOR * medianIntervalDays, medianIntervalDays + LAPSED_GRACE_DAYS)
  );
}

// ---------------------------------------------------------------------------------------
// Reasons (A5)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "~4 weeks" (median >= 14 days) or "~5 days". */
export function cadenceText(medianDays: number): string {
  if (medianDays >= WEEKS_FROM_DAYS) return `~${plural(Math.round(medianDays / 7), 'week')}`;
  return `~${plural(Math.max(1, Math.round(medianDays)), 'day')}`;
}

/** "Usually every ~4 weeks, last bought 27 days ago". */
export function historyReason(
  stats: Pick<ProductStats, 'medianIntervalDays' | 'daysSinceLast'>,
): string | null {
  if (stats.medianIntervalDays === null) return null;
  const since = stats.daysSinceLast <= 0 ? 'today' : `${plural(stats.daysSinceLast, 'day')} ago`;
  return `Usually every ${cadenceText(stats.medianIntervalDays)}, last bought ${since}`;
}

function templateReasonWith(stats: ProductStats | null): string {
  const h = stats && stats.count >= MIN_PURCHASES_FOR_DUE ? historyReason(stats) : null;
  if (!h) return TEMPLATE_REASON;
  return `${TEMPLATE_REASON} - ${h.charAt(0).toLowerCase()}${h.slice(1)}`;
}

// ---------------------------------------------------------------------------------------
// Candidates (A3 to A6)

/** Weekly template lines, merged by D-046 across templates, one line per product. */
function weeklyLines(templates: readonly TemplateInput[]): LineInput[] {
  const weekly = templates
    .filter((t) => t.type === 'weekly')
    .sort((a, b) => a.name.localeCompare(b.name, 'en-AU', { sensitivity: 'base' }));
  const merged = mergeLines(
    weekly.flatMap((t) =>
      t.items.map((i) => ({ product: i.product, qty: i.qty, unit: i.unit, note: i.note })),
    ),
  ).lines;
  const seen = new Set<string>();
  return merged.filter((l) => {
    if (seen.has(l.product.productId)) return false;
    seen.add(l.product.productId);
    return true;
  });
}

export function suggestCandidates(input: SuggestInput): SuggestResult {
  const exclude = new Set(input.exclude ?? []);
  const limit = input.limit ?? MAX_SUGGESTIONS;
  const archivedListCount = new Set(
    input.purchases.filter((p) => p.date <= input.today).map((p) => p.listId),
  ).size;
  const coldStart = archivedListCount < COLD_START_MIN_LISTS;
  const stats = coldStart
    ? new Map<string, ProductStats>()
    : productStats(input.purchases, input.today);

  const overdueOf = (s: ProductStats | null) =>
    s && s.medianIntervalDays && s.count >= MIN_PURCHASES_FOR_DUE
      ? s.daysSinceLast / s.medianIntervalDays
      : null;

  // Weekly template items, in aisle order then name.
  const order = normaliseAisleOrder(input.aisleOrder);
  const rank = (g: string) => {
    const i = order.indexOf(g);
    return i === -1 ? order.length : i;
  };
  const templateCandidates: SuggestionCandidate[] = weeklyLines(input.templates)
    .filter((l) => !exclude.has(l.product.productId))
    .sort(
      (a, b) =>
        rank(effectiveGroupId(a.product)) - rank(effectiveGroupId(b.product)) ||
        a.product.name.localeCompare(b.product.name, 'en-AU', { sensitivity: 'base' }),
    )
    .map((l) => {
      const s = stats.get(l.product.productId) ?? null;
      const overdue = overdueOf(s);
      const due = s !== null && isDue(s);
      return {
        productId: l.product.productId,
        name: l.product.name,
        groupId: effectiveGroupId(l.product),
        qty: l.qty,
        unit: l.unit,
        note: l.note,
        origin: due ? 'both' : 'template',
        fromTemplate: true,
        templateProduct: l.product,
        stats: s,
        reason: templateReasonWith(s),
        overdue,
        score: 100 + (overdue ?? 0),
      } satisfies SuggestionCandidate;
    });

  const inTemplate = new Set(templateCandidates.map((c) => c.productId));
  const historyCandidates: SuggestionCandidate[] = [...stats.values()]
    .filter((s) => !exclude.has(s.productId) && !inTemplate.has(s.productId) && isDue(s))
    .map((s) => {
      const overdue = overdueOf(s) as number;
      return {
        productId: s.productId,
        name: s.name,
        groupId: s.groupId,
        qty: s.avgQty,
        unit: s.unit,
        note: null,
        origin: 'history',
        fromTemplate: false,
        templateProduct: null,
        stats: s,
        reason: historyReason(s) as string,
        overdue,
        score: overdue,
      } satisfies SuggestionCandidate;
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.stats?.count ?? 0) - (a.stats?.count ?? 0) ||
        a.name.localeCompare(b.name, 'en-AU', { sensitivity: 'base' }),
    );

  return {
    coldStart,
    note: coldStart ? COLD_START_NOTE : null,
    archivedListCount,
    candidates: [...templateCandidates, ...historyCandidates].slice(0, limit),
  };
}
