/**
 * Stage 2 mock API (templates, lists, history, "this week", settings) for VITE_MOCK_AUTH.
 * Mirrors services/api/src/stage2.ts using the same @trolley/core rules (merge, snapshot,
 * validation, archive/undo, purchase rows, sorting), so the UI behaves as against prod.
 *
 * State is per household and persisted to localStorage (key MOCK_STATE_KEY) on every
 * change and re-read on every request, so a reload keeps it and two pages of one browser
 * context share it (the two-phone sync E2E). Each household is seeded on first use with a
 * "this week" list (21 items across groups, 6 ticked), two templates (weekly + meal) and six
 * archived lists in History (enough purchase history for Stage 3 suggestions: weekly items
 * plus periodic ones such as razor cartridges every ~4 weeks).
 *
 * Stage 3 (D-059, D-074): POST /api/lists/{id}/suggestions and /api/suggestions run the real
 * core engine over the seeded purchase rows and report `source: 'ai'` (deterministic
 * reasons; the mock has no model). Seam: `window.__mockSuggest = { mode }` with mode
 * 'rules' (source rules), 'coldStart' (no history), 'empty' (no history, no templates) or
 * 'limit' (429). POST /api/lists/{id}/items/bulk and /items/undo mirror the API.
 */
import {
  addLine,
  canUndoArchive,
  defaultListName,
  editLine,
  groupsInOrder,
  isDefaultAisleOrder,
  isListComplete,
  isValidEntityId,
  isTextLineId,
  isValidSku,
  ITEM_QTY_MAX,
  localDate,
  LIMITS,
  lineIdFor,
  lineInputId,
  listProgress,
  mergeLines,
  mergeNotes,
  normaliseAisleOrder,
  parseAddItemRequest,
  parseAisleOrderRequest,
  parseCreateListRequest,
  parseCreateTemplateRequest,
  parseEditItemRequest,
  parseItemRef,
  parseTemplateIdsRequest,
  parseUndoRequest,
  parseUnitOverrideRequest,
  parseUpdateListRequest,
  parseUpdateTemplateRequest,
  purchaseSortKey,
  purchasesForList,
  QuantityTooLargeError,
  qtyWithinMax,
  roundQuantity,
  snapshotOf,
  sortActiveLists,
  sortTemplateItems,
  sortTemplates,
  sortUnitOverrides,
  suggestCandidates,
  sumQuantity,
  textLineId,
  textSnapshot,
  templatePreview,
  tooMuchMessage,
  type AisleOrderResponse,
  type BulkAddItemResult,
  type BulkAddItemsResponse,
  type BulkUndoResponse,
  type BulkUndoResult,
  type LineChange,
  type LineInput,
  type ListDetail,
  type ListItem,
  type ListStatus,
  type ListSummary,
  type Parsed,
  type ProductSummary,
  type Suggestion,
  type SuggestionsResponse,
  type PurchaseRecord,
  type Recipe,
  type Template,
  type TemplateItem,
  type TemplateType,
  type UnitOverride,
  type UnitType,
} from '@trolley/core';

// ------------------------------------------------------------------ state

export interface MockList {
  id: string;
  name: string;
  status: ListStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  finishedBy: 'auto' | 'finish' | null;
  itemCount: number | null;
  boughtCount: number | null;
  version: number;
  items: ListItem[];
}

