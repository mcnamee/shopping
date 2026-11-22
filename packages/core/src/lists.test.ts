import { describe, expect, it } from 'vitest';
import { DEFAULT_AISLE_ORDER } from './groups';
import { keys } from './keys';
import {
  addLine,
  applyUnitOverride,
  canUndoArchive,
  defaultListName,
  groupForShop,
  isDefaultAisleOrder,
  isListComplete,
  isValidEntityId,
  ITEM_QTY_MAX,
  lineIdFor,
  listProgress,
  localDate,
  mergeLines,
  mergeNotes,
  normaliseAisleOrder,
  parseAddItemRequest,
  parseAisleOrderRequest,
  parseCreateListRequest,
  parseCreateTemplateRequest,
  parseEditItemRequest,
  parseEntityName,
  parseItemQuantity,
  parseLineId,
  parseTemplateIdsRequest,
  parseUnitOverrideRequest,
  parseUpdateListRequest,
  parseUpdateTemplateRequest,
  purchaseSortKey,
  purchasesForList,
  QuantityTooLargeError,
  snapshotOf,
  sortActiveLists,
  sortTemplateItems,
  sortTemplates,
  templatePreview,
  UNDO_ARCHIVE_WINDOW_MS,
  weekOfMonday,
  type LineInput,
  type ListItem,
  type ProductSnapshot,
  type TemplateItem,
} from './lists';
import type { UnitType } from './product';

const snap = (productId: string, name: string, groupId = 'pantry'): ProductSnapshot => ({
  productId,
  name,
  brand: null,
  imageUrl: null,
  packSize: null,
  groupId,
  unitType: 'each',
});

const line = (
  productId: string,
  qty: number,
  unit: UnitType = 'each',
  note: string | null = null,
) => ({ product: snap(productId, `P${productId}`), qty, unit, note }) satisfies LineInput;

const item = (
  productId: string,
  name: string,
  groupId: string,
  ticked = false,
  unit: UnitType = 'each',
): ListItem => ({
  id: lineIdFor(productId, unit),
  listId: 'l',
  product: snap(productId, name, groupId),
  qty: 1,
  unit,
  note: null,
  ticked,
  tickedAt: ticked ? '2026-11-22T00:00:00.000Z' : null,
  version: 1,
  createdAt: '',
  updatedAt: '',
  updatedBy: 'u',
});

describe('line ids', () => {
  it('derives a stable id from product and unit, and parses it back', () => {
    expect(lineIdFor('398691', 'pack')).toBe('398691~pack');
    expect(parseLineId('398691~pack')).toEqual({ productId: '398691', unit: 'pack' });
    const custom = 'custom-11111111-2222-3333-4444-555555555555';
    expect(parseLineId(lineIdFor(custom, 'kg'))).toEqual({ productId: custom, unit: 'kg' });
  });

  it('rejects malformed ids', () => {
    for (const bad of ['398691', '~kg', '398691~lb', 'abc~each', '1#2~each', 42, null]) {
      expect(parseLineId(bad)).toBeNull();
    }
  });

  it('validates entity ids as uuids', () => {
    expect(isValidEntityId('0b5d6a1e-1f1a-4c1e-9a43-2f6f8f0a7c11')).toBe(true);
    expect(isValidEntityId('LIST#x')).toBe(false);
    expect(isValidEntityId('')).toBe(false);
  });
});

