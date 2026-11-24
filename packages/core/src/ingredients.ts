/**
 * Ingredient line parsing for "smart" recipe-to-list matching (D-115). Pure rules, no AI:
 * "2 tbsp extra virgin olive oil, plus extra" -> "olive oil". The core name is what the
 * product matcher searches for; quantities and units are dropped on purpose (a recipe
 * amount is not a shopping amount, so no tbsp -> pack conversion is attempted).
 */

export interface ParsedIngredient {
  /** The line as written (trimmed). */
  original: string;
  /** Core ingredient name, lower case, e.g. "olive oil", "brown onion", "crushed tomatoes". */
  name: string;
  /** Salt, pepper, water and the like: most households have it, so untick by default. */
  pantry: boolean;
  /** The rules are not confident in `name`: a candidate for the optional AI clean-up. */
  unsure: boolean;
}

const UNICODE_FRACTIONS: Record<string, string> = {
  '½': ' 1/2 ',
  '¼': ' 1/4 ',
  '¾': ' 3/4 ',
  '⅓': ' 1/3 ',
  '⅔': ' 2/3 ',
  '⅛': ' 1/8 ',
};

/** Units and containers that follow a quantity ("2 tbsp", "1 x 400g can", "3 cloves"). */
const UNITS = new Set([
  'tsp',
  'tsps',
  'teaspoon',
  'teaspoons',
  'tbsp',
  'tbsps',
  'tbs',
  'tblsp',
  'tablespoon',
  'tablespoons',
  'cup',
  'cups',
  'g',
  'gm',
  'gms',
  'gram',
  'grams',
  'kg',
  'kgs',
  'kilo',
  'kilos',
  'kilogram',
  'kilograms',
  'ml',
  'mls',
  'millilitre',
  'millilitres',
  'l',
  'litre',
  'litres',
  'liter',
  'liters',
  'oz',
  'ounce',
  'ounces',
  'lb',
  'lbs',
  'pound',
  'pounds',
  'clove',
  'cloves',
  'can',
  'cans',
  'tin',
  'tins',
  'jar',
  'jars',
  'packet',
  'packets',
  'pack',
  'packs',
  'punnet',
  'punnets',
  'bunch',
  'bunches',
  'pinch',
  'pinches',
  'handful',
  'handfuls',
  'dash',
  'dashes',
  'splash',
  'splashes',
  'sprig',
  'sprigs',
  'knob',
  'sheet',
  'sheets',
  'slice',
  'slices',
  'rasher',
  'rashers',
  'piece',
  'pieces',
  'head',
  'heads',
  'stalk',
  'stalks',
  'bottle',
  'bottles',
  'stick',
  'sticks',
  'bag',
  'bags',
  'box',
  'boxes',
  'block',
  'blocks',
  'tub',
  'tubs',
]);

/** Size and measure words that sit between the quantity and the name. */
const SIZE_WORDS = new Set([
  'large',
  'medium',
  'small',
  'big',
  'heaped',
  'heaping',
  'level',
  'generous',
  'good',
  'thick',
  'thin',
  'rounded',
  'scant',
  'about',
  'approx',
  'approximately',
  'roughly',
  'around',
  'extra-large',
]);

/** Leading words that stand for a quantity ("a handful of basil", "half a cup"). */
const NUMBER_WORDS = new Set([
  'a',
  'an',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'half',
  'quarter',
  'couple',
]);

const FILLER = new Set(['of', 'x', '×', 'the']);

/** Common Australian grocery brands: dropped so the generic product can be matched. */
const BRANDS = new Set([
  'aldi',
  'coles',
  'woolworths',
  'heinz',
  'masterfoods',
  'barilla',
  'bega',
  'philadelphia',
  'mccain',
  'maggi',
  'continental',
  'praise',
  'kikkoman',
  'edgell',
  'rosella',
  '4n20',
  'sacla',
  'cadbury',
  'arnott',
  'arnotts',
  'pauls',
  'dairy farmers',
  'devondale',
  'mainland',
  'lurpak',
  'queen',
  'bertolli',
  'moro',
  'cobram',
  'saxa',
  'cerebos',
  'robins',
  'ardmona',
  'sunrice',
  'tilda',
  'mission',
  'old el paso',
]);

/** Dropped anywhere in the name: how it is prepared, not what it is. */
const PREP_WORDS = new Set([
  'fresh',
  'freshly',
  'finely',
  'roughly',
  'coarsely',
  'thinly',
  'thickly',
  'chopped',
  'diced',
  'sliced',
  'grated',
  'crushed',
  'peeled',
  'shredded',
  'halved',
  'quartered',
  'trimmed',
  'drained',
  'rinsed',
  'melted',
  'softened',
  'beaten',
  'cooled',
  'thawed',
  'washed',
  'deseeded',
  'seeded',
  'tinned',
  'canned',
  'organic',
  'ripe',
  'virgin',
  'extra',
  'wedged',
  'torn',
  'cubed',
  'julienned',
  'packed',
  'lightly',
  'minced',
]);

