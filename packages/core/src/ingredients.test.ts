import { describe, expect, it } from 'vitest';
import { isPantryStaple, parseIngredient, parseIngredients, singularise } from './ingredients';

const name = (line: string) => parseIngredient(line).name;

describe('parseIngredient: core names', () => {
  const cases: Array<[string, string]> = [
    ['2 tbsp olive oil', 'olive oil'],
    ['3 tablespoons extra virgin olive oil', 'olive oil'],
    ['1 brown onion, finely chopped', 'brown onion'],
    ['2 large brown onions, sliced', 'brown onion'],
    ['500g beef mince', 'beef mince'],
    ['500 g minced beef', 'beef mince'],
    ['1kg ground lamb', 'lamb mince'],
    ['1 x 400g can crushed tomatoes', 'crushed tomatoes'],
    ['2 x 400g cans chopped tomatoes', 'chopped tomatoes'],
    ['1 tin diced tomatoes (400g)', 'diced tomatoes'],
    ['6 ripe tomatoes', 'tomato'],
    ['3 cloves garlic, crushed', 'garlic'],
    ['2 garlic cloves, minced', 'garlic'],
    ['1/2 cup plain flour', 'plain flour'],
    ['1½ cups self raising flour', 'self raising flour'],
    ['1 1/2 cups milk', 'milk'],
    ['1-2 tbsp honey', 'honey'],
    ['1 to 2 tsp ground cumin', 'ground cumin'],
    ['2 or 3 carrots, peeled', 'carrot'],
    ['a handful of fresh basil leaves', 'basil leaf'],
    ['a pinch of chilli flakes', 'chilli flake'],
    ['Half a cup of grated parmesan', 'parmesan'],
    ['1 bunch coriander', 'coriander'],
    ['2 slices bread', 'bread'],
    ['40g butter, melted', 'butter'],
    ['Maple syrup, to serve', 'maple syrup'],
    ['1 can (400g) coconut milk', 'coconut milk'],
    ['250g/9oz cream cheese', 'cream cheese'],
    ['2 x 400g cans chickpeas, drained and rinsed', 'chickpeas'],
    ['Juice of 1 lemon', 'lemon'],
    ['finely grated zest of 2 limes', 'lime'],
    ['- 2 eggs', 'egg'],
    ['2 medium potatoes, cut into chunks', 'potato'],
    ['150g feta', 'feta'],
    ['1/2 red onion, sliced', 'red onion'],
    ['300ml thickened cream', 'thickened cream'],
    ['Heinz tomato sauce', 'tomato sauce'],
    ['2 tbsp Kikkoman soy sauce', 'soy sauce'],
    ['1 tsp dried oregano', 'dried oregano'],
    ['2 cinnamon sticks', 'cinnamon'],
    ['4 sprigs thyme', 'thyme'],
    ['3 celery stalks, diced', 'celery'],
    ['400g baby spinach', 'baby spinach'],
    ['Vegemite', 'vegemite'],
    ['1 punnet cherry tomatoes', 'cherry tomato'],
    ['2 tsp sesame oil (optional)', 'sesame oil'],
    ['1 tbsp butter or margarine', 'butter'],
    ['olive oil, for frying', 'olive oil'],
    ['Olive oil spray', 'olive oil spray'],
    ['2 tbsp heaped plain flour', 'plain flour'],
    ['x 400g can coconut cream', 'coconut cream'],
    ['1 cup (250ml) chicken stock', 'chicken stock'],
    ['2 cups basmati rice', 'basmati rice'],
    ['200g rolled oats', 'rolled oats'],
    ['4 chicken breast fillets', 'chicken breast fillet'],
    ['2 cups frozen peas', 'frozen peas'],
  ];
  it.each(cases)('%s -> %s', (line, expected) => {
    expect(name(line)).toBe(expected);
  });

  it('keeps the original line and never returns an empty name', () => {
    expect(parseIngredient('  2 tbsp  ').name).toBe('tbsp');
    expect(parseIngredient('  2 tbsp  ').unsure).toBe(true);
    expect(parseIngredient('  Plain flour ').original).toBe('Plain flour');
  });

  it('does not strip a unit-like word that is the whole ingredient', () => {
    expect(name('2 tins')).toBe('tin');
    expect(name('Pack')).toBe('pack');
  });
});

describe('pantry staples', () => {
  it.each([
    'salt',
    'Salt and pepper, to taste',
    'freshly ground black pepper',
    '1 cup water',
    'Ice cubes',
  ])('%s is probably in the pantry', (line) => {
    expect(parseIngredient(line).pantry).toBe(true);
  });
  it.each([
    'olive oil',
    'red pepper',
    'coconut water',
    'ice cream',
    'salt reduced stock',
    'water chestnuts',
  ])('%s is not', (line) => {
    expect(parseIngredient(line).pantry).toBe(false);
  });
  it('treats cooking spray as pantry but not oil', () => {
    expect(isPantryStaple('cooking oil spray')).toBe(true);
    expect(isPantryStaple('olive oil')).toBe(false);
  });
});

describe('unsure lines (for the AI clean-up)', () => {
  it('flags long, numeric, alternative and empty names', () => {
    expect(parseIngredient('1 packet instant noodles chicken flavour seasoning').unsure).toBe(true);
    expect(parseIngredient('1 tbsp butter or margarine').unsure).toBe(true);
    expect(parseIngredient('2 tbsp').unsure).toBe(true);
  });
  it('does not flag plain ingredients', () => {
    expect(parseIngredient('2 tbsp olive oil').unsure).toBe(false);
    expect(parseIngredient('1 brown onion, chopped').unsure).toBe(false);
  });
});

describe('parseIngredients', () => {
  it('skips blank lines', () => {
    expect(parseIngredients(['1 egg', '  ', 'salt']).map((p) => p.name)).toEqual(['egg', 'salt']);
  });
});

describe('singularise', () => {
  it.each([
    ['onions', 'onion'],
    ['tomatoes', 'tomato'],
    ['berries', 'berry'],
    ['peaches', 'peach'],
    ['limes', 'lime'],
    ['hummus', 'hummus'],
    ['asparagus', 'asparagus'],
    ['oats', 'oats'],
    ['mince', 'mince'],
    ['cress', 'cress'],
  ])('%s -> %s', (a, b) => {
    expect(singularise(a)).toBe(b);
  });
});