describe('merge rule (D-046)', () => {
  it('keeps equal notes, joins different ones and ignores blanks', () => {
    expect(mergeNotes(null, null)).toBeNull();
    expect(mergeNotes('ripe', null)).toBe('ripe');
    expect(mergeNotes(null, 'ripe')).toBe('ripe');
    expect(mergeNotes('Ripe', ' ripe ')).toBe('Ripe');
    expect(mergeNotes('ripe', 'green')).toBe('ripe / green');
    expect(mergeNotes('ripe / green', 'green')).toBe('ripe / green');
    expect(mergeNotes('a'.repeat(150), 'b'.repeat(100))).toHaveLength(200);
  });

  it('sums the same product and unit, keeps a different unit separate', () => {
    const now = 't1';
    let items: TemplateItem[] = [];
    const r1 = addLine(items, line('1', 2, 'pack'), now);
    expect(r1.merged).toBe(false);
    items = r1.items;
    const r2 = addLine(items, line('1', 1, 'pack', 'blue top'), 't2');
    expect(r2.merged).toBe(true);
    expect(r2.item).toMatchObject({ qty: 3, note: 'blue top', version: 2, updatedAt: 't2' });
    expect(r2.items).toHaveLength(1);
    const r3 = addLine(r2.items, line('1', 1.5, 'kg'), 't3');
    expect(r3.merged).toBe(false);
    expect(r3.items.map((i) => i.id)).toEqual(['1~pack', '1~kg']);
  });

  it('sums decimals without float artefacts', () => {
    const r1 = addLine([], line('1', 0.1, 'kg'), 't');
    const r2 = addLine(r1.items, line('1', 0.2, 'kg'), 't');
    expect(r2.item.qty).toBe(0.3);
  });

  it('refuses a merge past the unit maximum', () => {
    const r1 = addLine([], line('1', 990), 't');
    expect(() => addLine(r1.items, line('1', 10), 't')).toThrow(QuantityTooLargeError);
  });

  it('merges many template lines, counting combined lines and capping quantities', () => {
    const { lines, combined } = mergeLines([
      line('1', 2),
      line('2', 1, 'kg'),
      line('1', 3, 'each', 'x'),
      line('1', 1, 'pack'),
      line('3', 998),
      line('3', 5),
    ]);
    expect(combined).toBe(2);
    expect(lines.map((l) => [l.product.productId, l.unit, l.qty, l.note])).toEqual([
      ['1', 'each', 5, 'x'],
      ['2', 'kg', 1, null],
      ['1', 'pack', 1, null],
      ['3', 'each', ITEM_QTY_MAX.each, null],
    ]);
  });
});

describe('snapshot (D-047)', () => {
  it('copies the display fields of a product', () => {
    expect(
      snapshotOf({
        sku: '1',
        name: 'Milk',
        brand: 'Farmdale',
        imageUrl: 'https://x/y.jpg',
        packSize: '2 L',
        unitType: 'pack',
        groupId: 'dairy-eggs',
      }),
    ).toEqual({
      productId: '1',
      name: 'Milk',
      brand: 'Farmdale',
      imageUrl: 'https://x/y.jpg',
      packSize: '2 L',
      groupId: 'dairy-eggs',
      unitType: 'pack',
    });
  });
});

