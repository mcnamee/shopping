/**
 * Stage 2 domain rules for lists, templates and household settings (docs/stages/stage-2.md,
 * D-046 to D-051, D-052 to D-058). Pure functions shared by services/api (DynamoDB) and
 * the web mock API (in memory) so both behave the same:
 *
 * - merge rule (D-046) and deterministic line ids,
 * - product snapshots (D-047),
 * - request validation (A2),
 * - progress, completion, archive/undo rules (D-049),
 * - purchase-row keys (D-050),
 * - shop-mode grouping in household aisle order (E1, E3),
 * - "Week of <Monday>" names (D-048).
 */
import type { GroupSummary, LineChange, ProductSummary } from './api-types';
import { DEFAULT_AISLE_ORDER, DEFAULT_GROUPS, OTHER_GROUP_ID } from './groups';
import { isUnitType, isValidSku, type UnitType } from './product';
import { convertQuantity, roundQuantity } from './quantity';

// ---------------------------------------------------------------------------------------
// Constants

export const TEMPLATE_TYPES = ['weekly', 'meal'] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export function isTemplateType(value: unknown): value is TemplateType {
  return typeof value === 'string' && (TEMPLATE_TYPES as readonly string[]).includes(value);
}

export const LIST_STATUSES = ['active', 'archived'] as const;
export type ListStatus = (typeof LIST_STATUSES)[number];

/** List, template names (A2). */
export const ENTITY_NAME_MAX_LENGTH = 60;
/** Item notes (A2). The modal caps typing at 140; the API allows 200. */
export const ITEM_NOTE_MAX_LENGTH = 200;

export const LIMITS = {
  listItems: 200,
  templateItems: 100,
  templates: 50,
  activeLists: 10,
  unitOverrides: 500,
  /** Template ids accepted in one "create from templates" / "add templates" request. */
  templatesPerRequest: 20,
} as const;

/**
 * Largest quantity on a list or template row (A2: <= 999). Grams and millilitres allow
 * more because the modal's own presets (1000 g, 1000 mL) and max (20000) exceed 999 (D-052).
 */
export const ITEM_QTY_MAX: Record<UnitType, number> = {
  each: 999,
  pack: 999,
  kg: 999,
  L: 999,
  g: 99_999,
  mL: 99_999,
};

/** How long after archiving "Undo" (reopen) is accepted (D-049, D-055). Toast is 8 s. */
export const UNDO_ARCHIVE_WINDOW_MS = 2 * 60 * 1000;

/** The household's local time zone (ALDI Casey, ACT). Used for "Week of" and purchase dates. */
export const HOUSEHOLD_TIME_ZONE = 'Australia/Sydney';

// ---------------------------------------------------------------------------------------
// Ids

/** List and template ids (crypto.randomUUID()). */
export const ENTITY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isValidEntityId(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
}

/**
 * A line (list item or template item) is identified by product + unit (D-046, D-053), so
 * two phones adding the same product and unit always hit the same row and merge instead
 * of creating duplicates. `~` cannot appear in a SKU or unit and is URL-safe.
 */
export function lineIdFor(productId: string, unit: UnitType): string {
  return `${productId}~${unit}`;
}

export function parseLineId(id: unknown): { productId: string; unit: UnitType } | null {
  if (typeof id !== 'string') return null;
  const i = id.lastIndexOf('~');
  if (i <= 0) return null;
  const productId = id.slice(0, i);
  const unit = id.slice(i + 1);
  if (!isValidSku(productId) || !isUnitType(unit)) return null;
  return { productId, unit };
}

export function isValidLineId(value: unknown): value is string {
  return parseLineId(value) !== null;
}

// ---------------------------------------------------------------------------------------
// Product snapshot (D-047)

export interface ProductSnapshot {
  /** Catalogue SKU or `custom-<uuid>`. */
  productId: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  packSize: string | null;
  groupId: string;
  /** The product's default unit when added (before household overrides). */
  unitType: UnitType;
}

/** Snapshot of a product as the household sees it (pass the catalogue default unit). */
export function snapshotOf(
  p: Pick<ProductSummary, 'sku' | 'name' | 'brand' | 'imageUrl' | 'packSize' | 'groupId'> & {
    unitType: UnitType;
  },
): ProductSnapshot {
  return {
    productId: p.sku,
    name: p.name,
    brand: p.brand,
    imageUrl: p.imageUrl,
    packSize: p.packSize,
    groupId: p.groupId,
    unitType: p.unitType,
  };
}

