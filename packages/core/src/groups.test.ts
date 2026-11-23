import { describe, expect, it } from 'vitest';
import {
  ALDI_CATEGORY_GROUPS,
  effectiveGroupId,
  isEggName,
  DEFAULT_AISLE_ORDER,
  DEFAULT_GROUPS,
  groupName,
  isDefaultGroupId,
  isPromoCategory,
  resolveGroup,
} from './groups';
import type { SourceCategory } from './product';

const cat = (key: string, name: string, slug: string): SourceCategory => ({ key, name, slug });

const PANTRY = cat('970000000', 'Pantry', 'pantry');
const CONFECTIONERY = cat('1111111181', 'Confectionery', 'pantry/confectionery');
const TEA = cat('1111111175', 'Tea, Coffee & Hot Chocolate', 'pantry/tea-coffee-hot-chocolate');
const DAIRY = cat('960000000', 'Dairy, Eggs & Fridge', 'dairy-eggs-fridge');
const MILK = cat('1111111160', 'Milk', 'dairy-eggs-fridge/milk');
const CHRISTMAS = cat('1588161420755355', 'Christmas', 'christmas');
const XMAS_CHOC = cat('1588161425467058', 'Chocolate', 'christmas/chocolate');
const XMAS_KITCHEN = cat('1588161425467074', 'Kitchen & Tableware', 'christmas/kitchen-tableware');
const NEW_LOW = cat('1588161425841179', 'New Low Price', 'new-low-price');

describe('DEFAULT_GROUPS', () => {
  it('seeds the 16 groups with unique ids, Other last', () => {
    expect(DEFAULT_GROUPS.map((g) => g.name)).toEqual([
      'Fruit & Veg',
      'Bakery',
      'Meat & Seafood',
      'Deli',
      'Dairy',
      'Eggs',
      'Pantry',
      'Snacks & Confectionery',
      'Drinks',
      'Health & Beauty',
      'Baby',
      'Household & Cleaning',
      'Pet',
      'Frozen',
      'Liquor',
      'Other',
    ]);
    expect(new Set(DEFAULT_AISLE_ORDER).size).toBe(DEFAULT_GROUPS.length);
    expect(DEFAULT_AISLE_ORDER.at(-1)).toBe('other');
  });

  it('every mapped ALDI category points at a real group', () => {
    for (const g of Object.values(ALDI_CATEGORY_GROUPS)) expect(isDefaultGroupId(g)).toBe(true);
  });

  it('puts Eggs right after Dairy by default', () => {
    const i = DEFAULT_AISLE_ORDER.indexOf('dairy-eggs');
    expect(DEFAULT_AISLE_ORDER[i + 1]).toBe('eggs');
  });

  it('maps the ALDI Eggs category to eggs, other dairy to dairy', () => {
    const EGGS = cat('1111111162', 'Eggs', 'dairy-eggs-fridge/eggs');
    expect(resolveGroup([DAIRY, EGGS]).groupId).toBe('eggs');
    expect(resolveGroup([DAIRY, MILK]).groupId).toBe('dairy-eggs');
  });

  it('groupName falls back to Other', () => {
    expect(groupName('dairy-eggs')).toBe('Dairy');
    expect(groupName('nope')).toBe('Other');
  });
});