/** Count nouns that trail the real name ("2 garlic cloves", "3 thyme sprigs"). */
const TRAILING_COUNT_NOUNS = new Set(['clove', 'cloves', 'sprig', 'sprigs', 'stalk', 'stalks']);
const TRAILING_COUNT_NOUNS_LATE = new Set(['stick', 'sticks']);

/** Prep words that are part of the product name when the ingredient is tinned tomatoes. */
const TOMATO_FORMS = new Set(['crushed', 'diced', 'chopped', 'peeled']);

/** Phrases after the name that never belong to it. */
const TRAILING_PHRASE_RE =
  /\b(?:to (?:taste|serve|garnish|drizzle|brush|grease|fry|dust|dress)|for (?:serving|frying|greasing|brushing|dusting|garnish|garnishing|drizzling|the pan|dipping|cooking|sprinkling)|as needed|if needed|optional|or more|or less|plus (?:extra|more)[\w\s]*|per serve)\s*$/i;

const MEAT_FOR_MINCE = new Set(['beef', 'pork', 'lamb', 'chicken', 'turkey', 'veal']);

const SINGULAR_EXCEPTIONS = new Set([
  'oats',
  'greens',
  'molasses',
  'hummus',
  'asparagus',
  'couscous',
  'fries',
  'cookies',
  'brownies',
  'smoothies',
  'veggies',
  'swiss',
  'citrus',
  'lemongrass',
  'watercress',
  'cress',
  'chips',
  'wedges',
  'noodles',
  'peas',
  'lentils',
  'chickpeas',
  'sultanas',
  'raisins',
  'prawns',
  'anchovies',
]);

/** Words that make up a "probably have it" pantry line (D-115). */
const PANTRY_WORDS = new Set([
  'salt',
  'pepper',
  'water',
  'ice',
  'cube',
  'cubes',
  'and',
  'sea',
  'flaked',
  'table',
  'black',
  'white',
  'cracked',
  'ground',
  'tap',
  'cold',
  'warm',
  'hot',
  'boiling',
  'iced',
  'cooking',
  'oil',
  'spray',
  'olive',
  'extra',
  'freshly',
]);
const PANTRY_CORE = new Set(['salt', 'pepper', 'water', 'ice', 'spray']);

/** True for lines like "salt", "freshly ground black pepper", "salt and pepper", "water". */
export function isPantryStaple(name: string): boolean {
  const words = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > 6) return false;
  if (!words.every((w) => PANTRY_WORDS.has(w))) return false;
  if (!words.some((w) => PANTRY_CORE.has(w))) return false;
  // Oil is only a pantry line as a spray ("cooking oil spray"), not "olive oil".
  if (words.includes('oil') && !words.includes('spray')) return false;
  return true;
}