// ---------------------------------------------------------------------------------------
// Lines and items

/** Fields shared by list items and template items. */
export interface Line {
  /** lineIdFor(productId, unit). */
  id: string;
  product: ProductSnapshot;
  qty: number;
  unit: UnitType;
  note: string | null;
  /** Starts at 1; +1 on every change (optimistic concurrency, H3). */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type TemplateItem = Line;

export interface ListItem extends Line {
  listId: string;
  ticked: boolean;
  tickedAt: string | null;
  /** userId of the last writer (sync hints in the UI). */
  updatedBy: string;
}

/** What to add: product, quantity, unit and note. */
export interface LineInput {
  product: ProductSnapshot;
  qty: number;
  unit: UnitType;
  note: string | null;
}

/**
 * Notes when merging two lines (D-046): equal (ignoring case and spacing) or empty keeps
 * the existing one, otherwise "a / b", capped at the note limit.
 */
export function mergeNotes(existing: string | null, added: string | null): string | null {
  const a = existing?.trim() || null;
  const b = added?.trim() || null;
  if (!a) return b;
  if (!b) return a;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
  if (norm(a) === norm(b)) return a;
  if (
    norm(a)
      .split(' / ')
      .some((part) => part === norm(b))
  )
    return a;
  return `${a} / ${b}`.slice(0, ITEM_NOTE_MAX_LENGTH).trim();
}

export function sumQuantity(a: number, b: number, unit: UnitType): number {
  return roundQuantity(a + b, unit);
}

export function qtyWithinMax(qty: number, unit: UnitType): boolean {
  return qty <= ITEM_QTY_MAX[unit] + 1e-9;
}

export function tooMuchMessage(unit: UnitType): string {
  return `That would make more than ${ITEM_QTY_MAX[unit]}${unit === 'each' || unit === 'pack' ? '' : ` ${unit}`}. Enter a smaller amount.`;
}

export interface MergeResult<T extends Line> {
  items: T[];
  /** The created or updated line. */
  item: T;
  merged: boolean;
}

/**
 * Add a line to an embedded collection (templates) by the merge rule. Pure: returns a new
 * array. Throws `QuantityTooLargeError` if the merged quantity would exceed the max.
 */
export function addLine(
  items: readonly TemplateItem[],
  input: LineInput,
  now: string,
): MergeResult<TemplateItem> {
  const id = lineIdFor(input.product.productId, input.unit);
  const existing = items.find((i) => i.id === id);
  if (existing) {
    const qty = sumQuantity(existing.qty, input.qty, input.unit);
    if (!qtyWithinMax(qty, input.unit)) throw new QuantityTooLargeError(input.unit);
    const item: TemplateItem = {
      ...existing,
      qty,
      note: mergeNotes(existing.note, input.note),
      version: existing.version + 1,
      updatedAt: now,
    };
    return { items: items.map((i) => (i.id === id ? item : i)), item, merged: true };
  }
  const item: TemplateItem = {
    id,
    product: input.product,
    qty: input.qty,
    unit: input.unit,
    note: input.note,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  return { items: [...items, item], item, merged: false };
}

export interface LineChangeInput {
  qty?: number;
  unit?: UnitType;
  note?: string | null;
}

export interface EditLineResult<T extends Line> {
  items: T[];
  /** The row after the change (a new id when the unit changed). */
  item: T;
  /** Set when a unit change re-keyed the row (the old id is gone). */
  replacedItemId?: string;
  /** True when a unit change folded the row into an existing row with that unit (D-046). */
  merged: boolean;
}

/**
 * Edit qty/unit/note of one line in a collection. Changing the unit re-keys the line
 * (ids are product + unit); if a line with the new unit exists the two merge by D-046.
 * Without a new qty, a unit change converts within kg/g and L/mL (else the unit default).
 * Throws QuantityTooLargeError on a merge past the max. The caller checks `itemId` exists.
 */
export function editLine<T extends Line>(
  items: readonly T[],
  itemId: string,
  change: LineChangeInput,
  now: string,
): EditLineResult<T> {
  const existing = items.find((i) => i.id === itemId);
  if (!existing) throw new Error(`No line ${itemId}`);
  const unit = change.unit ?? existing.unit;
  const qty =
    change.qty ??
    (unit === existing.unit ? existing.qty : convertQuantity(existing.qty, existing.unit, unit));
  const note = change.note !== undefined ? change.note : existing.note;
  if (unit === existing.unit) {
    const item: T = { ...existing, qty, note, version: existing.version + 1, updatedAt: now };
    return { items: items.map((i) => (i.id === itemId ? item : i)), item, merged: false };
  }
  const newId = lineIdFor(existing.product.productId, unit);
  const target = items.find((i) => i.id === newId);
  if (target) {
    const sum = sumQuantity(target.qty, qty, unit);
    if (!qtyWithinMax(sum, unit)) throw new QuantityTooLargeError(unit);
    const item: T = {
      ...target,
      qty: sum,
      note: mergeNotes(target.note, note),
      version: target.version + 1,
      updatedAt: now,
    };
    return {
      items: items.filter((i) => i.id !== itemId).map((i) => (i.id === newId ? item : i)),
      item,
      replacedItemId: itemId,
      merged: true,
    };
  }
  const item: T = {
    ...existing,
    id: newId,
    unit,
    qty,
    note,
    version: existing.version + 1,
    updatedAt: now,
  };
  return {
    items: items.map((i) => (i.id === itemId ? item : i)),
    item,
    replacedItemId: itemId,
    merged: false,
  };
}

export class QuantityTooLargeError extends Error {
  override name = 'QuantityTooLargeError';
  constructor(public readonly unit: UnitType) {
    super(tooMuchMessage(unit));
  }
}

/**
 * Combine many lines (e.g. several templates) by the merge rule, keeping first-seen order.
 * Quantities are capped at the unit max. `combined` counts lines folded into another.
 */
export function mergeLines(lines: readonly LineInput[]): { lines: LineInput[]; combined: number } {
  const byId = new Map<string, LineInput>();
  let combined = 0;
  for (const l of lines) {
    const id = lineIdFor(l.product.productId, l.unit);
    const prev = byId.get(id);
    if (prev) {
      combined += 1;
      byId.set(id, {
        ...prev,
        qty: Math.min(sumQuantity(prev.qty, l.qty, l.unit), ITEM_QTY_MAX[l.unit]),
        note: mergeNotes(prev.note, l.note),
      });
    } else {
      byId.set(id, { ...l });
    }
  }
  return { lines: [...byId.values()], combined };
}

// ---------------------------------------------------------------------------------------
// Validation (A2). Parsers take an untrusted JSON body and return typed input or a
// field error; the API and the mock both return 400 { code: 'VALIDATION', field, message }.

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string; field?: string };

const fail = (message: string, field?: string): { ok: false; message: string; field?: string } =>
  field ? { ok: false, message, field } : { ok: false, message };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Collapse whitespace, strip control characters. */
export function cleanText(value: string): string {
  return value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseEntityName(value: unknown, kind: 'list' | 'template'): Parsed<string> {
  const name = typeof value === 'string' ? cleanText(value) : '';
  if (name.length === 0) return fail(`Enter a name for this ${kind}.`, 'name');
  if (name.length > ENTITY_NAME_MAX_LENGTH) {
    return fail(`Keep it to ${ENTITY_NAME_MAX_LENGTH} characters or fewer.`, 'name');
  }
  return { ok: true, value: name };
}

export function parseNote(value: unknown): Parsed<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return fail('Note must be text', 'note');
  const note = cleanText(value);
  if (note.length > ITEM_NOTE_MAX_LENGTH) {
    return fail(`Keep the note to ${ITEM_NOTE_MAX_LENGTH} characters or fewer.`, 'note');
  }
  return { ok: true, value: note || null };
}

/**
 * Quantity for a stored line (D-052): > 0, at most ITEM_QTY_MAX, whole numbers for
 * each/pack/g/mL and at most 2 decimal places for kg/L (the modal's precision; off-step
 * values such as 1.3 kg and the 250 g preset are valid).
 */
export function parseItemQuantity(value: unknown, unit: UnitType): Parsed<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('Enter a quantity.', 'qty');
  }
  if (value <= 0) return fail('Enter a quantity more than 0.', 'qty');
  const whole = unit === 'each' || unit === 'pack' || unit === 'g' || unit === 'mL';
  if (whole && !Number.isInteger(value)) return fail('Use a whole number, like 2.', 'qty');
  if (!whole && Math.abs(roundQuantity(value, unit) - value) > 1e-9) {
    return fail('Use up to 2 decimal places, like 1.25.', 'qty');
  }
  if (!qtyWithinMax(value, unit)) {
    return fail(
      `Enter an amount up to ${ITEM_QTY_MAX[unit]}${whole && unit !== 'g' && unit !== 'mL' ? '' : ` ${unit}`}.`,
      'qty',
    );
  }
  return { ok: true, value: roundQuantity(value, unit) };
}

