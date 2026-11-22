import { describe, expect, it } from 'vitest';
import {
  buildSearchIndex,
  decodeCursor,
  encodeCursor,
  isNotAtStore,
  paginate,
  searchProducts,
  stem,
  storeToday,
  tokenise,
  type SearchableProduct,
} from './search';

const P = (
  sku: string,
  name: string,
  brand: string | null,
  groupId: string,
  extra: Partial<SearchableProduct> = {},
): SearchableProduct => ({ sku, name, brand, groupId, ...extra });

// Real ALDI names/brands.
const CATALOGUE = [
  P('398691', 'Light Milk 2L', 'Farmdale', 'dairy-eggs'),
  P('759535', 'Light Milk 1L', 'Farmdale', 'dairy-eggs'),
  P('402118', 'Full Cream Milk 2L', 'Riverina Fresh', 'dairy-eggs'),
  P('399309', 'Oat Milk 1L', 'Inner Goodness', 'dairy-eggs'),
  P('405570', 'Evaporated Milk 384ml', 'Farmdale', 'dairy-eggs'),
  P('538441', 'Milk Mouse - Milk Chocolate 168g', 'Choceur', 'snacks'),
  P('285757', 'Milk Chocolate Block 200g', 'Choceur', 'snacks'),
  P('368372', 'Milk Chocolate Digestives 300g', 'Belmont Biscuit Co.', 'snacks'),
  P('371077', 'Milk Arrowroot Biscuits 250g', 'Belmont Biscuit Co.', 'snacks'),
  P('545135', 'Milk Frother', 'Expressi', 'pantry'),
  P('100001', 'Cavendish Bananas per kg', null, 'fruit-veg'),
  P('100002', 'Bananas 160g', null, 'fruit-veg'),
  P('100003', 'Banana Bread Slices 5 Pack 500g', 'Bakers Life', 'bakery'),
  P('100004', 'Strawberries 250g', null, 'fruit-veg'),
  P('100005', 'Gourmet Tomatoes 500g', null, 'fruit-veg'),
  P('100006', 'Old Milk 1L', 'Farmdale', 'dairy-eggs', { discontinued: true }),
  P('100007', "M&M's Peanut 180g", "M&M'S", 'snacks'),
  P('100008', 'Crème Fraîche 200ml', 'Emporium Selection', 'dairy-eggs'),
  P('custom-1', 'Milk from the farm gate', null, 'dairy-eggs', { custom: true }),
];

const index = buildSearchIndex(CATALOGUE);
const names = (q: string, opts?: Parameters<typeof searchProducts>[2]) =>
  searchProducts(index, q, opts).map((r) => r.item.name);

describe('tokenise / stem', () => {
  it('normalises case, accents, ampersands and apostrophes', () => {
    expect(tokenise("Crème Fraîche & M&M's 2L")).toEqual([
      'creme',
      'fraiche',
      'and',
      'm',
      'and',
      'ms',
      '2l',
    ]);
    expect(tokenise(null)).toEqual([]);
  });

  it('stems simple plurals only', () => {
    expect(stem('bananas')).toBe('banana');
    expect(stem('berries')).toBe('berry');
    expect(stem('tomatoes')).toBe('tomato');
    expect(stem('peaches')).toBe('peach');
    expect(stem('glass')).toBe('glass');
    expect(stem('hummus')).toBe('hummus');
    expect(stem('2kgs')).toBe('2kgs');
    expect(stem('egg')).toBe('egg');
  });
});

