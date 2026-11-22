/**
 * Household groups (the shop-mode sections) and the seeded mapping from ALDI AU
 * categories to groups (spec 3.6). Households will be able to edit both the aisle order
 * and the category map (Stage 2); these are the defaults.
 */
import type { SourceCategory } from './product';

export interface Group {
  id: string;
  name: string;
  /** Chip label (docs/ux/search.md). */
  shortName: string;
}

/**
 * Default groups in a typical ALDI AU walk-through order: produce and bakery near the
 * entrance, chilled along the back wall, pantry and household aisles through the middle,
 * freezers and liquor towards the checkouts. `Other` is always last.
 */
export const DEFAULT_GROUPS = [
  { id: 'fruit-veg', name: 'Fruit & Veg', shortName: 'Fruit & Veg' },
  { id: 'bakery', name: 'Bakery', shortName: 'Bakery' },
  { id: 'meat-seafood', name: 'Meat & Seafood', shortName: 'Meat & Seafood' },
  { id: 'deli', name: 'Deli', shortName: 'Deli' },
  { id: 'dairy-eggs', name: 'Dairy & Eggs', shortName: 'Dairy & Eggs' },
  { id: 'pantry', name: 'Pantry', shortName: 'Pantry' },
  { id: 'snacks', name: 'Snacks & Confectionery', shortName: 'Snacks' },
  { id: 'drinks', name: 'Drinks', shortName: 'Drinks' },
  { id: 'health-beauty', name: 'Health & Beauty', shortName: 'Health & Beauty' },
  { id: 'baby', name: 'Baby', shortName: 'Baby' },
  { id: 'household', name: 'Household & Cleaning', shortName: 'Household' },
  { id: 'pet', name: 'Pet', shortName: 'Pet' },
  { id: 'frozen', name: 'Frozen', shortName: 'Frozen' },
  { id: 'liquor', name: 'Liquor', shortName: 'Liquor' },
  { id: 'other', name: 'Other', shortName: 'Other' },
] as const satisfies readonly Group[];

export type DefaultGroupId = (typeof DEFAULT_GROUPS)[number]['id'];

export const OTHER_GROUP_ID: DefaultGroupId = 'other';

/** Default aisle order (group ids). */
export const DEFAULT_AISLE_ORDER: readonly string[] = DEFAULT_GROUPS.map((g) => g.id);

const GROUP_IDS = new Set<string>(DEFAULT_AISLE_ORDER);

export function isDefaultGroupId(value: unknown): value is DefaultGroupId {
  return typeof value === 'string' && GROUP_IDS.has(value);
}

export function groupName(id: string): string {
  return DEFAULT_GROUPS.find((g) => g.id === id)?.name ?? 'Other';
}

// ---------------------------------------------------------------------------------------
// ALDI AU category map (keys from api.aldi.com.au/v2/product-category-tree, Nov 2026).
// Leaf keys win over top-level keys. Promotional trees are skipped so a product's real
// aisle is used; their leaves are mapped only for seasonal items that have no other tree.

/** Promotional / thematic trees: never decide the group on their own top-level key. */
export const ALDI_PROMO_CATEGORY_KEYS: ReadonlySet<string> = new Set([
  '1588161420755355', // Christmas (seasonal; leaves mapped below)
  '1588161425841179', // New Low Price
  '1588161426952145', // Super Savers
  '1588161420755352', // Limited Time Only
  '1588161427774115', // Higher Protein Food and Drink
  '1588161435960214', // The People's Picks
]);

export const ALDI_CATEGORY_GROUPS: Readonly<Record<string, DefaultGroupId>> = {
  // Top level
  '950000000': 'fruit-veg', // Fruits & Vegetables
  '940000000': 'meat-seafood', // Meat & Seafood
  '930000000': 'deli', // Deli & Chilled Meats
  '960000000': 'dairy-eggs', // Dairy, Eggs & Fridge
  '970000000': 'pantry', // Pantry
  '920000000': 'bakery', // Bakery
  '980000000': 'frozen', // Freezer
  '1000000000': 'drinks', // Drinks
  '1040000000': 'health-beauty', // Health & Beauty
  '1030000000': 'baby', // Baby
  '1050000000': 'household', // Cleaning & Household
  '1020000000': 'pet', // Pets
  '1010000000': 'liquor', // Liquor
  '1588161408332087': 'snacks', // Snacks & Confectionery
  '1588161408332092': 'other', // Front of Store (bags, flowers, utility)

  // Pantry leaves that ALDI also lists under Snacks & Confectionery
  '1111111181': 'snacks', // Pantry > Confectionery
  '1111111182': 'snacks', // Pantry > Crackers & Crisp Breads
  '1111111183': 'snacks', // Pantry > Chips, Corn Chips & Other
  '1111111184': 'snacks', // Pantry > Biscuit & Cookies
  '1111111186': 'snacks', // Pantry > Dried Fruits, Nuts & Jerky

  // Christmas leaves (seasonal items often only appear here)
  '1588161425467056': 'pantry', // Baking
  '1588161425467057': 'snacks', // Lollies & Sweets
  '1588161425467058': 'snacks', // Chocolate
  '1588161425467060': 'bakery', // Cakes, Puddings & Pies
  '1588161425467063': 'snacks', // Biscuits & Cookies
  '1588161425467065': 'snacks', // Advent Calendars
  '1588161425467068': 'frozen', // Christmas Freezer
  '1588161425467070': 'other', // Gift Wrapping & Gifting
  '1588161425467071': 'deli', // Ham & Deli
  '1588161425467074': 'other', // Kitchen & Tableware
  '1588161425467076': 'pantry', // Festive Entertaining Food
  '1588161425467077': 'drinks', // Beverages & Drinkware
  '1588161426780086': 'other', // Lighting
  '1588161426780087': 'other', // Decoration & Trees
  '1588161426780088': 'other', // Kids Christmas
  '1588161426780089': 'other', // Collectables
};