export function parseUnit(value: unknown): Parsed<UnitType> {
  return isUnitType(value)
    ? { ok: true, value }
    : fail('Choose a unit: each, pack, kg, g, L or mL.', 'unit');
}

function parseVersion(value: unknown, required: boolean): Parsed<number | undefined> {
  if (value === undefined || value === null) {
    return required ? fail('version is required', 'version') : { ok: true, value: undefined };
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return fail('version must be a positive whole number', 'version');
  }
  return { ok: true, value };
}

export interface AddItemInput {
  productId: string;
  qty: number;
  unit: UnitType;
  note: string | null;
}

/** POST .../items: { productId, qty, unit, note? }. The product snapshot is server-side. */
export function parseAddItemRequest(body: unknown): Parsed<AddItemInput> {
  if (!isObject(body)) return fail('Body must be a JSON object');
  if (!isValidSku(body.productId)) return fail('Choose a product', 'productId');
  const unit = parseUnit(body.unit);
  if (!unit.ok) return unit;
  const qty = parseItemQuantity(body.qty, unit.value);
  if (!qty.ok) return qty;
  const note = parseNote(body.note);
  if (!note.ok) return note;
  return {
    ok: true,
    value: { productId: body.productId, qty: qty.value, unit: unit.value, note: note.value },
  };
}

