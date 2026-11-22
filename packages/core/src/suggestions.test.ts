import { describe, expect, it } from 'vitest';
import type { ProductSnapshot } from './lists';
import type { UnitType } from './product';
import {
  cadenceText,
  COLD_START_NOTE,
  daysBetween,
  historyReason,
  isDue,
  isLapsed,
  MAX_SUGGESTIONS,
  median,
  productStats,
  suggestCandidates,
  suggestionQty,
  TEMPLATE_REASON,
  type PurchaseInput,
  type TemplateInput,
} from './suggestions';

const TODAY = '2026-11-22';

/** YYYY-MM-DD `n` days before TODAY. */
function ago(n: number): string {
  const d = new Date(Date.UTC(2026, 10, 22 - n));
  return d.toISOString().slice(0, 10);
}

function buy(
  productId: string,
  daysAgo: number,
  qty = 1,
  unit: UnitType = 'pack',
  listId?: string,
  name = `Product ${productId}`,
): PurchaseInput {
  return {
    productId,
    name,
    groupId: 'pantry',
    qty,
    unit,
    listId: listId ?? `list-d${daysAgo}`,
    date: ago(daysAgo),
  };
}

/** Bought every `every` days, `times` times, most recently `lastAgo` days ago. */
function series(productId: string, every: number, times: number, lastAgo: number, qty = 1) {
  return Array.from({ length: times }, (_, i) => buy(productId, lastAgo + i * every, qty));
}

function snap(productId: string, name: string, groupId = 'pantry', unitType: UnitType = 'pack') {
  return {
    productId,
    name,
    brand: null,
    imageUrl: null,
    packSize: null,
    groupId,
    unitType,
  } satisfies ProductSnapshot;
}

function weekly(
  name: string,
  items: Array<[ProductSnapshot, number, UnitType, string?]>,
  type: 'weekly' | 'meal' = 'weekly',
): TemplateInput {
  return {
    name,
    type,
    items: items.map(([product, qty, unit, note]) => ({ product, qty, unit, note: note ?? null })),
  };
}

/** Three archived lists (a lapsed product) so the engine is past cold start. */
const WARM: PurchaseInput[] = [
  buy('filler', 300, 1, 'pack', 'a'),
  buy('filler', 310, 1, 'pack', 'b'),
  buy('filler', 320, 1, 'pack', 'c'),
];

describe('dates and numbers', () => {
  it('counts whole days across months and DST changes', () => {
    expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7);
    expect(daysBetween('2026-09-28', '2026-10-12')).toBe(14); // AEDT starts 4 Oct
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween(TODAY, TODAY)).toBe(0);
  });

  it('takes the median of odd and even samples', () => {
    expect(median([])).toBeNull();
    expect(median([7])).toBe(7);
    expect(median([14, 7, 7])).toBe(7);
    expect(median([7, 14])).toBe(10.5);
    expect(median([28, 7, 7, 30])).toBe(17.5);
  });

  it('makes quantities valid for the unit', () => {
    expect(suggestionQty(1.4, 'pack')).toBe(1);
    expect(suggestionQty(0.3, 'each')).toBe(1);
    expect(suggestionQty(1.333, 'kg')).toBe(1.33);
    expect(suggestionQty(0.01, 'kg')).toBe(0.05);
    expect(suggestionQty(5000, 'pack')).toBe(999);
    expect(suggestionQty(333.3, 'g')).toBe(333);
  });
});

describe('productStats (A1)', () => {
  it('computes count, average qty, median interval and days since last', () => {
    const rows = [buy('milk', 6, 2), buy('milk', 13, 2), buy('milk', 20, 3), buy('milk', 34, 1)];
    const s = productStats(rows, TODAY).get('milk');
    expect(s).toMatchObject({
      count: 4,
      avgQty: 2, // (2+2+3+1)/4
      medianIntervalDays: 7, // 7, 7, 14
      lastDate: ago(6),
      daysSinceLast: 6,
      unit: 'pack',
    });
  });

  it('counts distinct dates: two lists on the same day are one purchase date', () => {
    const rows = [buy('eggs', 10, 1, 'pack', 'x'), buy('eggs', 10, 1, 'pack', 'y'), buy('eggs', 3)];
    const s = productStats(rows, TODAY).get('eggs');
    expect(s?.count).toBe(2);
    expect(s?.medianIntervalDays).toBe(7);
    expect(s?.avgQty).toBe(1);
  });

  it('combines units in the most-bought unit, converting kg/g and summing per list', () => {
    const rows = [
      buy('mince', 7, 1, 'kg', 'l1'),
      buy('mince', 7, 500, 'g', 'l1'), // same list: 1.5 kg that shop
      buy('mince', 14, 0.5, 'kg', 'l2'),
      buy('mince', 21, 1, 'kg', 'l3'),
      buy('mince', 28, 2, 'pack', 'l4'), // other family: counts as a date, not in avg qty
    ];
    const s = productStats(rows, TODAY).get('mince');
    expect(s?.unit).toBe('kg');
    expect(s?.count).toBe(4);
    expect(s?.avgQty).toBe(1); // (1.5 + 0.5 + 1) / 3
  });

  it('breaks a unit tie by the most recent purchase', () => {
    const rows = [buy('oil', 20, 1, 'L', 'a'), buy('oil', 5, 500, 'mL', 'b')];
    expect(productStats(rows, TODAY).get('oil')?.unit).toBe('mL');
  });

  it('uses the latest name and group, and ignores rows dated after today', () => {
    const rows = [
      buy('x', 20, 1, 'pack', 'a', 'Old name'),
      buy('x', 5, 1, 'pack', 'b', 'New name'),
      { ...buy('x', 0, 1, 'pack', 'c', 'Future'), date: '2026-11-30' },
    ];
    const s = productStats(rows, TODAY).get('x');
    expect(s?.name).toBe('New name');
    expect(s?.count).toBe(2);
  });

  it('has no interval with a single purchase date', () => {
    expect(productStats([buy('once', 30)], TODAY).get('once')?.medianIntervalDays).toBeNull();
  });
});

