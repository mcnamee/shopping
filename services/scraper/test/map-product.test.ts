import { isDefaultGroupId, isPromoCategory, isUnitType, resolveGroup } from '@trolley/core';
import { describe, expect, it } from 'vitest';
import type { AldiCategoryNode, AldiProduct } from '../src/aldi-types';
import { displayBrand, imageUrl, mapProduct } from '../src/map-product';
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
    });
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