export interface EditItemInput {
  qty?: number;
  unit?: UnitType;
  note?: string | null;
  ticked?: boolean;
  version?: number;
}

/**
 * PATCH .../items/{id}: any of { qty, unit, note, ticked } plus `version`. `version` is
 * required when qty/unit/note change (H3) and optional for a tick-only change (ticking is
 * an idempotent set, so it never conflicts). Templates pass allowTicked=false.
 * qty is validated against `unit` if given, else against `currentUnit`.
 */
export function parseEditItemRequest(
  body: unknown,
  opts: { allowTicked: boolean; currentUnit?: UnitType },
): Parsed<EditItemInput> {
  if (!isObject(body)) return fail('Body must be a JSON object');
  const out: EditItemInput = {};
  if (body.unit !== undefined) {
    const unit = parseUnit(body.unit);
    if (!unit.ok) return unit;
    out.unit = unit.value;
  }
  if (body.qty !== undefined) {
    const unit = out.unit ?? opts.currentUnit;
    // Without a known unit, validate the generic rules; the caller re-checks with the row.
    const qty = parseItemQuantity(body.qty, unit ?? 'kg');
    if (!qty.ok) return qty;
    out.qty = qty.value;
  }
  if (body.note !== undefined) {
    const note = parseNote(body.note);
    if (!note.ok) return note;
    out.note = note.value;
  }
  if (body.ticked !== undefined) {
    if (!opts.allowTicked) return fail('Templates have no ticks', 'ticked');
    if (typeof body.ticked !== 'boolean') return fail('ticked must be true or false', 'ticked');
    out.ticked = body.ticked;
  }
  const contentChange = out.qty !== undefined || out.unit !== undefined || 'note' in out;
  if (!contentChange && out.ticked === undefined) return fail('Nothing to change');
  const version = parseVersion(body.version, contentChange);
  if (!version.ok) return version;
  if (version.value !== undefined) out.version = version.value;
  return { ok: true, value: out };
}

export interface CreateTemplateInput {
  name: string;
  type: TemplateType;
}

