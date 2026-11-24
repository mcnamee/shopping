/**
 * guessGroup (D-106): which household group a free-text ingredient line probably belongs
 * to, by keyword. Order matters: the first matching rule wins, so specific phrases
 * ("coconut milk", "peanut butter", "chicken stock") sit above the general words they
 * contain ("milk", "butter", "chicken"). No match: Other. The user can change the group on
 * the line.
 */
import { isEggName, OTHER_GROUP_ID } from './groups';

const w = (words: string): RegExp => new RegExp(`\\b(?:${words})\\b`, 'i');

const RULES: ReadonlyArray<readonly [group: string, re: RegExp]> = [
  ['frozen', w('frozen|ice[- ]?cream|gelato|sorbet')],
  // Egg-like names are handled between frozen and the pantry rules (see guessGroup).
  [
    'pantry',
    w(
      [
        'coconut (?:milk|cream)',
        'almond milk|soy milk|oat milk|rice milk|evaporated milk|condensed milk',
        'peanut butter|nut butter|butter beans?|kidney beans|black beans|cannellini beans|borlotti beans|four bean mix',
        '(?:chicken|beef|vegetable|veggie|fish|lamb) (?:stock|broth)',
        'stock (?:cubes?|powder|pot)|stock|broth|bouillon',
        'tomato (?:paste|puree|passata|sauce)|passata',
        'tinned|canned|baked beans',
        '(?:egg|rice|soba|udon|vermicelli) noodles?|noodles?',
        'bread ?crumbs?|panko',
        'cream of \\w+ soup|soup',
        'soy sauce|fish sauce|oyster sauce|hoisin|worcestershire|sriracha|sweet chilli|tabasco',
        'curry (?:paste|powder)|garam masala|five spice',
        'ground (?:cumin|coriander|cinnamon|ginger|paprika|nutmeg|turmeric|pepper|almonds?)',
        '(?:garlic|onion|chilli|chili|ginger|cumin|curry|mustard|onion) powder',
        'dried \\w+|\\w+ flakes|chilli flakes',
        'cumin|paprika|turmeric|cinnamon|nutmeg|oregano|cardamom|saffron|bay leaves|cloves?',
        '(?:black|white|cracked|ground) pepper|salt and pepper|salt|peppercorns?',
        'sugar|flour|cornflour|cornstarch|baking (?:powder|soda)|bicarb(?:onate)?|yeast|gelatine',
        'oil|vinegar|honey|maple syrup|golden syrup|syrup|molasses',
        'rice|pasta|spaghetti|penne|fettuccine|macaroni|lasagne sheets|couscous|quinoa|lentils?|chickpeas?|barley|polenta|semolina|oats|muesli|cereal',
        'mayo(?:nnaise)?|ketchup|mustard|jam|vegemite|tahini|pesto|salsa|chutney|relish|sauce|dressing',
        'nuts?|almonds?|cashews?|walnuts?|pecans?|pine nuts?|sesame|seeds?|sultanas?|raisins?|cocoa|vanilla|essence|food colouring|sprinkles',
      ].join('|'),
    ),
  ],
  [
    'liquor',
    w(
      'wine|beer|lager|vodka|gin|rum|whisky|whiskey|brandy|sherry|prosecco|champagne|cider|liqueur',
    ),
  ],
  [
    'meat-seafood',
    w(
      'chicken|beef|mince|lamb|pork|bacon|sausages?|steaks?|ribs?|drumsticks?|thighs?|veal|duck|turkey|rump|brisket|schnitzel|meatballs?|fish|salmon|barramundi|prawns?|shrimp|tuna|cod|snapper|squid|calamari|mussels?|scallops?|crab|lobster|seafood',
    ),
  ],
  [
    'deli',
    w(
      'ham|salami|prosciutto|pastrami|chorizo|pepperoni|hummus|olives?|antipasto|dips?|cold cuts?|kabana',
    ),
  ],
  [
    'dairy-eggs',
    w(
      'milk|cream|yoghurt|yogurt|butter|cheese|parmesan|mozzarella|cheddar|ricotta|feta|mascarpone|halloumi|cottage|custard|ghee|kefir',
    ),
  ],
  [
    'bakery',
    w(
      'bread|rolls?|wraps?|tortillas?|pita|pitta|naan|buns?|baguette|croissants?|sourdough|flatbread|muffins?|crumpets?|bagels?|focaccia|ciabatta',
    ),
  ],
  [
    'drinks',
    /(?<!lemon |lime )\bjuice\b|\b(?:soft drink|cordial|soda|tea|coffee|water|kombucha|lemonade|cola|sparkling)\b/i,
  ],
  [
    'fruit-veg',
    w(
      [
        'onions?|garlic|ginger|shallots?|leeks?|spring onions?|scallions?|chives?',
        'potatoes?|sweet potatoes?|carrots?|parsnips?|beetroot|pumpkin|butternut|swedes?|turnips?',
        'tomato(?:es)?|capsicum|peppers?|chillies|chillis|chilli|chili|zucchini|courgettes?|eggplants?|aubergines?|cucumbers?|celery|corn|cobs?',
        'lettuce|spinach|kale|rocket|cabbage|broccoli|broccolini|cauliflower|bok choy|silverbeet|asparagus|mushrooms?|beans|green beans|peas|snow peas|sprouts?|salad',
        'avocados?|apples?|bananas?|lemons?|limes?|oranges?|mandarins?|pears?|grapes|berries|strawberr(?:y|ies)|blueberr(?:y|ies)|raspberr(?:y|ies)|mango(?:es)?|pineapple|melon|watermelon|peach(?:es)?|plums?|kiwi ?fruit|cherries|apricots?|figs?|pomegranate|fruit|vegetables?|veg',
        'coriander|cilantro|parsley|basil|mint|thyme|rosemary|sage|dill|oregano leaves|tarragon|lemongrass|herbs?|curry leaves',
      ].join('|'),
    ),
  ],
  [
    'snacks',
    w(
      'chips?|crisps|biscuits?|cookies?|chocolate|lollies|candy|popcorn|crackers?|pretzels?|muesli bars?|snack',
    ),
  ],
  [
    'household',
    w(
      'toilet paper|paper towels?|cling wrap|foil|baking paper|bin liners?|detergent|dishwash\\w*|sponges?|napkins?|tissues?|bleach',
    ),
  ],
  [
    'health-beauty',
    w('shampoo|conditioner|soap|toothpaste|deodorant|sunscreen|vitamins?|panadol|lotion'),
  ],
  ['baby', w('nappies|diapers?|baby (?:food|wipes|formula)|formula')],
  ['pet', w('dog food|cat food|pet food|kitty litter|cat litter')],
];

/**
 * Group id for a free-text line such as "2 cups plain flour" or "1 bunch coriander".
 * Leading quantities and units need no stripping: rules match whole words anywhere.
 */
export function guessGroup(text: string): string {
  const t = text.normalize('NFKC');
  // "egg noodles", "Easter eggs" and "eggplant" are not eggs (isEggName knows).
  const eggs = isEggName(t);
  for (const [group, re] of RULES) {
    if (group === 'pantry' && eggs) return 'eggs';
    if (re.test(t)) return group;
  }
  return eggs ? 'eggs' : OTHER_GROUP_ID;
}
