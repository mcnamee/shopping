import { describe, expect, it } from 'vitest';
import { DEFAULT_AISLE_ORDER } from './groups';
import { guessGroup } from './ingredient-groups';
import {
  groupForShop,
  lineInputId,
  parseEditItemRequest,
  parseItemRef,
  parseUndoRequest,
  purchasesForList,
  type ListItem,
} from './lists';
import {
  isTextLineId,
  normaliseLineText,
  parseLineText,
  textLineId,
  textLineInput,
  textSnapshot,
} from './text-lines';

function textItem(text: string, extra: Partial<ListItem> = {}): ListItem {
  const snap = textSnapshot(normaliseLineText(text), guessGroup(text));
  return {
    id: snap.productId,
    kind: 'text',
    product: snap,
    qty: 1,
    unit: 'each',
    note: 'From Lamb curry',
    version: 1,
    createdAt: '',
    updatedAt: '',
    listId: 'l',
    ticked: false,
    tickedAt: null,
    updatedBy: 'u',
    ...extra,
  };
}

describe('text line ids (D-103)', () => {
  it('is TEXT~ plus 16 hex digits and only changes with the normalised text', () => {
    const id = textLineId('2 cups plain flour');
    expect(id).toMatch(/^TEXT~[0-9a-f]{16}$/);
    expect(isTextLineId(id)).toBe(true);
    expect(textLineId(normaliseLineText('  2 cups   plain\tflour '))).toBe(id);
    expect(textLineId('2 cups Plain flour')).not.toBe(id); // case matters
    expect(textLineId('2 cups plain flour!')).not.toBe(id);
  });

  it('rejects product ids and lookalikes', () => {
    expect(isTextLineId('398691~pack')).toBe(false);
    expect(isTextLineId('TEXT~xyz')).toBe(false);
    expect(isTextLineId('TEXT~0123456789abcdef0')).toBe(false);
    expect(parseItemRef('398691~pack')).toEqual({ unit: 'pack', text: false });
    expect(parseItemRef(textLineId('x'))).toEqual({ unit: 'each', text: true });
    expect(parseItemRef('nope')).toBeNull();
  });

  it('builds a LineInput whose id is the text id and group is guessed', () => {
    const l = textLineInput('  1 bunch   coriander ', { note: 'From Pho' });
    expect(l.kind).toBe('text');
    expect(l.product.name).toBe('1 bunch coriander');
    expect(l.product.groupId).toBe('fruit-veg');
    expect(l.note).toBe('From Pho');
    expect(lineInputId(l)).toBe(textLineId('1 bunch coriander'));
    expect(textLineInput('x', { groupId: 'pet' }).product.groupId).toBe('pet');
    expect(textLineInput('x', { groupId: 'bogus' }).product.groupId).toBe('other');
  });

  it('validates text length and emptiness', () => {
    expect(parseLineText('   ')).toMatchObject({ ok: false, field: 'text' });
    expect(parseLineText('a'.repeat(201))).toMatchObject({ ok: false });
    expect(parseLineText('a'.repeat(200))).toMatchObject({ ok: true });
    expect(parseLineText(5)).toMatchObject({ ok: false });
  });
});