describe('validation (A2)', () => {
  it('names: trimmed, 1-60 chars', () => {
    expect(parseEntityName('  Tacos  night ', 'template')).toEqual({
      ok: true,
      value: 'Tacos night',
    });
    expect(parseEntityName('   ', 'list')).toMatchObject({
      ok: false,
      field: 'name',
      message: 'Enter a name for this list.',
    });
    expect(parseEntityName('x'.repeat(61), 'list')).toMatchObject({ ok: false, field: 'name' });
    expect(parseEntityName('x'.repeat(60), 'list').ok).toBe(true);
    expect(parseEntityName(5, 'list').ok).toBe(false);
  });

  it('quantities per unit', () => {
    expect(parseItemQuantity(2, 'each')).toEqual({ ok: true, value: 2 });
    expect(parseItemQuantity(1.5, 'each')).toMatchObject({ ok: false, field: 'qty' });
    expect(parseItemQuantity(0, 'kg')).toMatchObject({ ok: false });
    expect(parseItemQuantity(-1, 'kg')).toMatchObject({ ok: false });
    expect(parseItemQuantity(1.3, 'kg')).toEqual({ ok: true, value: 1.3 });
    expect(parseItemQuantity(0.05, 'kg').ok).toBe(true);
    expect(parseItemQuantity(1.255, 'kg').ok).toBe(false);
    expect(parseItemQuantity(250, 'g').ok).toBe(true);
    expect(parseItemQuantity(1000, 'mL').ok).toBe(true);
    expect(parseItemQuantity(2.5, 'g').ok).toBe(false);
    expect(parseItemQuantity(999, 'pack').ok).toBe(true);
    expect(parseItemQuantity(1000, 'pack').ok).toBe(false);
    expect(parseItemQuantity(999.5, 'L').ok).toBe(false);
    expect(parseItemQuantity('2', 'each').ok).toBe(false);
    expect(parseItemQuantity(Number.NaN, 'each').ok).toBe(false);
  });

  it('add item requests', () => {
    expect(
      parseAddItemRequest({ productId: '398691', qty: 2, unit: 'pack', note: ' blue ' }),
    ).toEqual({
      ok: true,
      value: { productId: '398691', qty: 2, unit: 'pack', note: 'blue' },
    });
    expect(
      parseAddItemRequest({ productId: '398691', qty: 2, unit: 'pack', note: '' }),
    ).toMatchObject({
      value: { note: null },
    });
    expect(parseAddItemRequest({ productId: 'x#1', qty: 1, unit: 'each' })).toMatchObject({
      field: 'productId',
    });
    expect(parseAddItemRequest({ productId: '1', qty: 1, unit: 'lb' })).toMatchObject({
      field: 'unit',
    });
    expect(parseAddItemRequest({ productId: '1', qty: 1.5, unit: 'each' })).toMatchObject({
      field: 'qty',
    });
    expect(
      parseAddItemRequest({ productId: '1', qty: 1, unit: 'each', note: 'n'.repeat(201) }),
    ).toMatchObject({ field: 'note' });
    expect(parseAddItemRequest([]).ok).toBe(false);
    expect(parseAddItemRequest(null).ok).toBe(false);
  });

  it('edit item requests need a version for content changes but not for ticks', () => {
    expect(parseEditItemRequest({ ticked: true }, { allowTicked: true })).toEqual({
      ok: true,
      value: { ticked: true },
    });
    expect(
      parseEditItemRequest({ qty: 2 }, { allowTicked: true, currentUnit: 'each' }),
    ).toMatchObject({
      field: 'version',
    });
    expect(
      parseEditItemRequest({ qty: 2, version: 3 }, { allowTicked: true, currentUnit: 'each' }),
    ).toEqual({ ok: true, value: { qty: 2, version: 3 } });
    expect(
      parseEditItemRequest({ qty: 1.5, version: 3 }, { allowTicked: true, currentUnit: 'each' }),
    ).toMatchObject({ field: 'qty' });
    expect(
      parseEditItemRequest(
        { qty: 1.5, unit: 'kg', version: 1 },
        { allowTicked: true, currentUnit: 'each' },
      ),
    ).toMatchObject({ ok: true, value: { qty: 1.5, unit: 'kg' } });
    expect(parseEditItemRequest({ note: null, version: 1 }, { allowTicked: true })).toEqual({
      ok: true,
      value: { note: null, version: 1 },
    });
    expect(parseEditItemRequest({ ticked: true }, { allowTicked: false })).toMatchObject({
      field: 'ticked',
    });
    expect(parseEditItemRequest({ ticked: 'yes' }, { allowTicked: true })).toMatchObject({
      field: 'ticked',
    });
    expect(parseEditItemRequest({}, { allowTicked: true }).ok).toBe(false);
    expect(parseEditItemRequest({ ticked: true, version: 0 }, { allowTicked: true })).toMatchObject(
      {
        field: 'version',
      },
    );
  });

  it('templates', () => {
    expect(parseCreateTemplateRequest({ name: 'Tacos', type: 'meal' })).toEqual({
      ok: true,
      value: { name: 'Tacos', type: 'meal' },
    });
    expect(parseCreateTemplateRequest({ name: 'Weekly' })).toMatchObject({
      value: { type: 'weekly' },
    });
    expect(parseCreateTemplateRequest({ name: 'x', type: 'daily' })).toMatchObject({
      field: 'type',
    });
    expect(parseUpdateTemplateRequest({ name: 'Tacos' })).toMatchObject({ field: 'version' });
    expect(parseUpdateTemplateRequest({ type: 'meal', version: 2 })).toEqual({
      ok: true,
      value: { type: 'meal', version: 2 },
    });
    expect(parseUpdateTemplateRequest({ version: 2 }).ok).toBe(false);
  });

  it('lists', () => {
    expect(parseCreateListRequest(undefined)).toEqual({
      ok: true,
      value: { name: null, templateIds: [], thisWeek: undefined },
    });
    const id = '0b5d6a1e-1f1a-4c1e-9a43-2f6f8f0a7c11';
    expect(parseCreateListRequest({ name: 'BBQ', templateIds: [id, id], thisWeek: false })).toEqual(
      {
        ok: true,
        value: { name: 'BBQ', templateIds: [id], thisWeek: false },
      },
    );
    expect(parseCreateListRequest({ templateIds: ['nope'] })).toMatchObject({
      field: 'templateIds',
    });
    expect(parseCreateListRequest({ templateIds: Array(21).fill(id) })).toMatchObject({
      field: 'templateIds',
    });
    expect(parseUpdateListRequest({ thisWeek: true })).toEqual({
      ok: true,
      value: { thisWeek: true },
    });
    expect(parseUpdateListRequest({ name: 'x' })).toMatchObject({ field: 'version' });
    expect(parseUpdateListRequest({ name: 'x', version: 1 }).ok).toBe(true);
    expect(parseTemplateIdsRequest({ templateIds: [] })).toMatchObject({ field: 'templateIds' });
  });

  it('aisle order must be a permutation of the 15 groups', () => {
    const order = [...DEFAULT_AISLE_ORDER].reverse();
    expect(parseAisleOrderRequest({ order })).toEqual({ ok: true, value: { order } });
    expect(parseAisleOrderRequest({ order, version: 3 })).toEqual({
      ok: true,
      value: { order, version: 3 },
    });
    expect(parseAisleOrderRequest({ order: order.slice(1) }).ok).toBe(false);
    expect(parseAisleOrderRequest({ order: [...order.slice(1), order[1]] }).ok).toBe(false);
    expect(parseAisleOrderRequest({ order: [...order.slice(1), 'garden'] }).ok).toBe(false);
    expect(parseAisleOrderRequest({ order: 'x' }).ok).toBe(false);
  });

  it('unit override requests', () => {
    expect(parseUnitOverrideRequest({ unit: 'L' })).toEqual({ ok: true, value: 'L' });
    expect(parseUnitOverrideRequest({ unit: 'litre' }).ok).toBe(false);
  });
});

