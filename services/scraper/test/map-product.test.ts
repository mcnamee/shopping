import {
  allowedAlcohol,
  isDefaultGroupId,
  isPromoCategory,
  isUnitType,
  resolveGroup,
} from '@trolley/core';
import { describe, expect, it } from 'vitest';
import type { AldiCategoryNode, AldiProduct } from '../src/aldi-types';
import { displayBrand, imageUrl, mapProduct, type StoreContext } from '../src/map-product';
import { ALL_FIXTURE_PRODUCTS, fixture } from './fake-aldi';

const byName = (name: string): AldiProduct => {
  const p = ALL_FIXTURE_PRODUCTS.find((x) => x.name === name);
  if (!p) throw new Error(`fixture product not found: ${name}`);
  return p;
};

describe('mapProduct (real fixtures)', () => {
  it('maps Light Milk 2L', () => {
    expect(mapProduct(byName('Light Milk 2L'), 'G526')).toEqual({
      sku: '000000000000398691',
      name: 'Light Milk 2L',
      brand: 'Farmdale',
      packSize: '2 L',
      unitType: 'pack',
      price: 339,
      unitPrice: '$1.70 per 1 L',
      imageUrl: expect.stringMatching(
        /^https:\/\/dm\.apac\.cms\.aldi\.cx\/is\/image\/aldiprodapac\/product\/jpg\/scaleWidth\/400\/[0-9a-f-]+\/farmdale-light-milk-2l$/,
      ),
      groupId: 'dairy-eggs',
      groupVia: 'top',
      categories: [
        { key: '960000000', name: 'Dairy, Eggs & Fridge', slug: 'dairy-eggs-fridge' },
        { key: '1111111160', name: 'Milk', slug: 'dairy-eggs-fridge/milk' },
      ],
      storeId: 'G526',
      notAtStore: false,
    });
  });

  it('maps ALDI egg categories to the Eggs group', () => {
    const milk = byName('Light Milk 2L');
    const eggs = {
      ...milk,
      name: 'Free Range Eggs 12 Pack',
      categories: [
        { id: '960000000', name: 'Dairy, Eggs & Fridge', urlSlugText: 'dairy-eggs-fridge' },
        { id: '1111111162', name: 'Eggs', urlSlugText: 'dairy-eggs-fridge/eggs' },
      ],
    } as AldiProduct;
    expect(mapProduct(eggs, 'G526')).toMatchObject({ groupId: 'eggs', groupVia: 'leaf' });
  });

  it('maps loose produce to kg with a per-kg price', () => {
    const m = mapProduct(byName('Cavendish Bananas per kg'), 'G526')!;
    expect(m).toMatchObject({
      unitType: 'kg',
      packSize: 'per kg',
      price: 399,
      unitPrice: '$3.99 per 1 kg',
      groupId: 'fruit-veg',
    });
  });

  it('maps every recorded loose-produce product (weightType 3) end to end to kg (B-005, D-045)', () => {
    const loose = ALL_FIXTURE_PRODUCTS.filter((p) => p.weightType === '3');
    expect(loose.length).toBeGreaterThan(0);
    for (const raw of loose) {
      const m = mapProduct(raw, 'G526')!;
      expect(m.unitType).toBe('kg');
      expect(m.packSize).toBe('per kg');
      expect(m.unitPrice).toMatch(/^\$[\d.]+ per 1 kg$/);
    }
  });

  it('maps random-weight meat packs to pack', () => {
    const meat = fixture<{ data: AldiProduct[] }>('search-meat-casey.json').data.filter(
      (p) => p.weightType === '1',
    );
    expect(meat.length).toBeGreaterThan(0);
    for (const p of meat) {
      const m = mapProduct(p, 'G526')!;
      expect(m.unitType).toBe('pack');
      expect(m.packSize).toMatch(/^approx\. [\d.]+ kg$/);
      expect(m.groupId).toBe('meat-seafood');
    }
  });

  it('maps confectionery in Pantry to Snacks', () => {
    expect(mapProduct(byName('Milk Chocolate Block 200g'), null)!.groupId).toBe('snacks');
  });

  it('maps liquor with no selling size from the name', () => {
    const m = mapProduct(byName('Bordeaux 750ml'), 'G526')!;
    expect(m).toMatchObject({
      unitType: 'pack',
      packSize: '750 mL',
      groupId: 'liquor',
      unitPrice: null,
    });
  });

  it('maps every fixture product to a valid unit type and group', () => {
    const counts: Record<string, number> = {};
    for (const p of ALL_FIXTURE_PRODUCTS) {
      const m = mapProduct(p, 'G526');
      expect(m).not.toBeNull();
      expect(isUnitType(m!.unitType)).toBe(true);
      expect(isDefaultGroupId(m!.groupId)).toBe(true);
      counts[m!.unitType] = (counts[m!.unitType] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(['each', 'kg', 'pack']);
  });

  it('rejects products without a numeric SKU or name', () => {
    expect(mapProduct({ sku: '', name: 'x' }, null)).toBeNull();
    expect(mapProduct({ sku: 'abc#1', name: 'x' }, null)).toBeNull();
    expect(mapProduct({ sku: '123', name: '  ' }, null)).toBeNull();
  });

  it('copes with missing optional fields', () => {
    expect(mapProduct({ sku: '123', name: 'Mystery Item' }, null)).toMatchObject({
      brand: null,
      price: null,
      unitPrice: null,
      imageUrl: null,
      packSize: null,
      unitType: 'each',
      groupId: 'other',
      groupVia: 'unmapped',
      categories: [],
    });
  });
});

describe('imageUrl', () => {
  const tmpl =
    'https://dm.apac.cms.aldi.cx/is/image/aldiprodapac/product/jpg/scaleWidth/{width}/abc/{slug}';
  it('prefers the front-of-pack asset', () => {
    expect(
      imageUrl(
        [
          { url: tmpl.replace('abc', 'back'), assetType: 'NU01' },
          { url: tmpl, assetType: 'FR01' },
        ],
        'my-slug',
      ),
    ).toBe(
      'https://dm.apac.cms.aldi.cx/is/image/aldiprodapac/product/jpg/scaleWidth/400/abc/my-slug',
    );
  });

  it('refuses non-ALDI or non-https hosts and odd slugs', () => {
    expect(imageUrl([{ url: 'http://dm.apac.cms.aldi.cx/x/{width}/{slug}' }], 's')).toBeNull();
    expect(imageUrl([{ url: 'https://evil.example.com/{width}/{slug}' }], 's')).toBeNull();
    expect(imageUrl([{ url: tmpl }], '../../x')).toMatch(/\/product$/);
    expect(imageUrl([], 's')).toBeNull();
  });
});

describe('displayBrand', () => {
  it.each([
    ['FARMDALE', 'Farmdale'],
    ['BELMONT BISCUIT CO.', 'Belmont Biscuit Co.'],
    ['A2 THE A2 MILK COMPANY', 'A2 The A2 Milk Company'],
    ["M&M'S", "M&M'S"],
    ['Already Mixed', 'Already Mixed'],
    ['', null],
    [null, null],
  ])('%s -> %s', (raw, expected) => {
    expect(displayBrand(raw)).toBe(expected);
  });
});

describe('category map vs the real ALDI tree', () => {
  const tree = fixture<{ data: AldiCategoryNode[] }>('category-tree.json').data;

  it('maps every regular top-level and leaf category without falling through', () => {
    const unmapped: string[] = [];
    for (const top of tree) {
      const topCat = { key: top.key, name: top.name, slug: top.urlSlugText };
      if (isPromoCategory(topCat)) continue;
      for (const leaf of [undefined, ...top.children]) {
        const cats = leaf
          ? [topCat, { key: leaf.key, name: leaf.name, slug: leaf.urlSlugText }]
          : [topCat];
        const r = resolveGroup(cats);
        if (r.via === 'unmapped' || r.via === 'keyword')
          unmapped.push(`${top.name} > ${leaf?.name ?? ''}`);
      }
    }
    expect(unmapped).toEqual([]);
  });

  it('maps every Christmas leaf', () => {
    const xmas = tree.find((n) => n.key === '1588161420755355')!;
    for (const leaf of xmas.children) {
      const r = resolveGroup([
        { key: xmas.key, name: xmas.name, slug: xmas.urlSlugText },
        { key: leaf.key, name: leaf.name, slug: leaf.urlSlugText },
      ]);
      expect(r.via, leaf.name).toBe('promo');
    }
  });
});

describe('notAtStore (D-080)', () => {
  // Real Casey liquor product with onSaleDate 2026-12-02 ("On Sale Wed 02 Dec").
  const upcoming = fixture<{ data: AldiProduct[] }>('search-liquor-casey.json').data.find(
    (p) => p.onSaleDate === '2026-12-02',
  )!;
  const everyday = byName('Light Milk 2L');

  it('flags Special Buys whose on-sale date is after today', () => {
    expect(mapProduct(upcoming, 'G526', { today: '2026-11-22' })).toMatchObject({
      notAtStore: true,
      onSaleDate: '2026-12-02',
    });
  });

  it('is on the shelf from the on-sale date', () => {
    expect(mapProduct(upcoming, 'G526', { today: '2026-12-02' })).toMatchObject({
      notAtStore: false,
    });
    expect(mapProduct(upcoming, 'G526', { today: '2026-12-03' })).toMatchObject({
      notAtStore: false,
    });
  });

  it('never flags everyday range, past Special Buys, or when today is unknown', () => {
    const m = mapProduct(everyday, 'G526', { today: '2026-11-22' })!;
    expect(m.notAtStore).toBe(false);
    expect(m).not.toHaveProperty('onSaleDate');
    const past = fixture<{ data: AldiProduct[] }>('search-meat-casey.json').data.find(
      (p) => p.onSaleDate === '2026-11-04',
    )!;
    expect(mapProduct(past, 'G526', { today: '2026-11-22' })).toMatchObject({
      notAtStore: false,
      onSaleDate: '2026-11-04',
    });
    expect(mapProduct(upcoming, 'G526')!.notAtStore).toBe(false);
  });

  it('ignores malformed dates', () => {
    expect(
      mapProduct({ ...upcoming, onSaleDate: 'soon' }, 'G526', { today: '2026-11-22' }),
    ).toMatchObject({
      notAtStore: false,
    });
  });
});

describe('liquor licence (D-080)', () => {
  const casey = {
    today: '2026-11-22',
    alcohol: allowedAlcohol(
      fixture<{ data: { alcoholAvailability: string[] } }>('service-point-casey-by-id.json').data
        .alcoholAvailability,
    ),
  };
  const spirits = fixture<{ data: AldiProduct[] }>('liquor-spirits-casey.json').data;
  const of = (name: string) => spirits.find((p) => p.name === name)!;
  const flagged = (name: string, ctx: StoreContext = casey) =>
    mapProduct(of(name), 'G526', ctx)!.notAtStore;

  it('Casey is licensed for beer and wine only', () => {
    expect([...casey.alcohol].sort()).toEqual(['beer', 'wine']);
  });

  it('flags spirits and spirit-based premixes, by category or by name', () => {
    expect(flagged('Blended Scotch Whisky 700ml')).toBe(true); // Liquor > Spirits
    expect(flagged('Irish Country Cream 700ml')).toBe(true);
    expect(flagged('Jim Beam & Cola 10 Pack 375ml')).toBe(true); // Liquor > Premixed
    expect(flagged('Gin 700ml')).toBe(true); // no categories, age restricted, name says gin
  });

  it('keeps wine, beer, malt-based premixes and anything it cannot classify', () => {
    expect(flagged('The Player Barossa Shiraz 750ml')).toBe(false);
    expect(flagged('Pacific Ale 12x330ml')).toBe(false);
    expect(flagged('Ginger Beer 10x330ml')).toBe(false); // Premixed but beer based
    expect(flagged('Premium Cuvee 750ml')).toBe(false); // ambiguous, no category
    expect(flagged('Lager 6 Pack 375ml')).toBe(false);
  });

  it('flags nothing when the licence is unknown, and everything alcoholic with no licence', () => {
    expect(flagged('Blended Scotch Whisky 700ml', { today: casey.today, alcohol: null })).toBe(
      false,
    );
    expect(flagged('Pacific Ale 12x330ml', { alcohol: allowedAlcohol([]) })).toBe(true);
  });

  it('non-alcohol products are never flagged by licence', () => {
    expect(mapProduct(byName('Light Milk 2L'), 'G526', casey)!.notAtStore).toBe(false);
  });
});
