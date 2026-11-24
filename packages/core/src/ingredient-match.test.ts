import { describe, expect, it } from 'vitest';
import type { ProductSummary } from './api-types';
import { matchIngredientName, matchRecipeLines, type MatchSources } from './ingredient-match';
import { buildSearchIndex, searchProducts } from './search';
import type { UnitType } from './product';

const prod = (sku: string, name: string, unit: UnitType = 'each', packSize = '1 each') =>
  ({
    sku,
    name,
    brand: null,
    imageUrl: `https://img/${sku}.jpg`,
    price: 100,
    unitPrice: null,
    packSize,
    unitType: unit,
    defaultUnitType: unit,
    groupId: 'pantry',
    custom: false,
  }) satisfies ProductSummary;

const CATALOGUE = [
  prod('1', 'Extra Virgin Olive Oil 750ml', 'each', '750 mL'),
  prod('2', 'Light Olive Oil 1L'),
  prod('3', 'Brown Onions 1kg', 'pack', '1 kg'),
  prod('4', 'Red Onions 500g'),
  prod('5', 'Crushed Tomatoes 400g'),
  prod('6', 'Diced Tomatoes 400g'),
  prod('7', 'Cherry Tomatoes 250g'),
  prod('8', 'Beef Mince 500g'),
  prod('9', 'Plain Flour 1kg'),
  prod('10', 'Self Raising Flour 1kg'),
  prod('11', 'Gone Soon Butter 250g'),
];
type Searchable = ProductSummary;

function sources(extra: Partial<MatchSources> = {}): MatchSources {
  const index = buildSearchIndex<Searchable>(CATALOGUE);
  return {
    templates: [],
    purchases: [],
    unitOverrides: {},
    available: async (id) => (id === '11' ? null : (CATALOGUE.find((p) => p.sku === id) ?? null)),
    search: async (q) => searchProducts<Searchable>(index, q).filter((r) => r.item.sku !== '11'),
    ...extra,
  };
}

describe('matchIngredientName', () => {
  it('uses a template product with its qty and unit first', async () => {
    const m = await matchIngredientName(
      'olive oil',
      sources({
        templates: [
          {
            name: 'Weekly',
            type: 'weekly',
            items: [
              {
                product: { productId: '2', name: 'Light Olive Oil 1L' },
                qty: 2,
                unit: 'each',
                note: null,
              },
            ],
          },
        ],
      }),
    );
    expect(m.match).toMatchObject({ productId: '2', source: 'template', qty: 2, unit: 'each' });
    expect(m.alternatives.map((a) => a.productId)).toContain('1');
    expect(m.alternatives.map((a) => a.productId)).not.toContain('2');
  });

  it('uses the usual product from history with its last qty and most-bought unit', async () => {
    const m = await matchIngredientName(
      'brown onion',
      sources({
        purchases: [
          { productId: '3', name: 'Brown Onions 1kg', unit: 'kg', date: '2026-10-01', qty: 1 },
          { productId: '3', name: 'Brown Onions 1kg', unit: 'kg', date: '2026-11-01', qty: 2 },
        ],
      }),
    );
    expect(m.match).toMatchObject({ productId: '3', source: 'history', qty: 2, unit: 'kg' });
  });

  it('returns a confident catalogue match with 1 of the default unit', async () => {
    const m = await matchIngredientName('beef mince', sources());
    expect(m.match).toMatchObject({
      productId: '8',
      source: 'catalogue',
      qty: 1,
      unit: 'each',
      imageUrl: 'https://img/8.jpg',
    });
  });

  it('applies a remembered unit to a catalogue match', async () => {
    const m = await matchIngredientName(
      'beef mince',
      sources({ unitOverrides: { '8': { unit: 'g' } } }),
    );
    expect(m.match).toMatchObject({ productId: '8', unit: 'g', qty: 1 });
  });

  it('leaves an ambiguous catalogue result as text with alternatives', async () => {
    const m = await matchIngredientName('tomatoes', sources());
    expect(m.match).toBeNull();
    expect(m.alternatives.length).toBeGreaterThan(0);
    expect(m.alternatives.length).toBeLessThanOrEqual(3);
  });

  it('does not match when not every word is in the product name', async () => {
    const m = await matchIngredientName('wholegrain mustard', sources());
    expect(m.match).toBeNull();
    expect(m.alternatives).toEqual([]);
  });

  it('offers same-head-noun alternatives when the exact words are missing', async () => {
    const m = await matchIngredientName('chopped tomatoes', sources());
    expect(m.match).toBeNull();
    expect(m.alternatives.map((a) => a.productId)).toEqual(expect.arrayContaining(['5', '6', '7']));
  });

  it('skips unavailable products', async () => {
    const m = await matchIngredientName('butter', sources());
    expect(m.match).toBeNull();
    expect(m.alternatives).toEqual([]);
  });

  it('a tied template tier gives no match but offers the tied products', async () => {
    const m = await matchIngredientName(
      'flour',
      sources({
        templates: [
          {
            name: 'Regulars',
            type: 'regulars',
            items: [
              {
                product: { productId: '9', name: 'Plain Flour 1kg' },
                qty: 1,
                unit: 'each',
                note: null,
              },
              {
                product: { productId: '10', name: 'Self Raising Flour 1kg' },
                qty: 1,
                unit: 'each',
                note: null,
              },
            ],
          },
        ],
      }),
    );
    expect(m.match).toBeNull();
    expect(m.alternatives.map((a) => a.productId).sort()).toEqual(['10', '9']);
  });
});

describe('matchRecipeLines', () => {
  it('parses lines, flags pantry and keeps order', async () => {
    const rows = await matchRecipeLines(
      ['2 tbsp extra virgin olive oil', 'Salt and pepper, to taste', '1 dragon fruit foam'],
      sources(),
    );
    expect(rows.map((r) => r.line)).toEqual([
      '2 tbsp extra virgin olive oil',
      'Salt and pepper, to taste',
      '1 dragon fruit foam',
    ]);
    expect(rows[0]).toMatchObject({ name: 'olive oil', pantry: false });
    expect(rows[1]).toMatchObject({ pantry: true, match: null });
    expect(rows[2]?.match).toBeNull();
  });
});