interface MockTemplate {
  id: string;
  name: string;
  type: TemplateType;
  items: TemplateItem[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MockHousehold {
  lists: MockList[];
  templates: MockTemplate[];
  thisWeekId: string | null;
  aisleOrder: string[] | null;
  aisleVersion: number;
  overrides: Record<string, UnitOverride>;
  purchases: Record<string, PurchaseRecord>;
  /** Recipes (Stage 5); missing in state saved before it, seeded on first use. */
  recipes?: Recipe[];
  /** Suggestion runs today (D-066); missing in state saved before Stage 3. */
  suggestRuns?: { day: string; runs: number };
}

interface MockState {
  households: Record<string, MockHousehold>;
}

export const MOCK_STATE_KEY = 'trolley.mock.stage2.v1';

let memory: MockState = { households: {} };

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function load(): MockState {
  try {
    const raw = storage()?.getItem(MOCK_STATE_KEY);
    if (raw) memory = JSON.parse(raw) as MockState;
  } catch {
    // Corrupt or blocked storage: keep the in-memory copy.
  }
  return memory;
}

function save(): void {
  try {
    storage()?.setItem(MOCK_STATE_KEY, JSON.stringify(memory));
  } catch {
    // Storage full or blocked: in-memory only.
  }
}

/** Test helper: forget all Stage 2 mock state (memory and localStorage). */
export function resetMockStage2(): void {
  memory = { households: {} };
  try {
    storage()?.removeItem(MOCK_STATE_KEY);
  } catch {
    // ignore
  }
}

export const nowIso = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

// ------------------------------------------------------------------ responses

export const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export class MockFailure extends Error {
  constructor(public readonly response: Response) {
    super('mock failure');
  }
}

export const notFound = (): never => {
  throw new MockFailure(json(404, { code: 'NOT_FOUND', message: 'Not found' }));
};
export const invalid = (message: string, field?: string): never => {
  throw new MockFailure(json(400, { code: 'VALIDATION', message, ...(field ? { field } : {}) }));
};
export const conflict = (
  reason: 'STALE' | 'LIST_ARCHIVED' | 'NOT_ARCHIVED' | 'LIMIT' | 'UNDO_EXPIRED',
  message: string,
  current?: unknown,
): never => {
  throw new MockFailure(
    json(409, {
      code: 'CONFLICT',
      reason,
      message,
      ...(current !== undefined ? { current } : {}),
    }),
  );
};

export function unwrap<T>(p: Parsed<T>): T {
  return p.ok ? p.value : invalid(p.message, p.field);
}

export const clone = <T>(v: T): T => structuredClone(v);

// ------------------------------------------------------------------ seed data

export type ProductLookup = (householdId: string, sku: string) => ProductSummary | null;

export interface MockProductSource {
  /** Catalogue or the household's custom product, as the API would resolve it. */
  find: ProductLookup;
  /** The household's custom products (one goes on the seeded list). */
  customs: (householdId: string) => ProductSummary[];
}

const SEED_TEMPLATE_WEEKLY = '00000000-0000-4000-8000-0000000000a1';
const SEED_TEMPLATE_TACOS = '00000000-0000-4000-8000-0000000000a2';
const SEED_LIST_THIS_WEEK = '00000000-0000-4000-8000-0000000000b1';
const SEED_LIST_LAST_WEEK = '00000000-0000-4000-8000-0000000000b2';
const SEED_LIST_TWO_WEEKS = '00000000-0000-4000-8000-0000000000b3';
/** Older shops (20, 34, 48 and 62 days ago) for Stage 3 suggestions. */
const SEED_OLDER_LISTS = [
  '00000000-0000-4000-8000-0000000000b4',
  '00000000-0000-4000-8000-0000000000b5',
  '00000000-0000-4000-8000-0000000000b6',
  '00000000-0000-4000-8000-0000000000b7',
];
export const MOCK_SEED_IDS = {
  weeklyTemplate: SEED_TEMPLATE_WEEKLY,
  mealTemplate: SEED_TEMPLATE_TACOS,
  thisWeekList: SEED_LIST_THIS_WEEK,
  /** Newest first: last week, two weeks ago, then the older shops. */
  archivedLists: [SEED_LIST_LAST_WEEK, SEED_LIST_TWO_WEEKS, ...SEED_OLDER_LISTS],
};

const sku = (n: string) => n.padStart(18, '0');
const P = {
  bananas: sku('380234'),
  apples: sku('380086'),
  tomatoes: sku('380084'),
  garlic: sku('380072'),
  rolls: sku('308272'),
  chicken: sku('704838'),
  steak: sku('399496'),
  beef: sku('401302'),
  ham: sku('398557'),
  milk: sku('398689'),
  lightMilk: sku('398948'),
  rice: sku('262325'),
  beans: sku('261610'),
  coffee: sku('294612'),
  bananaChips: sku('719069'),
  appleJuice: sku('365605'),
  tissues: sku('416709'),
  batteries: sku('318200'),
  dogFood: sku('398524'),
  salmon: sku('286737'),
  prawns: sku('332441'),
  // Periodic buys in the older shops (Stage 3 suggestions).
  bigDogFood: sku('398755'),
  kiwifruit: sku('380078'),
  razorCartridges: sku('399547'),
  coffeeCapsules: sku('365851'),
  soap: sku('529279'),
};

/** [productId, qty, unit, note?, ticked?]. */
type SeedLine = [string, number, UnitType, (string | null)?, boolean?];

const THIS_WEEK_LINES: SeedLine[] = [
  [P.bananas, 1.5, 'kg', null, true],
  [P.apples, 1, 'kg'],
  [P.tomatoes, 0.5, 'kg', 'Ripe ones for Tuesday'],
  [P.garlic, 0.1, 'kg'],
  [P.rolls, 1, 'pack', null, true],
  [P.chicken, 2, 'pack'],
  [P.steak, 1, 'pack', 'Thick cut if they have it'],
  [P.ham, 1, 'pack', null, true],
  [P.milk, 2, 'pack', 'Blue top', true],
  [P.lightMilk, 1, 'pack'],
  [P.rice, 1, 'pack'],
  [P.beans, 4, 'pack'],
  [P.coffee, 1, 'pack', null, true],
  [P.bananaChips, 1, 'pack'],
  [P.appleJuice, 2, 'pack'],
  [P.tissues, 1, 'pack'],
  [P.batteries, 1, 'pack', null, true],
  [P.dogFood, 3, 'pack'],
  [P.salmon, 1, 'pack'],
  [P.prawns, 1, 'pack'],
];

const WEEKLY_LINES: SeedLine[] = [
  [P.milk, 2, 'pack', 'Blue top'],
  [P.bananas, 1.5, 'kg'],
  [P.apples, 1, 'kg'],
  [P.rolls, 1, 'pack'],
  [P.rice, 1, 'pack'],
  [P.beans, 4, 'pack'],
  [P.coffee, 1, 'pack'],
  [P.appleJuice, 2, 'pack'],
  [P.tissues, 1, 'pack'],
  [P.salmon, 1, 'pack'],
];

const TACO_LINES: SeedLine[] = [
  [P.beef, 1, 'pack'],
  [P.tomatoes, 0.5, 'kg', 'For salsa'],
  [P.garlic, 0.1, 'kg'],
  [P.milk, 1, 'pack'],
  [P.rice, 1, 'pack'],
];

const LAST_WEEK_LINES: SeedLine[] = [
  [P.milk, 2, 'pack', null, true],
  [P.bananas, 1, 'kg', null, true],
  [P.rolls, 1, 'pack', null, true],
  [P.rice, 1, 'pack', null, true],
  [P.coffee, 1, 'pack', null, true],
  [P.chicken, 1, 'pack', null, true],
  [P.salmon, 1, 'pack', null, false],
  [P.appleJuice, 2, 'pack', null, true],
  [P.tissues, 1, 'pack', null, true],
  [P.dogFood, 2, 'pack', null, true],
  [P.apples, 1, 'kg', null, true],
  [P.prawns, 1, 'pack', null, true],
];

const TWO_WEEKS_LINES: SeedLine[] = [
  [P.milk, 2, 'pack', null, true],
  [P.bananas, 1.25, 'kg', null, true],
  [P.beef, 1, 'pack', null, true],
  [P.tomatoes, 0.5, 'kg', null, true],
  [P.rice, 1, 'pack', null, true],
  [P.beans, 2, 'pack', null, true],
  [P.lightMilk, 1, 'pack', null, true],
  [P.coffee, 1, 'pack', null, true],
];

/**
 * Older shops, all bought. With last week (6 days ago) and two weeks ago (13) this makes
 * suggestions for a new list: the 10 weekly-template items plus three periodic items that
 * are due - big dog food (~2 weeks, 20 days ago), kiwifruit (~2 weeks, 20 days ago) and razor
 * cartridges (~4 weeks, 34 days ago). Coffee capsules and soap are not due yet.
 */
const OLDER_SHOPS: Array<[number, SeedLine[]]> = [
  [
    20,
    [
      [P.milk, 2, 'pack', null, true],
      [P.bigDogFood, 1, 'pack', null, true],
      [P.kiwifruit, 0.5, 'kg', null, true],
      [P.coffeeCapsules, 1, 'pack', null, true],
      [P.soap, 1, 'pack', null, true],
    ],
  ],
  [
    34,
    [
      [P.milk, 2, 'pack', null, true],
      [P.bigDogFood, 1, 'pack', null, true],
      [P.kiwifruit, 0.5, 'kg', null, true],
      [P.razorCartridges, 1, 'pack', null, true],
    ],
  ],
  [
    48,
    [
      [P.bigDogFood, 1, 'pack', null, true],
      [P.kiwifruit, 0.5, 'kg', null, true],
      [P.coffeeCapsules, 1, 'pack', null, true],
    ],
  ],
  [
    62,
    [
      [P.bigDogFood, 1, 'pack', null, true],
      [P.razorCartridges, 1, 'pack', null, true],
      [P.soap, 1, 'pack', null, true],
    ],
  ],
];

function seedHousehold(householdId: string, source: MockProductSource): MockHousehold {
  const find = source.find;
  const now = Date.now();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  const DAY = 24 * 60 * 60 * 1000;

  const lineOf = ([id, qty, unit, note]: SeedLine): LineInput | null => {
    const p = find(householdId, id);
    if (!p) return null;
    return {
      product: snapshotOf({ ...p, unitType: p.defaultUnitType ?? p.unitType }),
      qty,
      unit,
      note: note ?? null,
    };
  };

  const items = (listId: string, lines: SeedLine[], created: string): ListItem[] =>
    lines.flatMap((l) => {
      const input = lineOf(l);
      if (!input) return [];
      const ticked = l[4] === true;
      return [
        {
          id: lineIdFor(input.product.productId, input.unit),
          listId,
          product: input.product,
          qty: input.qty,
          unit: input.unit,
          note: input.note,
          ticked,
          tickedAt: ticked ? created : null,
          version: ticked ? 2 : 1,
          createdAt: created,
          updatedAt: created,
          updatedBy: 'mock',
        },
      ];
    });

  const template = (id: string, name: string, type: TemplateType, lines: SeedLine[]) => {
    let tItems: TemplateItem[] = [];
    for (const l of lines) {
      const input = lineOf(l);
      if (input) tItems = addLine(tItems, input, at(20 * DAY)).items;
    }
    return {
      id,
      name,
      type,
      items: tItems,
      version: 1,
      createdAt: at(20 * DAY),
      updatedAt: at(20 * DAY),
    };
  };

  // Custom product on this week's list (covers the L unit and a null image).
  const juice = source.customs(householdId).find((c) => c.unitType === 'L');
  const thisWeekLines: SeedLine[] = juice
    ? [...THIS_WEEK_LINES, [juice.sku, 2, 'L', 'From the farmers market']]
    : THIS_WEEK_LINES;

  const archived = (
    id: string,
    daysAgo: number,
    lines: SeedLine[],
  ): { list: MockList; purchases: PurchaseRecord[] } => {
    const completedAt = at(daysAgo * DAY);
    const created = at((daysAgo + 2) * DAY);
    const listItems = items(id, lines, created);
    const progress = listProgress(listItems);
    return {
      list: {
        id,
        name: defaultListName(new Date(now - (daysAgo + 1) * DAY)),
        status: 'archived',
        createdAt: created,
        updatedAt: completedAt,
        completedAt,
        finishedBy: progress.ticked === progress.total ? 'auto' : 'finish',
        itemCount: progress.total,
        boughtCount: progress.ticked,
        version: 2,
        items: listItems,
      },
      purchases: purchasesForList(id, completedAt, listItems),
    };
  };

  const lastWeek = archived(SEED_LIST_LAST_WEEK, 6, LAST_WEEK_LINES);
  const twoWeeks = archived(SEED_LIST_TWO_WEEKS, 13, TWO_WEEKS_LINES);
  const older = OLDER_SHOPS.map(([daysAgo, lines], i) =>
    archived(SEED_OLDER_LISTS[i] as string, daysAgo, lines),
  );
  const created = at(DAY);
  const purchases: Record<string, PurchaseRecord> = {};
  for (const a of [lastWeek, twoWeeks, ...older]) {
    for (const p of a.purchases) purchases[purchaseSortKey(p)] = p;
  }

  return {
    lists: [
      {
        id: SEED_LIST_THIS_WEEK,
        name: defaultListName(new Date(now)),
        status: 'active',
        createdAt: created,
        updatedAt: created,
        completedAt: null,
        finishedBy: null,
        itemCount: null,
        boughtCount: null,
        version: 1,
        items: items(SEED_LIST_THIS_WEEK, thisWeekLines, created),
      },
      lastWeek.list,
      twoWeeks.list,
      ...older.map((a) => a.list),
    ],
    templates: [
      template(SEED_TEMPLATE_WEEKLY, 'Weekly basics', 'weekly', WEEKLY_LINES),
      template(SEED_TEMPLATE_TACOS, 'Tacos', 'meal', TACO_LINES),
    ],
    thisWeekId: SEED_LIST_THIS_WEEK,
    aisleOrder: null,
    aisleVersion: 0,
    overrides: {},
    purchases,
  };
}

// ------------------------------------------------------------------ household helpers

let products: MockProductSource = { find: () => null, customs: () => [] };
const productLookup: ProductLookup = (hh, id) => products.find(hh, id);

export function household(householdId: string): MockHousehold {
  const state = load();
  let hh = state.households[householdId];
  if (!hh) {
    hh = seedHousehold(householdId, products);
    state.households[householdId] = hh;
    save();
  }
  return hh;
}

/** Unit overrides as productId -> unit (used by mock search and product detail). */
export function mockUnitOverrides(householdId: string): Record<string, { unit: UnitType }> {
  const out: Record<string, { unit: UnitType }> = {};
  for (const [id, o] of Object.entries(household(householdId).overrides))
    out[id] = { unit: o.unit };
  return out;
}

/** The household's aisle order (used by mock GET /api/groups). */
export function mockAisleOrder(householdId: string): string[] {
  return normaliseAisleOrder(household(householdId).aisleOrder);
}

export function summary(hh: MockHousehold, l: MockList): ListSummary {
  const p =
    l.status === 'archived' && l.itemCount !== null
      ? { total: l.itemCount, ticked: l.boughtCount ?? 0 }
      : listProgress(l.items);
  return {
    id: l.id,
    name: l.name,
    status: l.status,
    thisWeek: l.status === 'active' && hh.thisWeekId === l.id,
    itemCount: p.total,
    tickedCount: p.ticked,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    completedAt: l.completedAt,
    finishedBy: l.finishedBy,
    version: l.version,
  };
}

export const detail = (hh: MockHousehold, l: MockList): ListDetail => ({
  ...summary(hh, l),
  items: clone(l.items),
});

function templateView(hh: MockHousehold, t: MockTemplate): Template {
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    itemCount: t.items.length,
    version: t.version,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    items: clone(sortTemplateItems(t.items, normaliseAisleOrder(hh.aisleOrder))),
  };
}

function findList(hh: MockHousehold, id: string | undefined): MockList {
  if (!isValidEntityId(id)) return notFound();
  return hh.lists.find((l) => l.id === id) ?? notFound();
}

export function activeList(hh: MockHousehold, id: string | undefined): MockList {
  const l = findList(hh, id);
  if (l.status !== 'active') conflict('LIST_ARCHIVED', 'This list is archived and read-only.');
  return l;
}

function findTemplate(hh: MockHousehold, id: string | undefined): MockTemplate {
  if (!isValidEntityId(id)) return notFound();
  return hh.templates.find((t) => t.id === id) ?? notFound();
}

function lineRef(itemId: string | undefined): { id: string; unit: UnitType; text: boolean } {
  const parsed = parseItemRef(itemId);
  return parsed && itemId ? { id: itemId, unit: parsed.unit, text: parsed.text } : notFound();
}

function lineFromBody(householdId: string, body: unknown): LineInput {
  const input = unwrap(parseAddItemRequest(body));
  const p =
    productLookup(householdId, input.productId) ??
    invalid('That product is not in the catalogue', 'productId');
  return {
    product: snapshotOf({ ...p, unitType: p.defaultUnitType ?? p.unitType }),
    qty: input.qty,
    unit: input.unit,
    note: input.note,
  };
}

function templateLines(hh: MockHousehold, ids: string[]): LineInput[] {
  return ids.flatMap((id) => {
    const t = hh.templates.find((x) => x.id === id) ?? invalid('Unknown template', 'templateIds');
    return t.items.map((i) => ({ product: i.product, qty: i.qty, unit: i.unit, note: i.note }));
  });
}

function assertActiveLimit(hh: MockHousehold) {
  if (hh.lists.filter((l) => l.status === 'active').length >= LIMITS.activeLists) {
    conflict(
      'LIMIT',
      `You have ${LIMITS.activeLists} lists on the go, which is the most Trolley allows. Archive or delete one first.`,
    );
  }
}

function newItem(listId: string, l: LineInput, userId: string, at: string): ListItem {
  return {
    id: lineInputId(l),
    ...(l.kind === 'text' ? { kind: 'text' as const } : {}),
    listId,
    product: l.product,
    qty: l.qty,
    unit: l.unit,
    note: l.note,
    ticked: false,
    tickedAt: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
    updatedBy: userId,
  };
}

function flagIfNone(hh: MockHousehold, listId: string) {
  const current = hh.lists.find((l) => l.id === hh.thisWeekId);
  if (!current || current.status !== 'active') hh.thisWeekId = listId;
}

export function createList(
  hh: MockHousehold,
  userId: string,
  input: { name: string; lines: LineInput[]; thisWeek: boolean | undefined },
): MockList {
  assertActiveLimit(hh);
  if (input.lines.length > LIMITS.listItems) {
    conflict(
      'LIMIT',
      `That would put more than ${LIMITS.listItems} items on the list. Choose fewer templates.`,
    );
  }
  const at = nowIso();
  const id = newId();
  const list: MockList = {
    id,
    name: input.name,
    status: 'active',
    createdAt: at,
    updatedAt: at,
    completedAt: null,
    finishedBy: null,
    itemCount: null,
    boughtCount: null,
    version: 1,
    items: input.lines.map((l) => newItem(id, l, userId, at)),
  };
  hh.lists.push(list);
  if (input.thisWeek === true) hh.thisWeekId = id;
  else if (input.thisWeek === undefined) flagIfNone(hh, id);
  return list;
}

/** Merge-add one line (D-046); a merge unticks the row (D-053). */
export function addItem(list: MockList, line: LineInput, userId: string) {
  const id = lineInputId(line);
  const at = nowIso();
  const existing = list.items.find((i) => i.id === id);
  if (!existing) {
    if (list.items.length >= LIMITS.listItems) {
      conflict('LIMIT', `This list is full (${LIMITS.listItems} items). Remove something first.`);
    }
    const item = newItem(list.id, line, userId, at);
    list.items.push(item);
    return { item, merged: false };
  }
  // A text line is always one: merging only joins notes and unticks it (D-103).
  const qty = line.kind === 'text' ? existing.qty : sumQuantity(existing.qty, line.qty, line.unit);
  if (!qtyWithinMax(qty, line.unit)) invalid(tooMuchMessage(line.unit), 'qty');
  Object.assign(existing, {
    qty,
    note: mergeNotes(existing.note, line.note),
    ticked: false,
    tickedAt: null,
    version: existing.version + 1,
    updatedAt: at,
    updatedBy: userId,
  });
  return { item: existing, merged: true };
}

function archive(hh: MockHousehold, list: MockList, mode: 'auto' | 'finish') {
  const at = nowIso();
  const p = listProgress(list.items);
  Object.assign(list, {
    status: 'archived',
    completedAt: at,
    finishedBy: mode,
    itemCount: p.total,
    boughtCount: p.ticked,
    version: list.version + 1,
    updatedAt: at,
  });
  for (const row of purchasesForList(list.id, at, list.items)) {
    hh.purchases[purchaseSortKey(row)] = row;
  }
}

// ------------------------------------------------------------------ Stage 3 suggestions

const SUGGEST_DAILY_LIMIT = 20;
const BULK_ADD_MAX = 50;
const RATE_LIMIT_MESSAGE = "You've used today's suggestions - try again tomorrow.";

type SuggestMode = 'rules' | 'coldStart' | 'empty' | 'limit';

function suggestMode(): SuggestMode | null {
  const seam = (globalThis as { __mockSuggest?: { mode?: SuggestMode } | null }).__mockSuggest;
  return seam?.mode ?? null;
}

function rateLimited(): never {
  throw new MockFailure(json(429, { code: 'RATE_LIMITED', message: RATE_LIMIT_MESSAGE }));
}

/** Same engine as the API; the mock reports source 'ai' unless the seam says otherwise. */
function suggestionsFor(
  hh: MockHousehold,
  householdId: string,
  list: MockList | null,
): SuggestionsResponse {
  const mode = suggestMode();
  if (mode === 'limit') rateLimited();
  const today = localDate(new Date());
  const runs = hh.suggestRuns?.day === today ? hh.suggestRuns.runs : 0;
  if (runs >= SUGGEST_DAILY_LIMIT) rateLimited();
  hh.suggestRuns = { day: today, runs: runs + 1 };
  const noHistory = mode === 'coldStart' || mode === 'empty';
  const result = suggestCandidates({
    purchases: noHistory ? [] : Object.values(hh.purchases),
    templates: mode === 'empty' ? [] : hh.templates,
    exclude: list
      ? list.items.filter((i) => i.kind !== 'text').map((i) => i.product.productId)
      : [],
    today,
    aisleOrder: normaliseAisleOrder(hh.aisleOrder),
  });
  const suggestions: Suggestion[] = result.candidates.flatMap((c) => {
    let snapshot = c.templateProduct;
    if (!snapshot) {
      const p = productLookup(householdId, c.productId);
      if (!p) return [];
      snapshot = snapshotOf({ ...p, unitType: p.defaultUnitType ?? p.unitType });
    }
    return [
      {
        productId: c.productId,
        snapshot,
        qty: c.qty,
        unit: c.unit,
        note: c.note,
        reason: c.reason,
        fromTemplate: c.fromTemplate,
        fromHistory: c.origin !== 'template',
      },
    ];
  });
  return {
    source: result.coldStart || mode === 'rules' || suggestions.length === 0 ? 'rules' : 'ai',
    coldStart: result.coldStart,
    note: result.note,
    suggestions,
  };
}

function bulkAdd(
  hh: MockHousehold,
  householdId: string,
  userId: string,
  list: MockList,
  body: unknown,
): BulkAddItemsResponse {
  const raw = (body as { items?: unknown } | undefined)?.items;
  if (typeof body !== 'object' || body === null || !Array.isArray(raw)) {
    return invalid('items must be a list', 'items');
  }
  if (raw.length < 1 || raw.length > BULK_ADD_MAX) {
    return invalid(`Add 1 to ${BULK_ADD_MAX} items at a time`, 'items');
  }
  const seen = new Set<string>();
  const results: BulkAddItemResult[] = raw.map((entry) => {
    const r = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const ref = {
      productId: typeof r.productId === 'string' ? r.productId.slice(0, 64) : '',
      unit: (typeof r.unit === 'string' ? r.unit : 'each') as UnitType,
    };
    const fail = (code: 'VALIDATION' | 'LIMIT' | 'CONFLICT', message: string) =>
      ({ ok: false, ...ref, code, message }) as const;
    const parsed = parseAddItemRequest(entry);
    if (!parsed.ok) return fail('VALIDATION', parsed.message);
    const id = lineIdFor(parsed.value.productId, parsed.value.unit);
    if (seen.has(id)) return fail('VALIDATION', 'This product and unit is already in the request.');
    seen.add(id);
    const p = productLookup(householdId, parsed.value.productId);
    if (!p) return fail('VALIDATION', 'That product is not in the catalogue');
    const line: LineInput = {
      product: snapshotOf({ ...p, unitType: p.defaultUnitType ?? p.unitType }),
      qty: parsed.value.qty,
      unit: parsed.value.unit,
      note: parsed.value.note,
    };
    try {
      const { item, merged } = addItem(list, line, userId);
      return {
        ok: true,
        productId: line.product.productId,
        unit: line.unit,
        change: { itemId: item.id, created: !merged, addedQty: line.qty, version: item.version },
      };
    } catch (err) {
      if (!(err instanceof MockFailure)) throw err;
      return fail(err.response.status === 409 ? 'LIMIT' : 'VALIDATION', 'Could not add this item.');
    }
  });
  const added = results.filter((r) => r.ok).length;
  return { list: detail(hh, list), results, added, failed: results.length - added };
}

function bulkUndo(hh: MockHousehold, list: MockList, body: unknown): BulkUndoResponse {
  const changes = unwrap(parseUndoRequest(body, BULK_ADD_MAX));
  const at = nowIso();
  const results: BulkUndoResult[] = changes.map((c) => {
    const cur = list.items.find((i) => i.id === c.itemId);
    if (c.created && !cur) return { ok: true, itemId: c.itemId };
    // A merged text line only had its note joined and was unticked: Undo leaves it (D-103).
    if (!c.created && isTextLineId(c.itemId)) return { ok: true, itemId: c.itemId };
    if (!cur || cur.version !== c.version) {
      return { ok: false, itemId: c.itemId, code: 'CONFLICT', message: 'Changed on another phone' };
    }
    const qty = roundQuantity(cur.qty - c.addedQty, cur.unit);
    if (c.created || qty <= 0) list.items = list.items.filter((i) => i.id !== c.itemId);
    else Object.assign(cur, { qty, version: cur.version + 1, updatedAt: at });
    return { ok: true, itemId: c.itemId };
  });
  const undone = results.filter((r) => r.ok).length;
  return { list: detail(hh, list), results, undone, failed: results.length - undone };
}

// ------------------------------------------------------------------ routes

type Claims = Record<string, string>;
interface Ctx {
  claims: Claims | null;
  body: unknown;
  url: URL;
  params: Record<string, string>;
}
export type Handler = (
  hh: MockHousehold,
  ctx: Ctx & { householdId: string; userId: string },
) => Response;

function route(handler: Handler, mutates: boolean) {
  return {
    auth: true,
    handler: (ctx: Ctx): Response => {
      const householdId = ctx.claims?.['custom:householdId'];
      if (!householdId || !ctx.claims?.sub) {
        return json(403, {
          code: 'NO_HOUSEHOLD',
          message: 'This account is not linked to a household',
        });
      }
      const hh = household(householdId);
      try {
        const res = handler(hh, { ...ctx, householdId, userId: ctx.claims.sub });
        if (mutates) save();
        return res;
      } catch (err) {
        if (err instanceof MockFailure) {
          // Discard partial changes made before the failure.
          load();
          return err.response;
        }
        throw err;
      }
    },
  };
}

export const read = (h: Handler) => route(h, false);
export const write = (h: Handler) => route(h, true);

const aisleView = (hh: MockHousehold): AisleOrderResponse => {
  const order = normaliseAisleOrder(hh.aisleOrder);
  return {
    groups: groupsInOrder(order),
    isDefault: isDefaultAisleOrder(order),
    version: hh.aisleVersion,
  };
};

function overrideFor(householdId: string, productId: string | undefined) {
  if (!isValidSku(productId)) return notFound();
  return productLookup(householdId, productId) ?? notFound();
}

export function createStage2MockRoutes(source: MockProductSource) {
  products = source;
  return {
    // ---- templates
    'GET /api/templates': read((hh) => {
      const order = normaliseAisleOrder(hh.aisleOrder);
      return json(200, {
        templates: sortTemplates(hh.templates).map((t) => ({
          id: t.id,
          name: t.name,
          type: t.type,
          itemCount: t.items.length,
          preview: templatePreview(t.items, order),
          version: t.version,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
      });
    }),
    'POST /api/templates': write((hh, { body }) => {
      const input = unwrap(parseCreateTemplateRequest(body));
      if (hh.templates.length >= LIMITS.templates) {
        conflict(
          'LIMIT',
          `You have ${LIMITS.templates} templates, which is the most Trolley allows. Delete one first.`,
        );
      }
      const at = nowIso();
      const t: MockTemplate = {
        id: newId(),
        ...input,
        items: [],
        version: 1,
        createdAt: at,
        updatedAt: at,
      };
      hh.templates.push(t);
      return json(201, templateView(hh, t));
    }),
    'GET /api/templates/{templateId}': read((hh, { params }) =>
      json(200, templateView(hh, findTemplate(hh, params.templateId))),
    ),
    'PATCH /api/templates/{templateId}': write((hh, { params, body }) => {
      const t = findTemplate(hh, params.templateId);
      const input = unwrap(parseUpdateTemplateRequest(body));
      if (input.version !== t.version)
        conflict('STALE', 'Changed on another phone', templateView(hh, t));
      if (input.name !== undefined) t.name = input.name;
      if (input.type !== undefined) t.type = input.type;
      t.version += 1;
      t.updatedAt = nowIso();
      return json(200, templateView(hh, t));
    }),
    'DELETE /api/templates/{templateId}': write((hh, { params }) => {
      const t = findTemplate(hh, params.templateId);
      hh.templates = hh.templates.filter((x) => x !== t);
      return json(204, null);
    }),
    'POST /api/templates/{templateId}/items': write((hh, { params, body, householdId }) => {
      const t = findTemplate(hh, params.templateId);
      const line = lineFromBody(householdId, body);
      let r: ReturnType<typeof addLine>;
      try {
        r = addLine(t.items, line, nowIso());
      } catch (err) {
        if (err instanceof QuantityTooLargeError) return invalid(err.message, 'qty');
        throw err;
      }
      if (!r.merged && t.items.length >= LIMITS.templateItems) {
        conflict(
          'LIMIT',
          `This template is full (${LIMITS.templateItems} items). Remove something first.`,
        );
      }
      t.items = r.items;
      t.version += 1;
      t.updatedAt = nowIso();
      return json(r.merged ? 200 : 201, {
        template: templateView(hh, t),
        item: clone(r.item),
        merged: r.merged,
      });
    }),
    'PATCH /api/templates/{templateId}/items/{itemId}': write((hh, { params, body }) => {
      const t = findTemplate(hh, params.templateId);
      const ref = lineRef(params.itemId);
      if (ref.text) return notFound(); // templates stay product-only (B-024)
      const edit = unwrap(
        parseEditItemRequest(body, { allowTicked: false, currentUnit: ref.unit }),
      );
      const existing = t.items.find((i) => i.id === ref.id) ?? notFound();
      if (existing.version !== edit.version) {
        conflict('STALE', 'Changed on another phone', templateView(hh, t));
      }
      let r: ReturnType<typeof editLine<TemplateItem>>;
      try {
        r = editLine(t.items, ref.id, edit, nowIso());
      } catch (err) {
        if (err instanceof QuantityTooLargeError) return invalid(err.message, 'qty');
        throw err;
      }
      t.items = r.items;
      t.version += 1;
      t.updatedAt = nowIso();
      return json(200, { template: templateView(hh, t), item: clone(r.item), merged: r.merged });
    }),
    'DELETE /api/templates/{templateId}/items/{itemId}': write((hh, { params }) => {
      const t = findTemplate(hh, params.templateId);
      const ref = lineRef(params.itemId);
      if (!t.items.some((i) => i.id === ref.id)) notFound();
      t.items = t.items.filter((i) => i.id !== ref.id);
      t.version += 1;
      t.updatedAt = nowIso();
      return json(200, { template: templateView(hh, t) });
    }),

    // ---- lists
    'GET /api/lists': read((hh) =>
      json(200, {
        lists: sortActiveLists(
          hh.lists.filter((l) => l.status === 'active').map((l) => summary(hh, l)),
        ),
      }),
    ),
    'POST /api/lists': write((hh, { body, userId }) => {
      const input = unwrap(parseCreateListRequest(body));
      const merged = mergeLines(templateLines(hh, input.templateIds));
      const list = createList(hh, userId, {
        name: input.name ?? defaultListName(new Date()),
        lines: merged.lines,
        thisWeek: input.thisWeek,
      });
      return json(201, { list: detail(hh, list), combined: merged.combined });
    }),
    'GET /api/lists/{listId}': read((hh, { params }) =>
      json(200, detail(hh, findList(hh, params.listId))),
    ),
    'PATCH /api/lists/{listId}': write((hh, { params, body }) => {
      const list = activeList(hh, params.listId);
      const input = unwrap(parseUpdateListRequest(body));
      if (input.name !== undefined) {
        if (input.version !== list.version)
          conflict('STALE', 'Changed on another phone', summary(hh, list));
        list.name = input.name;
        list.version += 1;
        list.updatedAt = nowIso();
      }
      if (input.thisWeek === true) hh.thisWeekId = list.id;
      if (input.thisWeek === false && hh.thisWeekId === list.id) hh.thisWeekId = null;
      return json(200, summary(hh, list));
    }),
    'DELETE /api/lists/{listId}': write((hh, { params }) => {
      const list = activeList(hh, params.listId);
      hh.lists = hh.lists.filter((l) => l !== list);
      if (hh.thisWeekId === list.id) hh.thisWeekId = null;
      return json(204, null);
    }),
    'POST /api/lists/{listId}/templates': write((hh, { params, body, userId }) => {
      const list = activeList(hh, params.listId);
      const ids = unwrap(parseTemplateIdsRequest(body));
      const merged = mergeLines(templateLines(hh, ids));
      const existing = new Set(list.items.map((i) => i.id));
      const newCount = merged.lines.filter((l) => !existing.has(lineInputId(l))).length;
      if (list.items.length + newCount > LIMITS.listItems) {
        conflict(
          'LIMIT',
          `That would put more than ${LIMITS.listItems} items on the list. Remove something first.`,
        );
      }
      const at = nowIso();
      const changes: LineChange[] = merged.lines.map((line) => {
        const id = lineIdFor(line.product.productId, line.unit);
        const prev = list.items.find((i) => i.id === id);
        if (!prev) {
          list.items.push(newItem(list.id, line, userId, at));
          return { itemId: id, created: true, addedQty: line.qty, version: 1 };
        }
        const qty = Math.min(sumQuantity(prev.qty, line.qty, line.unit), ITEM_QTY_MAX[line.unit]);
        const addedQty = roundQuantity(qty - prev.qty, line.unit);
        Object.assign(prev, {
          qty,
          note: mergeNotes(prev.note, line.note),
          ticked: false,
          tickedAt: null,
          version: prev.version + 1,
          updatedAt: at,
          updatedBy: userId,
        });
        return { itemId: id, created: false, addedQty, version: prev.version };
      });
      return json(200, {
        list: detail(hh, list),
        added: merged.lines.length,
        combined: merged.combined + changes.filter((c) => !c.created).length,
        changes,
      });
    }),
    'POST /api/lists/{listId}/items': write((hh, { params, body, householdId, userId }) => {
      const list = activeList(hh, params.listId);
      const line = lineFromBody(householdId, body);
      const { item, merged } = addItem(list, line, userId);
      return json(merged ? 200 : 201, {
        item: clone(item),
        list: summary(hh, list),
        merged,
        addedQty: line.qty,
      });
    }),
    'PATCH /api/lists/{listId}/items/{itemId}': write((hh, { params, body, userId }) => {
      const list = findList(hh, params.listId);
      const ref = lineRef(params.itemId);
      const edit = unwrap(
        parseEditItemRequest(body, {
          allowTicked: true,
          currentUnit: ref.unit,
          textLine: ref.text,
        }),
      );
      if (list.status !== 'active')
        conflict('LIST_ARCHIVED', 'This list is archived and read-only.');
      const existing = list.items.find((i) => i.id === ref.id) ?? notFound();
      if (edit.version !== undefined && edit.version !== existing.version) {
        conflict('STALE', 'Changed on another phone', clone(existing));
      }
      const at = nowIso();
      let item: ListItem;
      let replacedItemId: string | undefined;
      if (ref.text && edit.text !== undefined && textLineId(edit.text) !== ref.id) {
        // New words re-key the line, merging into a line with exactly that text (D-103).
        const newId = textLineId(edit.text);
        const target = list.items.find((i) => i.id === newId);
        const note = edit.note !== undefined ? edit.note : existing.note;
        if (target) {
          Object.assign(target, {
            note: mergeNotes(target.note, note),
            ticked: edit.ticked ?? false,
            tickedAt: edit.ticked ? at : null,
            version: target.version + 1,
            updatedAt: at,
            updatedBy: userId,
          });
          list.items = list.items.filter((i) => i !== existing);
          item = target;
        } else {
          const ticked = edit.ticked ?? existing.ticked;
          item = {
            ...existing,
            id: newId,
            product: textSnapshot(edit.text, edit.groupId ?? existing.product.groupId),
            note,
            ticked,
            tickedAt: ticked ? (existing.tickedAt ?? at) : null,
            version: existing.version + 1,
            updatedAt: at,
            updatedBy: userId,
          };
          list.items = list.items.map((i) => (i === existing ? item : i));
        }
        replacedItemId = ref.id;
      } else if (edit.unit !== undefined && edit.unit !== ref.unit) {
        let r: ReturnType<typeof editLine<ListItem>>;
        try {
          r = editLine(list.items, ref.id, edit, at);
        } catch (err) {
          if (err instanceof QuantityTooLargeError) return invalid(err.message, 'qty');
          throw err;
        }
        const ticked = edit.ticked ?? (r.merged ? false : existing.ticked);
        item = {
          ...r.item,
          ticked,
          tickedAt: ticked ? (r.item.tickedAt ?? at) : null,
          updatedBy: userId,
        };
        list.items = r.items.map((i) => (i.id === item.id ? item : i));
        replacedItemId = ref.id;
      } else {
        if (edit.qty !== undefined) existing.qty = edit.qty;
        if (edit.note !== undefined) existing.note = edit.note;
        if (ref.text && edit.groupId !== undefined) existing.product.groupId = edit.groupId;
        if (edit.ticked !== undefined) {
          existing.ticked = edit.ticked;
          existing.tickedAt = edit.ticked ? at : null;
        }
        existing.version += 1;
        existing.updatedAt = at;
        existing.updatedBy = userId;
        item = existing;
      }
      const archived = edit.ticked === true && isListComplete(list.items);
      if (archived) archive(hh, list, 'auto');
      return json(200, {
        item: clone(item),
        list: summary(hh, list),
        archived,
        ...(replacedItemId ? { replacedItemId } : {}),
      });
    }),
    'DELETE /api/lists/{listId}/items/{itemId}': write((hh, { params, url }) => {
      const list = activeList(hh, params.listId);
      const ref = lineRef(params.itemId);
      const existing = list.items.find((i) => i.id === ref.id) ?? notFound();
      const raw = url.searchParams.get('version');
      if (raw !== null) {
        const version = Number(raw);
        if (!Number.isInteger(version) || version < 1) {
          invalid('version must be a positive whole number', 'version');
        }
        if (version !== existing.version)
          conflict('STALE', 'Changed on another phone', clone(existing));
      }
      list.items = list.items.filter((i) => i !== existing);
      return json(200, { list: summary(hh, list) });
    }),
    'POST /api/lists/{listId}/finish': write((hh, { params }) => {
      const list = activeList(hh, params.listId);
      archive(hh, list, 'finish');
      return json(200, { list: detail(hh, list) });
    }),
    'POST /api/lists/{listId}/reopen': write((hh, { params }) => {
      const list = findList(hh, params.listId);
      if (list.status !== 'archived' || !list.completedAt) {
        conflict('NOT_ARCHIVED', 'This list is not archived.');
      }
      if (!canUndoArchive(list, new Date())) {
        conflict('UNDO_EXPIRED', 'Too late to undo. The list stays in History.');
      }
      assertActiveLimit(hh);
      for (const row of purchasesForList(list.id, list.completedAt as string, list.items)) {
        Reflect.deleteProperty(hh.purchases, purchaseSortKey(row));
      }
      Object.assign(list, {
        status: 'active',
        completedAt: null,
        finishedBy: null,
        itemCount: null,
        boughtCount: null,
        version: list.version + 1,
        updatedAt: nowIso(),
      });
      return json(200, { list: detail(hh, list) });
    }),
    'GET /api/history': read((hh, { url }) => {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw === null ? 20 : Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50)
        invalid('limit must be 1-50', 'limit');
      const cursor = url.searchParams.get('cursor');
      const offset = cursor ? Number(cursor) : 0;
      if (!Number.isInteger(offset) || offset < 0) invalid('Invalid cursor', 'cursor');
      const archived = hh.lists
        .filter((l) => l.status === 'archived')
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
      const page = archived.slice(offset, offset + limit);
      return json(200, {
        lists: page.map((l) => summary(hh, l)),
        nextCursor: offset + limit < archived.length ? String(offset + limit) : null,
      });
    }),
    'POST /api/this-week/items': write((hh, { body, householdId, userId }) => {
      const line = lineFromBody(householdId, body);
      let list = hh.lists.find((l) => l.id === hh.thisWeekId && l.status === 'active');
      let listCreated = false;
      if (!list) {
        list = createList(hh, userId, {
          name: defaultListName(new Date()),
          lines: [],
          thisWeek: true,
        });
        listCreated = true;
      }
      const { item, merged } = addItem(list, line, userId);
      return json(merged ? 200 : 201, {
        item: clone(item),
        list: summary(hh, list),
        merged,
        addedQty: line.qty,
        listCreated,
      });
    }),

    // ---- settings
    'GET /api/settings/aisle-order': read((hh) => json(200, aisleView(hh))),
    'PUT /api/settings/aisle-order': write((hh, { body }) => {
      const input = unwrap(parseAisleOrderRequest(body));
      if (input.version !== undefined && input.version !== hh.aisleVersion) {
        conflict('STALE', 'Changed on another phone', {
          order: normaliseAisleOrder(hh.aisleOrder),
          version: hh.aisleVersion,
        });
      }
      hh.aisleOrder = input.order;
      hh.aisleVersion += 1;
      return json(200, aisleView(hh));
    }),
    'DELETE /api/settings/aisle-order': write((hh) => {
      hh.aisleOrder = null;
      hh.aisleVersion += 1;
      return json(200, aisleView(hh));
    }),
    'GET /api/settings/unit-overrides': read((hh) =>
      json(200, { overrides: sortUnitOverrides(Object.values(hh.overrides)) }),
    ),
    'PUT /api/settings/unit-overrides/{productId}': write((hh, { params, body, householdId }) => {
      const p = overrideFor(householdId, params.productId);
      const unit = unwrap(parseUnitOverrideRequest(body));
      const defaultUnit = p.defaultUnitType ?? p.unitType;
      if (unit === defaultUnit) {
        Reflect.deleteProperty(hh.overrides, p.sku);
        return json(200, { override: null });
      }
      if (!hh.overrides[p.sku] && Object.keys(hh.overrides).length >= LIMITS.unitOverrides) {
        conflict(
          'LIMIT',
          `You can remember units for up to ${LIMITS.unitOverrides} products. Remove one in Settings first.`,
        );
      }
      const override: UnitOverride = {
        productId: p.sku,
        unit,
        defaultUnit,
        name: p.name,
        brand: p.brand,
        imageUrl: p.imageUrl,
        packSize: p.packSize,
        updatedAt: nowIso(),
      };
      hh.overrides[p.sku] = override;
      return json(200, { override });
    }),
    'DELETE /api/settings/unit-overrides/{productId}': write((hh, { params }) => {
      const id = params.productId;
      if (!isValidSku(id) || !hh.overrides[id]) return notFound();
      Reflect.deleteProperty(hh.overrides, id);
      return json(204, null);
    }),

    // ---- Stage 3 (docs/api.md)
    'POST /api/lists/{listId}/suggestions': write((hh, { params, householdId }) =>
      json(200, suggestionsFor(hh, householdId, activeList(hh, params.listId))),
    ),
    'POST /api/suggestions': write((hh, { householdId }) =>
      json(200, suggestionsFor(hh, householdId, null)),
    ),
    'POST /api/lists/{listId}/items/bulk': write((hh, { params, body, householdId, userId }) =>
      json(200, bulkAdd(hh, householdId, userId, activeList(hh, params.listId), body)),
    ),
    'POST /api/lists/{listId}/items/undo': write((hh, { params, body }) =>
      json(200, bulkUndo(hh, activeList(hh, params.listId), body)),
    ),
  };
}