describe('progress and archive rules (D-049)', () => {
  it('counts ticks; empty lists are never complete', () => {
    expect(listProgress([])).toEqual({ ticked: 0, total: 0 });
    expect(isListComplete([])).toBe(false);
    expect(isListComplete([{ ticked: true }, { ticked: false }])).toBe(false);
    expect(isListComplete([{ ticked: true }, { ticked: true }])).toBe(true);
    expect(listProgress([{ ticked: true }, { ticked: false }])).toEqual({ ticked: 1, total: 2 });
  });

  it('allows undo only for an archived list inside the window', () => {
    const completedAt = '2026-11-22T01:00:00.000Z';
    const at = (ms: number) => new Date(Date.parse(completedAt) + ms);
    const list = { status: 'archived' as const, completedAt };
    expect(canUndoArchive(list, at(8000))).toBe(true);
    expect(canUndoArchive(list, at(UNDO_ARCHIVE_WINDOW_MS))).toBe(true);
    expect(canUndoArchive(list, at(UNDO_ARCHIVE_WINDOW_MS + 1))).toBe(false);
    expect(canUndoArchive({ status: 'active', completedAt: null }, at(0))).toBe(false);
  });
});

describe('purchase rows (D-050, D-054)', () => {
  it('writes one row per ticked item with a local-date, list and unit key', () => {
    const items = [
      item('1', 'Milk', 'dairy-eggs', true, 'pack'),
      item('1', 'Milk', 'dairy-eggs', true, 'L'),
      item('2', 'Bread', 'bakery', false),
    ];
    // 14:30 UTC on 21 Nov is 01:30 on 22 Nov in Canberra (AEDT).
    const rows = purchasesForList('list-1', '2026-11-21T14:30:00.000Z', items);
    expect(rows).toHaveLength(2);
    expect(rows.map(purchaseSortKey)).toEqual([
      'PURCHASE#1#2026-11-22#list-1#pack',
      'PURCHASE#1#2026-11-22#list-1#L',
    ]);
    expect(rows[0]).toMatchObject({ qty: 1, unit: 'pack', name: 'Milk', groupId: 'dairy-eggs' });
  });

  it('is deterministic (re-archiving writes the same keys)', () => {
    const items = [item('1', 'Milk', 'dairy-eggs', true)];
    const a = purchasesForList('l', '2026-11-22T00:00:00.000Z', items).map(purchaseSortKey);
    const b = purchasesForList('l', '2026-11-22T00:00:00.000Z', items).map(purchaseSortKey);
    expect(a).toEqual(b);
  });
});