describe('due rule (A2) and lapsed cut-off', () => {
  it('is due at 0.8 x the median interval, not before', () => {
    expect(isDue({ count: 3, medianIntervalDays: 10, daysSinceLast: 8 })).toBe(true);
    expect(isDue({ count: 3, medianIntervalDays: 10, daysSinceLast: 7 })).toBe(false);
    expect(isDue({ count: 2, medianIntervalDays: 28, daysSinceLast: 23 })).toBe(true);
    expect(isDue({ count: 2, medianIntervalDays: 28, daysSinceLast: 22 })).toBe(false);
  });

  it('never makes a product bought once (or on one date) due', () => {
    expect(isDue({ count: 1, medianIntervalDays: null, daysSinceLast: 400 })).toBe(false);
  });

  it('drops lapsed items: weekly after 7 weeks, monthly after 4 months', () => {
    expect(isLapsed(49, 7)).toBe(false);
    expect(isLapsed(50, 7)).toBe(true);
    expect(isLapsed(120, 30)).toBe(false);
    expect(isLapsed(121, 30)).toBe(true);
    expect(isDue({ count: 5, medianIntervalDays: 7, daysSinceLast: 60 })).toBe(false);
  });
});

describe('reasons (A5)', () => {
  it('reads in weeks from 14 days, else days', () => {
    expect(cadenceText(28)).toBe('~4 weeks');
    expect(cadenceText(14)).toBe('~2 weeks');
    expect(cadenceText(17.5)).toBe('~3 weeks');
    expect(cadenceText(7)).toBe('~7 days');
    expect(cadenceText(1)).toBe('~1 day');
  });

  it('says how long since the last purchase', () => {
    expect(historyReason({ medianIntervalDays: 28, daysSinceLast: 27 })).toBe(
      'Usually every ~4 weeks, last bought 27 days ago',
    );
    expect(historyReason({ medianIntervalDays: 3, daysSinceLast: 1 })).toBe(
      'Usually every ~3 days, last bought 1 day ago',
    );
    expect(historyReason({ medianIntervalDays: null, daysSinceLast: 1 })).toBeNull();
  });
});

