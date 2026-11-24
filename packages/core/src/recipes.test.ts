import { describe, expect, it } from 'vitest';
import {
  filterRecipes,
  ingredientTexts,
  isRecipePhotoKey,
  parseIngredientLines,
  parseMethodBlocks,
  parseRecipeCategories,
  parseRecipeInput,
  parseRecipeToListRequest,
  parseSourceUrl,
  parseUpdateRecipeRequest,
  recipePhotoKey,
  recipeThumbKey,
  RECIPE_LIMITS,
  type RecipeSummary,
} from './recipes';

const HH = 'home-1';
const UUID = '11111111-2222-4333-8444-555555555555';

describe('ingredient parsing (E2)', () => {
  it('splits lines, strips # from headings, drops blanks', () => {
    const text = '# For the curry\n1 onion\n\n  2 cloves garlic  \n##Sauce\n1 cup stock\n#\n';
    expect(parseIngredientLines(text)).toEqual([
      { kind: 'heading', text: 'For the curry' },
      { kind: 'ingredient', text: '1 onion' },
      { kind: 'ingredient', text: '2 cloves garlic' },
      { kind: 'heading', text: 'Sauce' },
      { kind: 'ingredient', text: '1 cup stock' },
    ]);
    expect(ingredientTexts(text)).toEqual(['1 onion', '2 cloves garlic', '1 cup stock']);
  });

  it('handles CRLF and an empty text', () => {
    expect(ingredientTexts('a\r\nb\r\n')).toEqual(['a', 'b']);
    expect(parseIngredientLines('')).toEqual([]);
    expect(parseIngredientLines('   \n \n')).toEqual([]);
  });

  it('parses a Mela-style ingredient block', () => {
    const mela =
      '# Marinade\n2 tbsp soy sauce\n1 tbsp honey\n# Salad\n1 cucumber, sliced\n200g rice noodles';
    const lines = parseIngredientLines(mela);
    expect(lines.filter((l) => l.kind === 'heading').map((l) => l.text)).toEqual([
      'Marinade',
      'Salad',
    ]);
    expect(lines).toHaveLength(6);
  });
});

describe('method parsing (E2)', () => {
  it('numbers paragraphs split on blank lines', () => {
    expect(parseMethodBlocks('Chop the onion.\nFry it.\n\nAdd the stock.')).toEqual([
      { kind: 'step', n: 1, text: 'Chop the onion.\nFry it.' },
      { kind: 'step', n: 2, text: 'Add the stock.' },
    ]);
  });

  it('splits on single newlines when there are no blank lines', () => {
    expect(parseMethodBlocks('Chop.\nFry.\nServe.').map((b) => b.kind)).toEqual([
      'step',
      'step',
      'step',
    ]);
  });

  it('keeps numbering across # headings (headings restart nothing)', () => {
    const blocks = parseMethodBlocks('# Prep\nChop.\n\n# Cook\nFry.\n\nServe.');
    expect(blocks).toEqual([
      { kind: 'heading', text: 'Prep' },
      { kind: 'step', n: 1, text: 'Chop.' },
      { kind: 'heading', text: 'Cook' },
      { kind: 'step', n: 2, text: 'Fry.' },
      { kind: 'step', n: 3, text: 'Serve.' },
    ]);
  });

  it('a heading line inside a paragraph splits it', () => {
    expect(parseMethodBlocks('Mix.\n# Bake\nBake it.\n\nCool.')).toEqual([
      { kind: 'step', n: 1, text: 'Mix.' },
      { kind: 'heading', text: 'Bake' },
      { kind: 'step', n: 2, text: 'Bake it.' },
      { kind: 'step', n: 3, text: 'Cool.' },
    ]);
  });

  it('handles empty text and CRLF', () => {
    expect(parseMethodBlocks('')).toEqual([]);
    expect(parseMethodBlocks('A.\r\n\r\nB.')).toHaveLength(2);
  });
});