describe('guessGroup (D-106)', () => {
  const cases: Array<[string, string]> = [
    ['2 cups plain flour', 'pantry'],
    ['1 bunch coriander', 'fruit-veg'],
    ['500g chicken thigh fillets', 'meat-seafood'],
    ['400 g beef mince', 'meat-seafood'],
    ['200g salmon', 'meat-seafood'],
    ['1 cup milk', 'dairy-eggs'],
    ['250g butter', 'dairy-eggs'],
    ['1/2 cup grated parmesan', 'dairy-eggs'],
    ['4 eggs', 'eggs'],
    ['2 free range eggs, beaten', 'eggs'],
    ['200g egg noodles', 'pantry'],
    ['1 eggplant', 'fruit-veg'],
    ['400ml coconut milk', 'pantry'],
    ['2 tbsp peanut butter', 'pantry'],
    ['1 litre chicken stock', 'pantry'],
    ['2 tbsp tomato paste', 'pantry'],
    ['1 tin chopped tomatoes', 'fruit-veg'],
    ['1 can crushed tomatoes (canned)', 'pantry'],
    ['1 tsp ground cumin', 'pantry'],
    ['salt and pepper', 'pantry'],
    ['2 tbsp olive oil', 'pantry'],
    ['1 red capsicum', 'fruit-veg'],
    ['2 cloves garlic', 'pantry'], // "cloves" is a spice keyword: documented trade-off
    ['3 large onions', 'fruit-veg'],
    ['1 lemon, juiced', 'fruit-veg'],
    ['1/4 cup lemon juice', 'fruit-veg'],
    ['1 cup orange juice', 'drinks'],
    ['4 bread rolls', 'bakery'],
    ['1 cup breadcrumbs', 'pantry'],
    ['1 cup white wine', 'liquor'],
    ['2 tbsp red wine vinegar', 'pantry'],
    ['100g frozen peas', 'frozen'],
    ['1 scoop vanilla ice cream', 'frozen'],
    ['100g sliced ham', 'deli'],
    ['unusual thing', 'other'],
    ['', 'other'],
  ];
  it.each(cases)('%s -> %s', (text, group) => {
    expect(guessGroup(text)).toBe(group);
  });

  it('always returns a household group id', () => {
    for (const [text] of cases) expect(DEFAULT_AISLE_ORDER).toContain(guessGroup(text));
  });
});

describe('text lines in the shared list rules', () => {
  const aisle = [...DEFAULT_AISLE_ORDER];

  it('shop grouping places them in their group among product lines (G1)', () => {
    const items = [textItem('1 bunch coriander'), textItem('2 cups plain flour')];
    const sections = groupForShop(items, aisle);
    expect(sections.map((s) => s.group.id)).toEqual(['fruit-veg', 'pantry']);
    expect(sections[0]?.items[0]?.product.name).toBe('1 bunch coriander');
    expect(sections[0]).toMatchObject({ ticked: 0, total: 1 });
  });

  it('archive writes no purchase row for ticked text lines (G2)', () => {
    const product: ListItem = {
      ...textItem('x'),
      id: '398691~pack',
      kind: undefined as never,
      product: { ...textSnapshot('Milk', 'dairy-eggs'), productId: '398691', name: 'Milk' },
      unit: 'pack',
      ticked: true,
    };
    delete (product as { kind?: string }).kind;
    const rows = purchasesForList('l', '2026-11-22T03:00:00.000Z', [
      product,
      textItem('2 cups plain flour', { ticked: true }),
    ]);
    expect(rows.map((r) => r.productId)).toEqual(['398691']);
  });

  it('parses text-line edits: text, group, note, tick; never qty or unit', () => {
    const opts = { allowTicked: true, textLine: true };
    expect(parseEditItemRequest({ text: ' new  text ', groupId: 'pet', version: 2 }, opts)).toEqual(
      {
        ok: true,
        value: { text: 'new text', groupId: 'pet', version: 2 },
      },
    );
    expect(parseEditItemRequest({ ticked: true }, opts)).toMatchObject({ ok: true });
    expect(parseEditItemRequest({ qty: 2, version: 1 }, opts)).toMatchObject({
      ok: false,
      field: 'qty',
    });
    expect(parseEditItemRequest({ unit: 'kg', version: 1 }, opts)).toMatchObject({
      ok: false,
      field: 'unit',
    });
    expect(parseEditItemRequest({ text: '', version: 1 }, opts)).toMatchObject({
      ok: false,
      field: 'text',
    });
    expect(parseEditItemRequest({ groupId: 'nope', version: 1 }, opts)).toMatchObject({
      ok: false,
      field: 'groupId',
    });
    expect(parseEditItemRequest({ text: 'x', version: 1 }, { allowTicked: true })).toMatchObject({
      ok: false,
      field: 'text',
    });
    // A content edit needs the version, a tick does not.
    expect(parseEditItemRequest({ text: 'x' }, opts)).toMatchObject({
      ok: false,
      field: 'version',
    });
  });

  it('undo accepts text line ids', () => {
    const id = textLineId('x');
    expect(
      parseUndoRequest({ changes: [{ itemId: id, created: true, addedQty: 1, version: 1 }] }, 50),
    ).toMatchObject({ ok: true });
  });
});