describe('dates', () => {
  it('names lists after the Monday of the week, or the coming Monday at the weekend', () => {
    // Sun 22 Nov 2026, Canberra
    expect(defaultListName(new Date('2026-11-22T03:00:00.000Z'))).toBe('Week of 23 Nov');
    // Sat 21 Nov
    expect(weekOfMonday(new Date('2026-11-21T03:00:00.000Z'))).toBe('2026-11-23');
    // Mon 23 Nov
    expect(weekOfMonday(new Date('2026-11-23T03:00:00.000Z'))).toBe('2026-11-23');
    // Fri 27 Nov
    expect(weekOfMonday(new Date('2026-11-27T03:00:00.000Z'))).toBe('2026-11-23');
    // Late Sunday UTC is already Monday morning in Canberra
    expect(weekOfMonday(new Date('2026-11-29T20:00:00.000Z'))).toBe('2026-11-30');
    // Across a month and year end: Wed 30 Dec 2026 -> Mon 28 Dec; Sat 2 Jan 2027 -> 4 Jan
    expect(defaultListName(new Date('2026-12-30T03:00:00.000Z'))).toBe('Week of 28 Dec');
    expect(defaultListName(new Date('2027-01-02T03:00:00.000Z'))).toBe('Week of 4 Jan');
  });

  it('formats household-local dates', () => {
    expect(localDate('2026-11-21T12:59:00.000Z')).toBe('2026-11-21');
    expect(localDate('2026-11-21T13:00:00.000Z')).toBe('2026-11-22');
  });
});