/** Simple singular of the last word ("onions" -> "onion", "berries" -> "berry"). */
export function singularise(word: string): string {
  if (word.length < 4 || SINGULAR_EXCEPTIONS.has(word)) return word;
  if (word.endsWith('leaves')) return `${word.slice(0, -6)}leaf`;
  if (word.endsWith('loaves')) return `${word.slice(0, -6)}loaf`;
  if (/(?:rr|[^aeiou]l|[^aeiou]n|[^aeiou]t)ies$/.test(word) && word.length > 5) {
    return `${word.slice(0, -3)}y`;
  }
  if (/(?:ch|sh|ss|x|z|o)es$/.test(word) && !/(?:shoes|canoes)$/.test(word)) {
    return word.slice(0, -2);
  }
  if (/(?:ss|us|is)$/.test(word)) return word;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** Matches "400", "1/2", "1.5", "1-2", "500g", "2x400g", "250g/9oz" (units checked below). */
const QTY_TOKEN_RE = /^(\d[\d.,/]*(?:-\d[\d.,/]*)?)([a-z]*)(?:\/\d[\d.,/]*[a-z]*)?$/;
const MULTI_TOKEN_RE = /^\d+x\d[\d.]*[a-z]*$/;

function isQtyToken(tok: string): boolean {
  if (MULTI_TOKEN_RE.test(tok)) return true;
  const m = QTY_TOKEN_RE.exec(tok);
  if (!m) return false;
  const unit = m[2] ?? '';
  return unit === '' || UNITS.has(unit);
}

function normalise(line: string): string {
  let s = line.replace(/[½¼¾⅓⅔⅛]/g, (c) => UNICODE_FRACTIONS[c] ?? c);
  s = s
    .normalize('NFKC')
    .replace(/\u2044/g, '/')
    .toLowerCase();
  // "juice of 1 lemon" / "finely grated zest of 2 limes" name the fruit.
  s = s.replace(
    /^(?:(?:finely|freshly) )?(?:(?:grated|squeezed) )?(?:juice|zest|rind)(?: and (?:juice|zest|rind))? of\s+/,
    '',
  );
  // "1½" -> "1 1/2" (the fraction replacement already spaced it); list bullets.
  s = s.replace(/^[\s\-*•·–—]+/, '');
  // Bracketed notes anywhere: "(optional)", "(about 400g)", "[to serve]".
  s = s.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  s = s.replace(/\([^)]*$/, ' ');
  // Prep notes and extras after the first comma, semicolon or spaced dash.
  s = s.replace(/[,;].*$/, '');
  s = s.replace(/\s[-–—]\s.*$/, '');
  // Ranges: "1 to 2", "1 or 2", "1 – 2" -> "1-2".
  s = s.replace(/(\d)\s*(?:to|or|-|–|—)\s*(\d)/g, '$1-$2');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Everything the rules could not simplify: signals the AI pass may help. */
function isUnsure(original: string, name: string, words: string[]): boolean {
  if (!name) return true;
  if (words.length >= 4) return true;
  if (/\d/.test(name)) return true;
  if (/\b(?:such as|plus|or|and\/or|like|substitute|e\.g\.?)\b/i.test(original)) return true;
  if (words.length === 1 && ((words[0] as string).length <= 2 || UNITS.has(words[0] as string))) {
    return true;
  }
  return false;
}

/** Core ingredient name of one recipe line (headings are not passed in). */
export function parseIngredient(line: string): ParsedIngredient {
  const original = line.trim();
  const s = normalise(original);
  let tokens = s.split(' ').filter(Boolean);

  // Leading quantities, units, size words and filler, in any order and repetition.
  let i = 0;
  let guard = 0;
  while (i < tokens.length - 1 && guard++ < 24) {
    const t = tokens[i] as string;
    const stripNumberWord = NUMBER_WORDS.has(t) && (i === 0 || isQtyLike(tokens[i - 1] as string));
    if (isQtyToken(t) || UNITS.has(t) || SIZE_WORDS.has(t) || FILLER.has(t) || stripNumberWord) {
      i += 1;
      continue;
    }
    break;
  }
  tokens = tokens.slice(i);

  // "x 400g can" leftovers and trailing phrases such as "to taste".
  let name = tokens.join(' ');
  for (let k = 0; k < 3; k++) {
    const next = name.replace(TRAILING_PHRASE_RE, '').trim();
    if (next === name) break;
    name = next;
  }
  name = name.replace(/[.:!?]+$/, '').trim();

  // "butter or margarine": the first choice.
  let alternative = false;
  const orAt = name.search(/\s(?:or|and\/or)\s/);
  if (orAt > 0) {
    name = name.slice(0, orAt);
    alternative = true;
  }

  let words = name.split(/\s+/).filter(Boolean);
  const hasTomato = words.some((w) => w === 'tomato' || w === 'tomatoes');

  // Brand words (single and two-word brands).
  const joined = ` ${words.join(' ')} `;
  let debranded = joined;
  for (const b of BRANDS) {
    if (b.includes(' ')) debranded = debranded.replace(` ${b} `, ' ');
  }
  words = debranded.split(/\s+/).filter((w) => w && !BRANDS.has(w));

  // Ground / minced meats are "<meat> mince" in Australia.
  const meatAt = words.findIndex(
    (w, k) => (w === 'minced' || w === 'ground') && MEAT_FOR_MINCE.has(words[k + 1] ?? ''),
  );
  if (meatAt !== -1) {
    const meat = words[meatAt + 1] as string;
    words.splice(meatAt, 2, meat, 'mince');
  }

  // Prep words; tinned tomatoes keep crushed/diced/chopped/peeled (they name the product).
  words = words.filter((w, k) => {
    if (TOMATO_FORMS.has(w) && hasTomato) return true;
    if (w === 'ground') return words[k + 1] !== 'pepper';
    return !PREP_WORDS.has(w);
  });
  // Trailing count nouns: "garlic cloves" -> "garlic", "cinnamon sticks" -> "cinnamon".
  while (words.length > 1) {
    const last = words[words.length - 1] as string;
    if (TRAILING_COUNT_NOUNS.has(last) || TRAILING_COUNT_NOUNS_LATE.has(last)) words.pop();
    else break;
  }
  while (words.length > 1 && FILLER.has(words[words.length - 1] as string)) words.pop();

  // Singular last word, except tinned tomatoes ("crushed tomatoes").
  if (words.length > 0) {
    const last = words[words.length - 1] as string;
    const tinned = last === 'tomatoes' && words.some((w) => TOMATO_FORMS.has(w));
    if (!tinned) words[words.length - 1] = singularise(last);
  }

  const result = words
    .join(' ')
    .replace(/[^\p{L}\p{N}' &-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const finalName = result || original.toLowerCase();
  const unsure = isUnsure(original, result, words) || alternative;
  return {
    original,
    name: finalName,
    pantry: isPantryStaple(finalName),
    unsure: result === '' ? true : unsure,
  };
}

function isQtyLike(tok: string): boolean {
  return isQtyToken(tok) || UNITS.has(tok) || SIZE_WORDS.has(tok) || NUMBER_WORDS.has(tok);
}

/** Parse every ingredient line of a recipe (blank lines skipped). */
export function parseIngredients(lines: readonly string[]): ParsedIngredient[] {
  return lines.filter((l) => l.trim() !== '').map(parseIngredient);
}