/** Fallback by top-level slug, in case ALDI re-keys a category. */
const ALDI_SLUG_GROUPS: Readonly<Record<string, DefaultGroupId>> = {
  'fruits-vegetables': 'fruit-veg',
  'meat-seafood': 'meat-seafood',
  'deli-chilled-meats': 'deli',
  'dairy-eggs-fridge': 'dairy-eggs',
  pantry: 'pantry',
  bakery: 'bakery',
  freezer: 'frozen',
  drinks: 'drinks',
  'health-beauty': 'health-beauty',
  baby: 'baby',
  'cleaning-household': 'household',
  pets: 'pet',
  liquor: 'liquor',
  'snacks-confectionery': 'snacks',
  'front-of-store': 'other',
};

/** Last resort: keyword match on a category name. Order matters. */
const NAME_KEYWORDS: ReadonlyArray<[RegExp, DefaultGroupId]> = [
  [/fruit|veg|produce|salad|herb/i, 'fruit-veg'],
  [/frozen|freezer|ice cream/i, 'frozen'],
  [/meat|seafood|beef|pork|lamb|poultry|chicken|fish/i, 'meat-seafood'],
  [/deli|antipasto|dip/i, 'deli'],
  [/dairy|milk|egg|cheese|yog|butter|fridge/i, 'dairy-eggs'],
  [/bakery|bread|roll|cake/i, 'bakery'],
  [/liquor|wine|beer|spirit|cider/i, 'liquor'],
  [/drink|juice|water|soft drink|coffee|tea/i, 'drinks'],
  [/snack|confection|chocolate|lolly|lollies|chip|biscuit|cookie|\bbars?\b/i, 'snacks'],
  [/baby|nappy|nappies/i, 'baby'],
  [/pet|dog|cat/i, 'pet'],
  [/health|beauty|vitamin|skin|hair|dental|personal care/i, 'health-beauty'],
  [/clean|household|laundry|toilet|kitchen/i, 'household'],
  [/pantry|canned|pasta|rice|sauce|spice|cereal|baking|oil/i, 'pantry'],
];

const ALDI_PROMO_SLUGS: ReadonlySet<string> = new Set([
  'christmas',
  'new-low-price',
  'super-savers',
  'limited-time-only',
  'higher-protein-food-and-drink',
  'the-people-s-picks',
]);

function topSlug(c: SourceCategory): string | undefined {
  return c.slug?.split('/')[0];
}

function isLeaf(c: SourceCategory): boolean {
  return c.slug?.includes('/') ?? false;
}

export function isPromoCategory(c: SourceCategory): boolean {
  const top = topSlug(c);
  return ALDI_PROMO_CATEGORY_KEYS.has(c.key) || (top !== undefined && ALDI_PROMO_SLUGS.has(top));
}

export interface GroupResolution {
  groupId: string;
  /** How it was decided; 'unmapped' means it fell through to Other. */
  via: 'override' | 'leaf' | 'top' | 'slug' | 'keyword' | 'promo' | 'name' | 'unmapped';
}

/**
 * Resolve a product's group from its store categories.
 *
 * Order: household override (by category key) > mapped leaf key > mapped top-level key >
 * top-level slug > category-name keyword > promotional-tree leaf (e.g. Christmas >
 * Chocolate, for seasonal items with no regular aisle) > product-name keyword > Other.
 * Promotional trees (Christmas, New Low Price, ...) never outrank a regular aisle.
 */
export function resolveGroup(
  categories: readonly SourceCategory[],
  overrides?: Readonly<Record<string, string>>,
  productName?: string,
): GroupResolution {
  if (overrides) {
    for (const c of categories) {
      const g = overrides[c.key];
      if (g) return { groupId: g, via: 'override' };
    }
  }
  const regular = categories.filter((c) => !isPromoCategory(c));
  for (const c of regular) {
    const g = ALDI_CATEGORY_GROUPS[c.key];
    if (g && isLeaf(c)) return { groupId: g, via: 'leaf' };
  }
  for (const c of regular) {
    const g = ALDI_CATEGORY_GROUPS[c.key];
    if (g) return { groupId: g, via: 'top' };
  }
  for (const c of regular) {
    const top = topSlug(c);
    const g = top ? ALDI_SLUG_GROUPS[top] : undefined;
    if (g) return { groupId: g, via: 'slug' };
  }
  for (const c of regular) {
    for (const [re, g] of NAME_KEYWORDS) if (re.test(c.name)) return { groupId: g, via: 'keyword' };
  }
  for (const c of categories) {
    const g = ALDI_CATEGORY_GROUPS[c.key];
    if (g && isLeaf(c)) return { groupId: g, via: 'promo' };
  }
  if (productName) {
    for (const [re, g] of NAME_KEYWORDS)
      if (re.test(productName)) return { groupId: g, via: 'name' };
  }
  return { groupId: OTHER_GROUP_ID, via: 'unmapped' };
}