describe('aisle order and shop grouping (E1, E3, G1)', () => {
  it('normalises stored orders', () => {
    expect(normaliseAisleOrder(undefined)).toEqual(DEFAULT_AISLE_ORDER);
    expect(isDefaultAisleOrder(normaliseAisleOrder([]))).toBe(true);
    // Unknown and duplicate ids drop out; missing groups slot in before Other.
    const custom = normaliseAisleOrder(['frozen', 'other', 'bogus', 'frozen', 'bakery']);
    expect(custom[0]).toBe('frozen');
    expect(custom.slice(-2)).toEqual(['other', 'bakery']);
    expect(custom[1]).toBe('fruit-veg');
    expect(custom).toHaveLength(15);
    expect(new Set(custom).size).toBe(15);
    expect(normaliseAisleOrder(['frozen']).at(-1)).toBe('other');
  });

  it('groups in aisle order, hides empty groups, unticked by name then ticked', () => {
    const items = [
      item('1', 'Bananas', 'fruit-veg', true),
      item('2', 'apples', 'fruit-veg'),
      item('3', 'Carrots', 'fruit-veg'),
      item('4', 'Milk', 'dairy-eggs'),
      item('5', 'Ice cream', 'frozen', true),
      item('6', 'Mystery', 'not-a-group'),
    ];
    const order = ['frozen', ...DEFAULT_AISLE_ORDER.filter((g) => g !== 'frozen')];
    const sections = groupForShop(items, order);
    expect(sections.map((s) => s.group.id)).toEqual(['frozen', 'fruit-veg', 'dairy-eggs', 'other']);
    expect(sections[1]?.items.map((i) => i.product.name)).toEqual(['apples', 'Carrots', 'Bananas']);
    expect(sections[1]).toMatchObject({ ticked: 1, total: 3 });
    expect(sections[0]).toMatchObject({ ticked: 1, total: 1, group: { name: 'Frozen' } });

    const history = groupForShop(items, order, { tickedFirst: true });
    expect(history[1]?.items.map((i) => i.product.name)).toEqual(['Bananas', 'apples', 'Carrots']);
  });

  it('sorts template items by aisle order then name, and previews the first three', () => {
    const items = [
      item('1', 'Milk', 'dairy-eggs'),
      item('2', 'Bread', 'bakery'),
      item('3', 'Apples', 'fruit-veg'),
      item('4', 'Butter', 'dairy-eggs'),
    ];
    expect(sortTemplateItems(items, DEFAULT_AISLE_ORDER).map((i) => i.product.name)).toEqual([
      'Apples',
      'Bread',
      'Butter',
      'Milk',
    ]);
    expect(templatePreview(items, DEFAULT_AISLE_ORDER)).toEqual(['Apples', 'Bread', 'Butter']);
  });

  it('sorts templates weekly first then name, and lists this-week first then newest', () => {
    const t = (id: string, name: string, type: 'weekly' | 'meal') => ({ id, name, type });
    expect(
      sortTemplates([
        t('1', 'Tacos', 'meal'),
        t('2', 'b weekly', 'weekly'),
        t('3', 'A weekly', 'weekly'),
      ]).map((x) => x.id),
    ).toEqual(['3', '2', '1']);
    const l = (id: string, createdAt: string, thisWeek = false) => ({ id, createdAt, thisWeek });
    expect(
      sortActiveLists([l('a', '2026-11-01'), l('b', '2026-11-03'), l('c', '2026-10-01', true)]).map(
        (x) => x.id,
      ),
    ).toEqual(['c', 'b', 'a']);
  });
});

describe('unit overrides (C5)', () => {
  it('applies a household override but keeps the default', () => {
    const p = {
      sku: '1',
      name: 'Milk',
      brand: null,
      imageUrl: null,
      price: null,
      unitPrice: null,
      packSize: '2 L',
      unitType: 'pack' as const,
      groupId: 'dairy-eggs',
      custom: false,
    };
    expect(applyUnitOverride(p, { '1': { unit: 'L' } })).toMatchObject({
      unitType: 'L',
      defaultUnitType: 'pack',
    });
    expect(applyUnitOverride(p, {})).toMatchObject({ unitType: 'pack', defaultUnitType: 'pack' });
    // Idempotent on an already-overridden summary.
    const once = applyUnitOverride(p, { '1': { unit: 'L' } });
    expect(applyUnitOverride(once, {})).toMatchObject({ unitType: 'pack' });
  });
});

describe('Stage 2 keys', () => {
  it('builds list, item, template, settings and GSI2 keys', () => {
    expect(keys.listSk('abc')).toBe('LIST#abc');
    expect(keys.listItemSk('1~kg')).toBe('ITEM#1~kg');
    expect(keys.templateSk('t')).toBe('TEMPLATE#t');
    expect(keys.listsGsi2Pk('home-1', 'archived')).toBe('HH#home-1#LISTS#archived');
    expect(keys.listsGsi2Sk('2026-11-22T00:00:00.000Z', 'abc')).toBe(
      '2026-11-22T00:00:00.000Z#abc',
    );
    expect(() => keys.listItemSk('a#b')).toThrow();
    expect(() => keys.listsGsi2Pk('bad#hh', 'active')).toThrow();
  });
});