export function parseCreateTemplateRequest(body: unknown): Parsed<CreateTemplateInput> {
  if (!isObject(body)) return fail('Body must be a JSON object');
  const name = parseEntityName(body.name, 'template');
  if (!name.ok) return name;
  const type = body.type ?? 'weekly';
  if (!isTemplateType(type)) return fail('Choose Weekly or Meal', 'type');
  return { ok: true, value: { name: name.value, type } };
}

export interface UpdateTemplateInput {
  name?: string;
  type?: TemplateType;
  version: number;
}

export function parseUpdateTemplateRequest(body: unknown): Parsed<UpdateTemplateInput> {
  if (!isObject(body)) return fail('Body must be a JSON object');
  const out: Partial<UpdateTemplateInput> = {};
  if (body.name !== undefined) {
    const name = parseEntityName(body.name, 'template');
    if (!name.ok) return name;
    out.name = name.value;
  }
  if (body.type !== undefined) {
    if (!isTemplateType(body.type)) return fail('Choose Weekly or Meal', 'type');
    out.type = body.type;
  }
  if (out.name === undefined && out.type === undefined) return fail('Nothing to change');
  const version = parseVersion(body.version, true);
  if (!version.ok) return version;
  return { ok: true, value: { ...out, version: version.value as number } };
}

function parseTemplateIds(value: unknown): Parsed<string[]> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return fail('templateIds must be a list', 'templateIds');
  if (value.length > LIMITS.templatesPerRequest) {
    return fail(`Choose at most ${LIMITS.templatesPerRequest} templates`, 'templateIds');
  }
  const ids: string[] = [];
  for (const id of value) {
    if (!isValidEntityId(id)) return fail('Unknown template', 'templateIds');
    if (!ids.includes(id)) ids.push(id);
  }
  return { ok: true, value: ids };
}

export interface CreateListInput {
  /** Default "Week of <Monday>". */
  name: string | null;
  templateIds: string[];
  /**
   * true: flag as "this week" (replacing any other); false: never flag; undefined: flag
   * only if no active list is flagged (D-048, first list is flagged automatically).
   */
  thisWeek: boolean | undefined;
}

export function parseCreateListRequest(body: unknown): Parsed<CreateListInput> {
  const b = body === undefined || body === null ? {} : body;
  if (!isObject(b)) return fail('Body must be a JSON object');
  let name: string | null = null;
  if (b.name !== undefined && b.name !== null) {
    const parsed = parseEntityName(b.name, 'list');
    if (!parsed.ok) return parsed;
    name = parsed.value;
  }
  const templateIds = parseTemplateIds(b.templateIds);
  if (!templateIds.ok) return templateIds;
  if (b.thisWeek !== undefined && typeof b.thisWeek !== 'boolean') {
    return fail('thisWeek must be true or false', 'thisWeek');
  }
  return {
    ok: true,
    value: { name, templateIds: templateIds.value, thisWeek: b.thisWeek as boolean | undefined },
  };
}

export interface UpdateListInput {
  name?: string;
  /** Rename needs the list version (H3). */
  version?: number;
  /** true flags this list (clearing any other); false clears the flag if it is this list. */
  thisWeek?: boolean;
}

export function parseUpdateListRequest(body: unknown): Parsed<UpdateListInput> {
  if (!isObject(body)) return fail('Body must be a JSON object');
  const out: UpdateListInput = {};
  if (body.name !== undefined) {
    const name = parseEntityName(body.name, 'list');
    if (!name.ok) return name;
    out.name = name.value;
  }
  if (body.thisWeek !== undefined) {
    if (typeof body.thisWeek !== 'boolean')
      return fail('thisWeek must be true or false', 'thisWeek');
    out.thisWeek = body.thisWeek;
  }
  if (out.name === undefined && out.thisWeek === undefined) return fail('Nothing to change');
  const version = parseVersion(body.version, out.name !== undefined);
  if (!version.ok) return version;
  if (version.value !== undefined) out.version = version.value;
  return { ok: true, value: out };
}

export function parseTemplateIdsRequest(body: unknown): Parsed<string[]> {
  if (!isObject(body)) return fail('Body must be a JSON object');
  const ids = parseTemplateIds(body.templateIds);
  if (!ids.ok) return ids;
  if (ids.value.length === 0) return fail('Choose at least one template', 'templateIds');
  return ids;
}