describe('resolveGroup', () => {
  it('maps a regular top-level + leaf', () => {
    expect(resolveGroup([DAIRY, MILK])).toEqual({ groupId: 'dairy-eggs', via: 'top' });
    expect(resolveGroup([PANTRY, TEA])).toEqual({ groupId: 'pantry', via: 'top' });
  });

  it('lets a mapped leaf win over its top level (Pantry > Confectionery -> Snacks)', () => {
    expect(resolveGroup([PANTRY, CONFECTIONERY])).toEqual({ groupId: 'snacks', via: 'leaf' });
  });

  it('never lets a promotional tree outrank the regular aisle', () => {
    expect(resolveGroup([CHRISTMAS, XMAS_KITCHEN, DAIRY, MILK]).groupId).toBe('dairy-eggs');
    expect(resolveGroup([NEW_LOW, PANTRY, TEA]).groupId).toBe('pantry');
  });

  it('uses promotional leaves for seasonal-only items', () => {
    expect(resolveGroup([CHRISTMAS, XMAS_CHOC])).toEqual({ groupId: 'snacks', via: 'promo' });
    expect(resolveGroup([CHRISTMAS, XMAS_KITCHEN]).groupId).toBe('other');
  });

  it('falls back to the slug when ALDI re-keys a category', () => {
    expect(resolveGroup([cat('999', 'Freezer!', 'freezer')])).toEqual({
      groupId: 'frozen',
      via: 'slug',
    });
  });

  it('falls back to a name keyword, then Other', () => {
    expect(resolveGroup([cat('999', 'Frozen Treats', 'frozen-treats')])).toEqual({
      groupId: 'frozen',
      via: 'keyword',
    });
    expect(resolveGroup([cat('999', 'Garden', 'garden')])).toEqual({
      groupId: 'other',
      via: 'unmapped',
    });
    expect(resolveGroup([CHRISTMAS])).toEqual({ groupId: 'other', via: 'unmapped' });
    expect(resolveGroup([])).toEqual({ groupId: 'other', via: 'unmapped' });
  });

  it('uses the product name for items only in promotional trees', () => {
    const higherProtein = cat(
      '1588161427774115',
      'Higher Protein Food and Drink',
      'higher-protein-food-and-drink',
    );
    expect(resolveGroup([higherProtein], undefined, 'Chocolate Caramel Protein Bar 57g')).toEqual({
      groupId: 'snacks',
      via: 'name',
    });
    expect(resolveGroup([higherProtein], undefined, 'High Protein Lasagne 300g').via).toBe(
      'unmapped',
    );
    // A regular aisle still wins over the name.
    expect(resolveGroup([DAIRY, MILK], undefined, 'Chocolate Milk').groupId).toBe('dairy-eggs');
  });

  it('applies household overrides first', () => {
    expect(resolveGroup([DAIRY, MILK], { '1111111160': 'drinks' })).toEqual({
      groupId: 'drinks',
      via: 'override',
    });
  });

  it('detects promotional categories by key or slug', () => {
    expect(isPromoCategory(CHRISTMAS)).toBe(true);
    expect(isPromoCategory(XMAS_CHOC)).toBe(true);
    expect(isPromoCategory(cat('1', 'x', 'super-savers'))).toBe(true);
    expect(isPromoCategory(MILK)).toBe(false);
  });
});

describe('effectiveGroupId (read-time Eggs split)', () => {
  const g = (name: string, groupId = 'dairy-eggs', categories?: { key: string }[]) =>
    effectiveGroupId({ groupId, name, ...(categories ? { categories } : {}) });

  it('uses the ALDI Eggs category key first', () => {
    expect(
      g('Barn Laid 12 Pack', 'dairy-eggs', [{ key: '960000000' }, { key: '1111111162' }]),
    ).toBe('eggs');
  });

  it('falls back to egg-like names for dairy items', () => {
    expect(g('Free Range Eggs 12 Pack')).toBe('eggs');
    expect(g('Large egg 700g')).toBe('eggs');
    expect(g('Full Cream Milk 2L')).toBe('dairy-eggs');
    expect(g('Full Cream Milk 2L', 'dairy-eggs', [{ key: '1111111160' }])).toBe('dairy-eggs');
  });

  it('does not treat egg-adjacent products as eggs', () => {
    for (const name of [
      'Egg Noodles 500g',
      'Easter Eggs 200g',
      'Eggplant',
      'Egg Nog 1L',
      'Chocolate Eggs',
    ]) {
      expect(g(name)).toBe('dairy-eggs');
    }
  });

  it('leaves non-dairy groups and eggs untouched', () => {
    expect(g('Free Range Eggs', 'pantry')).toBe('pantry');
    expect(g('Free Range Eggs', 'eggs')).toBe('eggs');
    expect(isEggName('6 Eggs')).toBe(true);
  });
});