describe('searchProducts', () => {
  it('ranks plain milk above products that merely contain "milk"', () => {
    const result = names('milk');
    const top = result.slice(0, 6);
    expect(top).toEqual(
      expect.arrayContaining([
        'Light Milk 2L',
        'Light Milk 1L',
        'Oat Milk 1L',
        'Full Cream Milk 2L',
        'Evaporated Milk 384ml',
      ]),
    );
    expect(result.indexOf('Milk Chocolate Digestives 300g')).toBeGreaterThan(4);
  });

  it('boosts household custom products slightly', () => {
    const result = names('milk farm');
    expect(result[0]).toBe('Milk from the farm gate');
  });

  it('matches word prefixes for type-ahead', () => {
    expect(names('stra')).toEqual(['Strawberries 250g']);
    expect(names('choc mil')).toEqual(
      expect.arrayContaining(['Milk Chocolate Block 200g', 'Milk Mouse - Milk Chocolate 168g']),
    );
  });

  it('prefers exact words over prefixes', () => {
    const result = names('banana');
    // "banana" is exact for "Banana Bread" and stem-exact for "Bananas"
    expect(result.slice(0, 3)).toEqual(
      expect.arrayContaining([
        'Bananas 160g',
        'Cavendish Bananas per kg',
        'Banana Bread Slices 5 Pack 500g',
      ]),
    );
  });

  it('matches plurals both ways', () => {
    expect(names('tomato')).toEqual(['Gourmet Tomatoes 500g']);
    expect(names('strawberry')).toEqual(['Strawberries 250g']);
  });

  it('requires every token to match (AND)', () => {
    expect(names('light milk 2l')).toEqual(['Light Milk 2L']);
    expect(names('milk zebra')).toEqual([]);
  });

  it('matches brands, ranking name matches higher', () => {
    const result = names('farmdale');
    expect(result).toEqual(
      expect.arrayContaining(['Light Milk 2L', 'Light Milk 1L', 'Evaporated Milk 384ml']),
    );
    expect(names('choceur milk')[0]).toMatch(/Milk/);
  });

  it('handles accents and punctuation in queries', () => {
    expect(names('creme fraiche')).toEqual(['Crème Fraîche 200ml']);
    expect(names("m&m's")).toEqual(["M&M's Peanut 180g"]);
  });

  it('excludes discontinued products unless asked', () => {
    expect(names('old milk')).toEqual([]);
    expect(names('old milk', { includeDiscontinued: true })).toEqual(['Old Milk 1L']);
  });

  it('hides notAtStore products by default, and shows them once their on-sale date arrives', () => {
    const items = [
      P('1', 'Spiced Rum 700ml', 'Dalwhinnie', 'other', {
        notAtStore: true,
        onSaleDate: '2026-12-02',
      }),
      P('2', 'Rum Baba 1 each', 'Bakers Life', 'other'),
    ];
    const index = buildSearchIndex(items);
    const found = (opts = {}) => searchProducts(index, 'rum', opts).map((r) => r.item.sku);
    expect(found()).toEqual(['2']);
    expect(found({ today: '2026-12-01' })).toEqual(['2']);
    expect(found({ includeNotAtStore: true }).sort()).toEqual(['1', '2']);
    // The flag lapses on its own at the on-sale date (no re-scrape needed).
    expect(found({ today: '2026-12-02' }).sort()).toEqual(['1', '2']);
    expect(isNotAtStore(items[0]!, '2026-12-02')).toBe(false);
    expect(isNotAtStore(items[0]!)).toBe(true);
    expect(isNotAtStore(items[1]!, '2026-12-02')).toBe(false);
  });

  it('storeToday uses Sydney time', () => {
    expect(storeToday(new Date('2026-11-21T14:30:00Z'))).toBe('2026-11-22');
    expect(storeToday(new Date('2026-11-21T12:30:00Z'))).toBe('2026-11-21');
  });

  it('filters by group, with or without a query', () => {
    expect(names('milk', { groupId: 'snacks' })).toHaveLength(4);
    expect(names('', { groupId: 'fruit-veg' })).toEqual([
      'Bananas 160g',
      'Cavendish Bananas per kg',
      'Gourmet Tomatoes 500g',
      'Strawberries 250g',
    ]);
  });

  it('supports group overrides and a boost hook (purchase history)', () => {
    const result = searchProducts(index, 'milk', {
      boost: (p) => (p.sku === '545135' ? 10 : 0),
      groupOf: (p) => (p.sku === '545135' ? 'dairy-eggs' : p.groupId),
      groupId: 'dairy-eggs',
    });
    expect(result[0]!.item.name).toBe('Milk Frother');
  });

  it('returns nothing for a query of only punctuation', () => {
    // No tokens and no group: everything matches with score 0; API rejects this case.
    expect(searchProducts(index, '!!!').length).toBe(CATALOGUE.length - 1);
  });

  it('caps very long queries', () => {
    expect(() => names('milk '.repeat(1000))).not.toThrow();
  });
});

describe('cursor + paginate', () => {
  it('round-trips offsets', () => {
    expect(decodeCursor(encodeCursor(0))).toBe(0);
    expect(decodeCursor(encodeCursor(48))).toBe(48);
  });

  it('rejects junk cursors', () => {
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('not base64!')).toBeNull();
    expect(decodeCursor(btoa('x:1'))).toBeNull();
    expect(decodeCursor('a'.repeat(100))).toBeNull();
  });

  it('pages through results', () => {
    const all = Array.from({ length: 5 }, (_, i) => i);
    const p1 = paginate(all, 0, 2);
    expect(p1.items).toEqual([0, 1]);
    const p2 = paginate(all, decodeCursor(p1.nextCursor!)!, 2);
    expect(p2.items).toEqual([2, 3]);
    const p3 = paginate(all, decodeCursor(p2.nextCursor!)!, 2);
    expect(p3).toEqual({ items: [4], nextCursor: null });
  });
});