export interface AisleOrderInput {
  order: string[];
  version?: number;
}

/** PUT /api/settings/aisle-order: `order` must be exactly the 15 group ids, each once. */
export function parseAisleOrderRequest(body: unknown): Parsed<AisleOrderInput> {
  if (!isObject(body)) return fail('Body must be a JSON object');
  const order = body.order;
  if (!Array.isArray(order)) return fail('order must be a list of group ids', 'order');
  const expected = new Set(DEFAULT_AISLE_ORDER);
  const seen = new Set<string>();
  for (const id of order) {
    if (typeof id !== 'string' || !expected.has(id)) return fail('Unknown group', 'order');
    if (seen.has(id)) return fail('Each group must appear once', 'order');
    seen.add(id);
  }
  if (seen.size !== expected.size) return fail('Every group must be included', 'order');
  // The aisle order starts at version 0 (never saved), so 0 is a valid version here.
  const v = body.version;
  if (v !== undefined && v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 0)) {
    return fail('version must be a whole number', 'version');
  }
  return {
    ok: true,
    value: { order: order as string[], ...(typeof v === 'number' ? { version: v } : {}) },
  };
}

export function parseUnitOverrideRequest(body: unknown): Parsed<UnitType> {
  if (!isObject(body)) return fail('Body must be a JSON object');
  return parseUnit(body.unit);
}

// ---------------------------------------------------------------------------------------
// Progress, completion, archive (D-049)

export interface Progress {
  ticked: number;
  total: number;
}

export function listProgress(items: readonly Pick<ListItem, 'ticked'>[]): Progress {
  let ticked = 0;
  for (const i of items) if (i.ticked) ticked += 1;
  return { ticked, total: items.length };
}

/** Auto-archive condition: at least one item and every item ticked (empty lists never archive). */
export function isListComplete(items: readonly Pick<ListItem, 'ticked'>[]): boolean {
  return items.length > 0 && items.every((i) => i.ticked);
}

/** Undo (reopen) is accepted for UNDO_ARCHIVE_WINDOW_MS after completedAt. */
export function canUndoArchive(
  list: { status: ListStatus; completedAt: string | null },
  now: Date,
): boolean {
  if (list.status !== 'archived' || !list.completedAt) return false;
  const at = Date.parse(list.completedAt);
  return Number.isFinite(at) && now.getTime() - at <= UNDO_ARCHIVE_WINDOW_MS;
}

// ---------------------------------------------------------------------------------------
// Purchase rows (D-050, D-054)

export interface PurchaseRecord {
  productId: string;
  name: string;
  groupId: string;
  qty: number;
  unit: UnitType;
  listId: string;
  /** ISO timestamp of the archive. */
  completedAt: string;
  /** Household-local date (YYYY-MM-DD) of completedAt. */
  date: string;
}

/**
 * `PURCHASE#<productId>#<local date>#<listId>#<unit>`. The unit suffix (D-054) keeps two
 * rows of the same product in different units on one list apart; keys are deterministic so
 * re-archiving is idempotent.
 */
export function purchaseSortKey(p: Pick<PurchaseRecord, 'productId' | 'date' | 'listId' | 'unit'>) {
  return `PURCHASE#${p.productId}#${p.date}#${p.listId}#${p.unit}`;
}

/** One purchase per ticked item; unticked items are "not bought" and produce none. */
export function purchasesForList(
  listId: string,
  completedAt: string,
  items: readonly ListItem[],
): PurchaseRecord[] {
  const date = localDate(completedAt);
  return items
    .filter((i) => i.ticked)
    .map((i) => ({
      productId: i.product.productId,
      name: i.product.name,
      groupId: i.product.groupId,
      qty: i.qty,
      unit: i.unit,
      listId,
      completedAt,
      date,
    }));
}

// ---------------------------------------------------------------------------------------
// Dates (household time zone)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function zonedParts(date: Date, timeZone: string): { y: number; m: number; d: number; wd: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'));
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), wd };
}