describe('suggestCandidates', () => {
  const MILK = snap('milk', 'Full Cream Milk 2L', 'dairy-eggs');
  const BREAD = snap('bread', 'Wholemeal Bread', 'bakery', 'each');
  const BANANAS = snap('bananas', 'Bananas', 'fruit-veg', 'kg');
  const BASICS = weekly('Weekly basics', [
    [MILK, 2, 'pack', 'Blue top'],
    [BREAD, 1, 'each'],
    [BANANAS, 1.5, 'kg'],
  ]);

  it('A3/A5: weekly template items first (aisle order), then due items by most overdue', () => {
    const purchases = [
      ...WARM,
      ...series('razors', 28, 3, 27), // 27/28 = 0.96
      ...series('dogfood', 14, 4, 20), // 20/14 = 1.43
      ...series('coffee', 21, 3, 10), // not due
    ];
    const r = suggestCandidates({ purchases, templates: [BASICS], today: TODAY });
    expect(r.coldStart).toBe(false);
    expect(r.note).toBeNull();
    expect(r.candidates.map((c) => c.productId)).toEqual([
      'bananas', // fruit-veg
      'bread', // bakery
      'milk', // dairy-eggs
      'dogfood',
      'razors',
    ]);
    const razors = r.candidates.find((c) => c.productId === 'razors');
    expect(razors).toMatchObject({
      origin: 'history',
      fromTemplate: false,
      qty: 1,
      unit: 'pack',
      note: null,
      reason: 'Usually every ~4 weeks, last bought 27 days ago',
      templateProduct: null,
    });
    expect(r.candidates.find((c) => c.productId === 'milk')).toMatchObject({
      origin: 'template',
      fromTemplate: true,
      qty: 2,
      note: 'Blue top',
      reason: TEMPLATE_REASON,
      templateProduct: MILK,
    });
  });

  it('A3: a product in both appears once, with template qty and both reasons', () => {
    const purchases = [...WARM, ...series('milk', 7, 5, 6, 3)];
    const r = suggestCandidates({ purchases, templates: [BASICS], today: TODAY });
    const milk = r.candidates.filter((c) => c.productId === 'milk');
    expect(milk).toHaveLength(1);
    expect(milk[0]).toMatchObject({
      origin: 'both',
      qty: 2,
      unit: 'pack',
      reason: 'On your weekly template - usually every ~7 days, last bought 6 days ago',
    });
  });

  it('A3: history qty is the average rounded to the unit precision', () => {
    const purchases = [
      ...WARM,
      buy('apples', 7, 1.25, 'kg', 'a1'),
      buy('apples', 14, 1, 'kg', 'a2'),
      buy('apples', 21, 1, 'kg', 'a3'),
    ];
    const r = suggestCandidates({ purchases, templates: [], today: TODAY });
    expect(r.candidates[0]).toMatchObject({ productId: 'apples', qty: 1.08, unit: 'kg' });
  });

  it('A4: excludes products already on the list, in any unit', () => {
    const purchases = [...WARM, ...series('razors', 28, 3, 27)];
    const r = suggestCandidates({
      purchases,
      templates: [BASICS],
      today: TODAY,
      exclude: ['milk', 'razors'],
    });
    expect(r.candidates.map((c) => c.productId)).toEqual(['bananas', 'bread']);
  });

  it('ignores meal templates and merges weekly templates by the merge rule', () => {
    const tacos = weekly('Tacos', [[snap('mince', 'Mince'), 1, 'pack']], 'meal');
    const extra = weekly('Another weekly', [
      [MILK, 1, 'pack'],
      [MILK, 1, 'L'], // second unit of the same product: one candidate only
    ]);
    const r = suggestCandidates({ purchases: [], templates: [BASICS, tacos, extra], today: TODAY });
    const ids = r.candidates.map((c) => c.productId);
    expect(ids).not.toContain('mince');
    expect(ids.filter((id) => id === 'milk')).toHaveLength(1);
    expect(r.candidates.find((c) => c.productId === 'milk')).toMatchObject({
      qty: 3,
      unit: 'pack',
    });
  });

  it('A6: cold start (< 3 archived lists) returns weekly template items only, with the note', () => {
    const purchases = [...series('razors', 7, 2, 7)]; // 2 lists
    const r = suggestCandidates({ purchases, templates: [BASICS], today: TODAY });
    expect(r.coldStart).toBe(true);
    expect(r.archivedListCount).toBe(2);
    expect(r.note).toBe(COLD_START_NOTE);
    expect(r.candidates.map((c) => c.origin)).toEqual(['template', 'template', 'template']);
    expect(r.candidates.every((c) => c.reason === TEMPLATE_REASON)).toBe(true);
  });

  it('A6: nothing at all with no template and no history', () => {
    const r = suggestCandidates({ purchases: [], templates: [], today: TODAY });
    expect(r).toMatchObject({ coldStart: true, candidates: [] });
  });

  it('three archived lists end the cold start', () => {
    const purchases = series('razors', 28, 3, 27);
    const r = suggestCandidates({ purchases, templates: [], today: TODAY });
    expect(r.coldStart).toBe(false);
    expect(r.candidates.map((c) => c.productId)).toEqual(['razors']);
  });

  it('A5: caps at 40, keeping template items', () => {
    const many = Array.from({ length: 60 }, (_, i) => series(`p${i}`, 7, 3, 7 + (i % 5))).flat();
    const r = suggestCandidates({ purchases: many, templates: [BASICS], today: TODAY });
    expect(r.candidates).toHaveLength(MAX_SUGGESTIONS);
    expect(r.candidates.slice(0, 3).every((c) => c.fromTemplate)).toBe(true);
  });

  it('weekly vs monthly: a weekly item is due after 6 days, a monthly one only after ~3 weeks', () => {
    const purchases = [
      ...WARM,
      ...series('weekly', 7, 6, 6),
      ...series('monthly', 30, 4, 20), // 20 < 24
      ...series('monthly2', 30, 4, 24), // 24 >= 24
    ];
    const ids = suggestCandidates({ purchases, templates: [], today: TODAY }).candidates.map(
      (c) => c.productId,
    );
    expect(ids).toEqual(['weekly', 'monthly2']);
  });

  it('orders ties by purchase count, then name', () => {
    const purchases = [
      ...WARM,
      ...series('b', 7, 3, 7),
      ...series('a', 7, 3, 7),
      ...series('c', 7, 5, 7),
    ];
    const ids = suggestCandidates({ purchases, templates: [], today: TODAY }).candidates.map(
      (c) => c.productId,
    );
    expect(ids).toEqual(['c', 'a', 'b']);
  });

  it('is deterministic', () => {
    const purchases = [...WARM, ...series('razors', 28, 3, 27), ...series('dog', 14, 3, 15)];
    const a = suggestCandidates({ purchases, templates: [BASICS], today: TODAY });
    const b = suggestCandidates({
      purchases: [...purchases].reverse(),
      templates: [BASICS],
      today: TODAY,
    });
    expect(b).toEqual(a);
  });
});