describe('recipe validation (B1)', () => {
  const ok = (b: unknown) => {
    const r = parseRecipeInput(b, HH);
    if (!r.ok) throw new Error(`${r.field}: ${r.message}`);
    return r.value;
  };
  const bad = (b: unknown) => {
    const r = parseRecipeInput(b, HH);
    if (r.ok) throw new Error('expected failure');
    return r;
  };

  it('needs a title and defaults the rest', () => {
    expect(bad({})).toMatchObject({ field: 'title' });
    expect(bad({ title: '   ' })).toMatchObject({ field: 'title' });
    expect(ok({ title: '  Lamb   curry ' })).toMatchObject({
      title: 'Lamb curry',
      description: '',
      categories: [],
      ingredients: '',
      sourceUrl: '',
      photoKey: undefined,
      favourite: undefined,
    });
    expect(parseRecipeInput('x', HH)).toMatchObject({ ok: false });
  });

  it.each([
    ['title', 'a'.repeat(RECIPE_LIMITS.title + 1)],
    ['description', 'a'.repeat(RECIPE_LIMITS.description + 1)],
    ['yield', 'a'.repeat(RECIPE_LIMITS.yield + 1)],
    ['prepTime', 'a'.repeat(RECIPE_LIMITS.time + 1)],
    ['cookTime', 'a'.repeat(RECIPE_LIMITS.time + 1)],
    ['totalTime', 'a'.repeat(RECIPE_LIMITS.time + 1)],
    ['ingredients', 'a'.repeat(RECIPE_LIMITS.ingredientChars + 1)],
    ['instructions', 'a'.repeat(RECIPE_LIMITS.instructions + 1)],
    ['notes', 'a'.repeat(RECIPE_LIMITS.notes + 1)],
    ['nutrition', 'a'.repeat(RECIPE_LIMITS.nutrition + 1)],
    ['sourceUrl', `https://example.com/${'a'.repeat(RECIPE_LIMITS.sourceUrl)}`],
  ])('rejects an over-long %s naming the field', (field, value) => {
    expect(bad({ title: 'T', [field]: value })).toMatchObject({ field });
  });

  it('accepts values exactly at the limits', () => {
    ok({
      title: 'a'.repeat(RECIPE_LIMITS.title),
      description: 'a'.repeat(RECIPE_LIMITS.description),
      instructions: 'a'.repeat(RECIPE_LIMITS.instructions),
      notes: 'a'.repeat(RECIPE_LIMITS.notes),
      nutrition: 'a'.repeat(RECIPE_LIMITS.nutrition),
    });
  });

  it('limits ingredient lines to 200 (blank lines do not count)', () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `item ${i}`).join('\n\n');
    ok({ title: 'T', ingredients: lines(200) });
    expect(bad({ title: 'T', ingredients: lines(201) })).toMatchObject({ field: 'ingredients' });
  });

  it('cleans categories: trim, case-insensitive dedupe, <= 10 of <= 30', () => {
    expect(parseRecipeCategories([' Dinner ', 'dinner', 'Curry', ''])).toEqual({
      ok: true,
      value: ['Dinner', 'Curry'],
    });
    expect(parseRecipeCategories(Array.from({ length: 11 }, (_, i) => `c${i}`))).toMatchObject({
      ok: false,
      field: 'categories',
    });
    expect(parseRecipeCategories(['a'.repeat(31)])).toMatchObject({ ok: false });
    expect(parseRecipeCategories('x')).toMatchObject({ ok: false });
  });

  it('accepts only http(s) source URLs', () => {
    expect(parseSourceUrl('https://example.com/r')).toMatchObject({ ok: true });
    expect(parseSourceUrl('http://example.com')).toMatchObject({ ok: true });
    expect(parseSourceUrl('javascript:alert(1)')).toMatchObject({ ok: false, field: 'sourceUrl' });
    expect(parseSourceUrl('ftp://example.com')).toMatchObject({ ok: false });
    expect(parseSourceUrl('not a url')).toMatchObject({ ok: false });
    expect(parseSourceUrl('  ')).toEqual({ ok: true, value: '' });
  });

  it('keeps newlines in long text but strips control characters and CRs', () => {
    expect(ok({ title: 'T', ingredients: 'a\r\nb\u0007c  \n' }).ingredients).toBe('a\nb c');
  });

  it('scopes photo keys to the household', () => {
    const key = recipePhotoKey(HH, UUID);
    expect(key).toBe(`recipes/${HH}/${UUID}.jpg`);
    expect(recipeThumbKey(key)).toBe(`recipes/${HH}/${UUID}-thumb.jpg`);
    expect(isRecipePhotoKey(HH, key)).toBe(true);
    expect(isRecipePhotoKey('home-2', key)).toBe(false);
    expect(isRecipePhotoKey(HH, `recipes/${HH}/../x.jpg`)).toBe(false);
    expect(isRecipePhotoKey(HH, `recipes/${HH}/${UUID}-thumb.jpg`)).toBe(false);
    expect(ok({ title: 'T', photoKey: key }).photoKey).toBe(key);
    expect(ok({ title: 'T', photoKey: null }).photoKey).toBeNull();
    expect(bad({ title: 'T', photoKey: recipePhotoKey('home-2', UUID) })).toMatchObject({
      field: 'photoKey',
    });
  });

  it('PUT needs a version', () => {
    expect(parseUpdateRecipeRequest({ title: 'T' }, HH)).toMatchObject({
      ok: false,
      field: 'version',
    });
    expect(parseUpdateRecipeRequest({ title: 'T', version: 3 }, HH)).toMatchObject({
      ok: true,
      value: { version: 3 },
    });
  });

  it('validates the to-list body', () => {
    expect(parseRecipeToListRequest({ lines: ['a'] })).toEqual({
      ok: true,
      value: { lines: ['a'], listId: null },
    });
    expect(parseRecipeToListRequest({ lines: [] })).toMatchObject({ ok: false });
    expect(parseRecipeToListRequest({ lines: Array(51).fill('a') })).toMatchObject({ ok: false });
    expect(parseRecipeToListRequest({ lines: [1] })).toMatchObject({ ok: false });
    expect(parseRecipeToListRequest({ lines: ['a'], listId: 'x' })).toMatchObject({
      ok: false,
      field: 'listId',
    });
  });
});

describe('filterRecipes (C2)', () => {
  const r = (
    id: string,
    title: string,
    categories: string[],
    favourite = false,
  ): RecipeSummary => ({
    id,
    title,
    categories,
    yield: '',
    totalTime: '',
    thumbUrl: null,
    favourite,
    updatedAt: '',
  });
  const all = [
    r('3', 'Crème brûlée', ['Dessert'], true),
    r('1', 'Lamb curry', ['Dinner', 'Curry']),
    r('2', 'Apple pie', ['Dessert']),
  ];
  it('sorts A-Z and filters by accent-insensitive title, category and favourites', () => {
    expect(filterRecipes(all).map((x) => x.id)).toEqual(['2', '3', '1']);
    expect(filterRecipes(all, { q: 'CREME' }).map((x) => x.id)).toEqual(['3']);
    expect(filterRecipes(all, { category: 'dessert' }).map((x) => x.id)).toEqual(['2', '3']);
    expect(filterRecipes(all, { favourite: true }).map((x) => x.id)).toEqual(['3']);
    expect(filterRecipes(all, { q: 'pie', category: 'Dessert', favourite: true })).toEqual([]);
  });
});