/** Household-local calendar date "YYYY-MM-DD" of an instant. */
export function localDate(at: string | Date, timeZone = HOUSEHOLD_TIME_ZONE): string {
  const { y, m, d } = zonedParts(typeof at === 'string' ? new Date(at) : at, timeZone);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * The Monday a weekly list is "for": this week's Monday, or the coming Monday on Saturday
 * and Sunday (docs/ux/lists.md 2; Sun 22 Nov 2026 -> Mon 23 Nov). Returns "YYYY-MM-DD".
 */
export function weekOfMonday(now: Date, timeZone = HOUSEHOLD_TIME_ZONE): string {
  const { y, m, d, wd } = zonedParts(now, timeZone);
  const delta = wd >= 5 ? 7 - wd : -wd;
  const monday = new Date(Date.UTC(y, m - 1, d + delta));
  return monday.toISOString().slice(0, 10);
}

/** "Week of 23 Nov" (D-048). */
export function defaultListName(now: Date, timeZone = HOUSEHOLD_TIME_ZONE): string {
  const [, mm, dd] = weekOfMonday(now, timeZone).split('-').map(Number);
  return `Week of ${dd} ${MONTHS[(mm ?? 1) - 1]}`;
}

// ---------------------------------------------------------------------------------------
// Aisle order and shop-mode grouping (E1, E3, G1)

const GROUP_BY_ID = new Map<string, GroupSummary>(
  DEFAULT_GROUPS.map(({ id, name, shortName }) => [id, { id, name, shortName }]),
);

/**
 * Make a stored order safe: drop unknown and duplicate ids, then append any missing group
 * (e.g. one added in a later release) before Other, with Other last if missing.
 */
export function normaliseAisleOrder(stored: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  for (const id of stored ?? []) {
    if (typeof id === 'string' && GROUP_BY_ID.has(id) && !out.includes(id)) out.push(id);
  }
  for (const id of DEFAULT_AISLE_ORDER) {
    if (out.includes(id)) continue;
    if (id === OTHER_GROUP_ID) {
      out.push(id);
      continue;
    }
    const otherAt = out.indexOf(OTHER_GROUP_ID);
    if (otherAt === -1) out.push(id);
    else out.splice(otherAt, 0, id);
  }
  return out;
}

export function isDefaultAisleOrder(order: readonly string[]): boolean {
  return (
    order.length === DEFAULT_AISLE_ORDER.length &&
    order.every((id, i) => id === DEFAULT_AISLE_ORDER[i])
  );
}

export function groupsInOrder(order: readonly string[]): GroupSummary[] {
  return normaliseAisleOrder(order).map((id) => GROUP_BY_ID.get(id) as GroupSummary);
}

const byName = (a: { product: { name: string } }, b: { product: { name: string } }) =>
  a.product.name.localeCompare(b.product.name, 'en-AU', { sensitivity: 'base' });

/** Items by name, ties by unit (stable, so rows never swap places between polls). */
export function compareLinesByName(a: Line, b: Line): number {
  return byName(a, b) || a.id.localeCompare(b.id);
}

export interface ShopSection<T extends Pick<ListItem, 'ticked' | 'product' | 'id'>> {
  group: GroupSummary;
  items: T[];
  ticked: number;
  total: number;
}

/**
 * Shop mode sections (E1, E3): groups in the household aisle order, empty groups hidden;
 * within a group unticked by name then ticked by name. `tickedFirst` reverses that for the
 * archived (history) view, where what was bought leads. Unknown group ids fall into Other.
 */
export function groupForShop<T extends ListItem>(
  items: readonly T[],
  aisleOrder: readonly string[],
  opts: { tickedFirst?: boolean } = {},
): ShopSection<T>[] {
  const order = normaliseAisleOrder(aisleOrder);
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const gid = GROUP_BY_ID.has(item.product.groupId) ? item.product.groupId : OTHER_GROUP_ID;
    const bucket = buckets.get(gid);
    if (bucket) bucket.push(item);
    else buckets.set(gid, [item]);
  }
  const sections: ShopSection<T>[] = [];
  for (const gid of order) {
    const bucket = buckets.get(gid);
    if (!bucket?.length) continue;
    const sorted = [...bucket].sort((a, b) => {
      if (a.ticked !== b.ticked) return (a.ticked ? 1 : -1) * (opts.tickedFirst ? -1 : 1);
      return compareLinesByName(a, b);
    });
    const progress = listProgress(sorted);
    sections.push({
      group: GROUP_BY_ID.get(gid) as GroupSummary,
      items: sorted,
      ...progress,
    });
  }
  return sections;
}

/** Template items: aisle order (group), then name, as one flat list (docs/ux/templates.md). */
export function sortTemplateItems<T extends Line>(
  items: readonly T[],
  aisleOrder: readonly string[],
): T[] {
  const order = normaliseAisleOrder(aisleOrder);
  const rank = (g: string) => {
    const i = order.indexOf(g);
    return i === -1 ? order.length : i;
  };
  return [...items].sort(
    (a, b) => rank(a.product.groupId) - rank(b.product.groupId) || compareLinesByName(a, b),
  );
}

/** First `n` item names in aisle order (template card preview). */
export function templatePreview(
  items: readonly Line[],
  aisleOrder: readonly string[],
  n = 3,
): string[] {
  return sortTemplateItems(items, aisleOrder)
    .slice(0, n)
    .map((i) => i.product.name);
}

/** Templates: weekly first, then name A to Z (B1). */
export function sortTemplates<T extends { type: TemplateType; name: string; id: string }>(
  templates: readonly T[],
): T[] {
  return [...templates].sort(
    (a, b) =>
      (a.type === b.type ? 0 : a.type === 'weekly' ? -1 : 1) ||
      a.name.localeCompare(b.name, 'en-AU', { sensitivity: 'base' }) ||
      a.id.localeCompare(b.id),
  );
}

/** Active lists: "this week" first, then newest created first (D1, docs/ux/lists.md 1). */
export function sortActiveLists<T extends { thisWeek: boolean; createdAt: string; id: string }>(
  lists: readonly T[],
): T[] {
  return [...lists].sort(
    (a, b) =>
      Number(b.thisWeek) - Number(a.thisWeek) ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

// ---------------------------------------------------------------------------------------
// Unit overrides (C5, G2)

export interface UnitOverride {
  productId: string;
  unit: UnitType;
  /** Product's own default unit, for "Opens in L (usually pack)". */
  defaultUnit: UnitType;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  packSize: string | null;
  updatedAt: string;
}

/** Search result / product detail as the household sees it: override applied. */
export function applyUnitOverride<T extends ProductSummary>(
  p: T,
  overrides: Readonly<Record<string, Pick<UnitOverride, 'unit'>>> | undefined,
): T {
  const o = overrides?.[p.sku];
  const defaultUnitType = p.defaultUnitType ?? p.unitType;
  return { ...p, unitType: o ? o.unit : defaultUnitType, defaultUnitType };
}

export function sortUnitOverrides(overrides: readonly UnitOverride[]): UnitOverride[] {
  return [...overrides].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'en-AU', { sensitivity: 'base' }) ||
      a.productId.localeCompare(b.productId),
  );
}

/**
 * POST /api/lists/{id}/items/undo body: `{ changes: LineChange[] }` (1..max, distinct
 * item ids) as returned by a bulk add or "add templates".
 */
export function parseUndoRequest(body: unknown, max: number): Parsed<LineChange[]> {
  if (!isObject(body) || !Array.isArray(body.changes)) {
    return fail('changes must be a list', 'changes');
  }
  if (body.changes.length < 1 || body.changes.length > max) {
    return fail(`Undo 1 to ${max} items at a time`, 'changes');
  }
  const seen = new Set<string>();
  const out: LineChange[] = [];
  for (const c of body.changes as unknown[]) {
    if (!isObject(c)) return fail('Each change must be an object', 'changes');
    const { itemId, created, addedQty, version } = c;
    const ref = parseLineId(itemId);
    if (!ref || typeof itemId !== 'string' || seen.has(itemId)) {
      return fail('Each change needs a distinct item id', 'changes');
    }
    if (typeof created !== 'boolean') return fail('created must be true or false', 'changes');
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      return fail('version must be a positive whole number', 'changes');
    }
    if (typeof addedQty !== 'number' || !Number.isFinite(addedQty) || addedQty < 0) {
      return fail('addedQty must be a number of 0 or more', 'changes');
    }
    seen.add(itemId);
    out.push({ itemId, created, addedQty: roundQuantity(addedQty, ref.unit), version });
  }
  return { ok: true, value: out };
}
