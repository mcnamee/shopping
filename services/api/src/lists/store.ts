/**
 * Lists (HH#<hh> / LIST#<id>) and their items (HH#<hh>#LIST#<id> / ITEM#<productId>~<unit>),
 * spec 5.1 and D-046 to D-050, D-053 to D-057.
 *
 * Concurrency (H2, H3, F3):
 * - Every item write is one conditional write of that item's row, in a transaction with a
 *   ConditionCheck that the list is still active (archived lists are read-only, F5).
 * - Item ids are product + unit, so concurrent adds of the same product meet on one row and
 *   merge (conditional on the row version, retried) instead of duplicating (C4).
 * - Ticks are idempotent sets with no version; content edits need the item version.
 * - Auto-archive: after a tick, the list's items are read back (strongly consistent); if all
 *   are ticked, `active -> archived` is a conditional update, so it happens exactly once.
 * - "This week" is a single pointer item (THISWEEK -> listId), so flagging is one write.
 */
import { randomUUID } from 'node:crypto';
import {
  isListComplete,
  ITEM_QTY_MAX,
  keys,
  lineIdFor,
  LIMITS,
  listProgress,
  mergeNotes,
  parseLineId,
  purchaseSortKey,
  purchasesForList,
  qtyWithinMax,
  roundQuantity,
  sumQuantity,
  tooMuchMessage,
  editLine,
  QuantityTooLargeError,
  type EditItemInput,
  type LineInput,
  type ListDetail,
  type ListItem,
  type ListStatus,
  type ListSummary,
  type LineChange,
} from '@trolley/core';
import {
  ConditionFailed,
  decodeKeyCursor,
  encodeKeyCursor,
  type Db,
  type DbItem,
  type TransactOp,
} from '../db';
import { fail, HttpFailure } from '../http';
import { lineFields, toListItem } from '../lines';

export interface ListRecord {
  id: string;
  name: string;
  status: ListStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  finishedBy: 'auto' | 'finish' | null;
  /** Stored at archive time (history shows "28/30 bought" without reading items). */
  itemCount: number | null;
  boughtCount: number | null;
  version: number;
  createdBy: string;
}

const MAX_RETRIES = 6;
const BULK_CONCURRENCY = 8;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

export function toListRecord(item: DbItem): ListRecord | null {
  if (item.entity !== 'List') return null;
  const id = str(item.id);
  const name = str(item.name);
  if (!id || !name) return null;
  const finishedBy =
    item.finishedBy === 'auto' || item.finishedBy === 'finish' ? item.finishedBy : null;
  return {
    id,
    name,
    status: item.status === 'archived' ? 'archived' : 'active',
    createdAt: str(item.createdAt) ?? '',
    updatedAt: str(item.updatedAt) ?? '',
    completedAt: str(item.completedAt),
    finishedBy,
    itemCount: num(item.itemCount),
    boughtCount: num(item.boughtCount),
    version: num(item.version) ?? 1,
    createdBy: str(item.createdBy) ?? '',
  };
}

export type BulkFailCode = 'VALIDATION' | 'LIMIT' | 'CONFLICT';

/** A per-line failure from an HttpFailure thrown by addItem. */
function bulkFailure(err: HttpFailure): { code: BulkFailCode; message: string } {
  let body: { code?: unknown; reason?: unknown; message?: unknown } = {};
  try {
    body = JSON.parse(String(err.result.body ?? '{}')) as typeof body;
  } catch {
    // keep defaults
  }
  const message = typeof body.message === 'string' ? body.message : 'Could not add this item.';
  if (err.result.statusCode === 400) return { code: 'VALIDATION', message };
  if (body.reason === 'LIMIT') return { code: 'LIMIT', message };
  return { code: 'CONFLICT', message };
}

async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

export class ListStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  // ------------------------------------------------------------------ keys and mapping

  private listKey(hh: string, id: string) {
    return { pk: keys.householdPk(hh), sk: keys.listSk(id) };
  }

  private itemKey(hh: string, listId: string, itemId: string) {
    return { pk: keys.listItemPk(hh, listId), sk: keys.listItemSk(itemId) };
  }

  private thisWeekKey(hh: string) {
    return { pk: keys.householdPk(hh), sk: keys.thisWeekSk };
  }

  private listToDb(hh: string, r: ListRecord): DbItem {
    return {
      ...this.listKey(hh, r.id),
      entity: 'List',
      id: r.id,
      name: r.name,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      version: r.version,
      createdBy: r.createdBy,
      gsi2pk: keys.listsGsi2Pk(hh, r.status),
      gsi2sk: keys.listsGsi2Sk(r.status === 'active' ? r.createdAt : (r.completedAt ?? ''), r.id),
    };
  }

  private itemToDb(hh: string, item: ListItem): DbItem {
    return {
      ...this.itemKey(hh, item.listId, item.id),
      entity: 'ListItem',
      ...lineFields(item),
      listId: item.listId,
      ticked: item.ticked,
      tickedAt: item.tickedAt,
      updatedBy: item.updatedBy,
    };
  }

  /** Transaction op: the list exists and is active. */
  private activeCheck(hh: string, listId: string): TransactOp {
    return {
      check: this.listKey(hh, listId),
      condition: '#status = :active',
      names: { '#status': 'status' },
      values: { ':active': 'active' },
    };
  }

  /** After a failed active check: 404 if gone, 409 if archived. */
  private async listNotActive(hh: string, listId: string): Promise<never> {
    const rec = await this.getRecord(hh, listId);
    if (!rec) return fail.notFound();
    return fail.conflict('LIST_ARCHIVED', 'This list is archived and read-only.');
  }

  // ------------------------------------------------------------------ reads

  async getRecord(hh: string, id: string): Promise<ListRecord | null> {
    const row = await this.db.get(this.listKey(hh, id));
    return row ? toListRecord(row) : null;
  }

  async mustGetRecord(hh: string, id: string): Promise<ListRecord> {
    return (await this.getRecord(hh, id)) ?? fail.notFound();
  }

  async mustGetActive(hh: string, id: string): Promise<ListRecord> {
    const rec = await this.mustGetRecord(hh, id);
    if (rec.status !== 'active') {
      return fail.conflict('LIST_ARCHIVED', 'This list is archived and read-only.');
    }
    return rec;
  }

  async items(hh: string, listId: string): Promise<ListItem[]> {
    const rows = await this.db.queryAll(keys.listItemPk(hh, listId), keys.listItemSkPrefix);
    return rows.flatMap((r) => {
      const i = toListItem(r);
      return i ? [i] : [];
    });
  }

  async getItem(hh: string, listId: string, itemId: string): Promise<ListItem | null> {
    const row = await this.db.get(this.itemKey(hh, listId, itemId));
    return row ? toListItem(row) : null;
  }

  /** The flagged list id, if that list is still active (D-048, D-056). */
  async thisWeekId(hh: string): Promise<string | null> {
    const ptr = await this.db.get(this.thisWeekKey(hh));
    return str(ptr?.listId) ?? null;
  }

  summary(
    r: ListRecord,
    items: readonly ListItem[] | null,
    thisWeekId: string | null,
  ): ListSummary {
    const p =
      r.status === 'archived' && r.itemCount !== null
        ? { total: r.itemCount, ticked: r.boughtCount ?? 0 }
        : listProgress(items ?? []);
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      thisWeek: r.status === 'active' && thisWeekId === r.id,
      itemCount: p.total,
      tickedCount: p.ticked,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      completedAt: r.completedAt,
      finishedBy: r.finishedBy,
      version: r.version,
    };
  }

  async detail(hh: string, id: string): Promise<ListDetail> {
    const [rec, items, tw] = await Promise.all([
      this.mustGetRecord(hh, id),
      this.items(hh, id),
      this.thisWeekId(hh),
    ]);
    return { ...this.summary(rec, items, tw), items };
  }

  async summaryOf(hh: string, id: string): Promise<ListSummary> {
    const { items: _items, ...summary } = await this.detail(hh, id);
    return summary;
  }

  async activeRecords(hh: string): Promise<ListRecord[]> {
    const rows = await this.db.queryIndexAll(keys.listsGsi2Pk(hh, 'active'));
    return rows.flatMap((r) => {
      const rec = toListRecord(r);
      return rec && rec.status === 'active' ? [rec] : [];
    });
  }

  /** Active lists with progress (one items query per list; at most 10 lists). */
  async activeSummaries(hh: string): Promise<ListSummary[]> {
    const [records, tw] = await Promise.all([this.activeRecords(hh), this.thisWeekId(hh)]);
    return Promise.all(records.map(async (r) => this.summary(r, await this.items(hh, r.id), tw)));
  }

  /** Archived lists, newest completed first. */
  async history(hh: string, cursor: string | undefined, limit: number) {
    const pk = keys.listsGsi2Pk(hh, 'archived');
    let startKey: DbItem | undefined;
    if (cursor) {
      const decoded = decodeKeyCursor(cursor);
      if (!decoded || decoded.gsi2pk !== pk) return fail.validation('Invalid cursor', 'cursor');
      startKey = decoded;
    }
    const page = await this.db.queryIndexPage({ pk, limit, forward: false, startKey });
    const lists = page.items.flatMap((row) => {
      const r = toListRecord(row);
      return r && r.status === 'archived' ? [this.summary(r, null, null)] : [];
    });
    return { lists, nextCursor: encodeKeyCursor(page.lastKey) };
  }

  // ------------------------------------------------------------------ lists

  private async assertActiveLimit(hh: string): Promise<void> {
    const active = await this.activeRecords(hh);
    if (active.length >= LIMITS.activeLists) {
      fail.conflict(
        'LIMIT',
        `You have ${LIMITS.activeLists} lists on the go, which is the most Trolley allows. Archive or delete one first.`,
      );
    }
  }

  /**
   * Create a list with initial lines (already merged). thisWeek: true flags it, false never,
   * undefined flags it only if no active list is flagged (the first list, D-048).
   */
  async create(
    hh: string,
    userId: string,
    input: { name: string; lines: LineInput[]; thisWeek: boolean | undefined },
  ): Promise<ListRecord> {
    await this.assertActiveLimit(hh);
    if (input.lines.length > LIMITS.listItems) {
      fail.conflict(
        'LIMIT',
        `That would put more than ${LIMITS.listItems} items on the list. Choose fewer templates.`,
      );
    }
    const at = this.now().toISOString();
    const rec: ListRecord = {
      id: this.newId(),
      name: input.name,
      status: 'active',
      createdAt: at,
      updatedAt: at,
      completedAt: null,
      finishedBy: null,
      itemCount: null,
      boughtCount: null,
      version: 1,
      createdBy: userId,
    };
    await this.db.put(this.listToDb(hh, rec), { condition: 'attribute_not_exists(pk)' });
    if (input.lines.length) {
      await this.db.batchWrite(
        input.lines.map((l) => ({ put: this.itemToDb(hh, this.newItem(rec.id, l, userId, at)) })),
      );
    }
    if (input.thisWeek === true) await this.setThisWeek(hh, rec.id);
    else if (input.thisWeek === undefined) await this.flagIfNone(hh, rec.id);
    return rec;
  }

  private newItem(listId: string, l: LineInput, userId: string, at: string): ListItem {
    return {
      id: lineIdFor(l.product.productId, l.unit),
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

  /** Flag `listId` if no active list is flagged. Returns whether it was flagged. */
  async flagIfNone(hh: string, listId: string): Promise<boolean> {
    const current = await this.thisWeekId(hh);
    if (current) {
      const rec = await this.getRecord(hh, current);
      if (rec?.status === 'active') return false;
    }
    try {
      await this.db.put(
        {
          ...this.thisWeekKey(hh),
          entity: 'ThisWeek',
          listId,
          updatedAt: this.now().toISOString(),
        },
        current
          ? { condition: 'listId = :old', values: { ':old': current } }
          : { condition: 'attribute_not_exists(listId)' },
      );
      return true;
    } catch (err) {
      if (err instanceof ConditionFailed) return false;
      throw err;
    }
  }

  /** Flag this list; any other loses the flag in the same single write (D4). */
  async setThisWeek(hh: string, listId: string): Promise<void> {
    try {
      await this.db.transact([
        this.activeCheck(hh, listId),
        {
          put: {
            ...this.thisWeekKey(hh),
            entity: 'ThisWeek',
            listId,
            updatedAt: this.now().toISOString(),
          },
        },
      ]);
    } catch (err) {
      if (err instanceof ConditionFailed) await this.listNotActive(hh, listId);
      throw err;
    }
  }

  /** Clear the flag if it is on this list. */
  async clearThisWeek(hh: string, listId: string): Promise<void> {
    try {
      await this.db.delete(this.thisWeekKey(hh), {
        condition: 'listId = :id',
        values: { ':id': listId },
      });
    } catch (err) {
      if (!(err instanceof ConditionFailed)) throw err;
    }
  }

  async rename(hh: string, id: string, name: string, version: number): Promise<void> {
    try {
      await this.db.update(
        this.listKey(hh, id),
        'SET #name = :n, #ver = #ver + :one, updatedAt = :at',
        {
          condition: '#status = :active AND #ver = :v',
          names: { '#name': 'name', '#ver': 'version', '#status': 'status' },
          values: {
            ':n': name,
            ':one': 1,
            ':at': this.now().toISOString(),
            ':active': 'active',
            ':v': version,
          },
        },
      );
    } catch (err) {
      if (!(err instanceof ConditionFailed)) throw err;
      const rec = await this.mustGetRecord(hh, id);
      if (rec.status !== 'active') await this.listNotActive(hh, id);
      fail.conflict('STALE', 'Changed on another phone', await this.summaryOf(hh, id));
    }
  }

  /** Delete an active list and its items (D5). Archived lists cannot be deleted (B-011). */
  async deleteList(hh: string, id: string): Promise<void> {
    try {
      await this.db.delete(this.listKey(hh, id), {
        condition: '#status = :active',
        names: { '#status': 'status' },
        values: { ':active': 'active' },
      });
    } catch (err) {
      if (err instanceof ConditionFailed) await this.listNotActive(hh, id);
      throw err;
    }
    const items = await this.db.queryAll(keys.listItemPk(hh, id), keys.listItemSkPrefix);
    await this.db.batchWrite(
      items.map((i) => ({ delete: { pk: String(i.pk), sk: String(i.sk) } })),
    );
    await this.clearThisWeek(hh, id);
  }

  // ------------------------------------------------------------------ items

  /**
   * Add one line by the merge rule, atomically (C4). A merge unticks the row: more is
   * needed, so it should be picked up again (D-053).
   */
  async addItem(
    hh: string,
    userId: string,
    listId: string,
    input: LineInput,
  ): Promise<{ item: ListItem; merged: boolean }> {
    const itemId = lineIdFor(input.product.productId, input.unit);
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      const existing = await this.getItem(hh, listId, itemId);
      const at = this.now().toISOString();
      let item: ListItem;
      let op: TransactOp;
      if (!existing) {
        const count = await this.db.count(keys.listItemPk(hh, listId), keys.listItemSkPrefix);
        if (count >= LIMITS.listItems) {
          await this.mustGetActive(hh, listId);
          return fail.conflict(
            'LIMIT',
            `This list is full (${LIMITS.listItems} items). Remove something first.`,
          );
        }
        item = this.newItem(listId, input, userId, at);
        op = { put: this.itemToDb(hh, item), condition: 'attribute_not_exists(pk)' };
      } else {
        const qty = sumQuantity(existing.qty, input.qty, input.unit);
        if (!qtyWithinMax(qty, input.unit))
          return fail.validation(tooMuchMessage(input.unit), 'qty');
        item = {
          ...existing,
          qty,
          note: mergeNotes(existing.note, input.note),
          ticked: false,
          tickedAt: null,
          version: existing.version + 1,
          updatedAt: at,
          updatedBy: userId,
        };
        op = {
          put: this.itemToDb(hh, item),
          condition: '#ver = :v',
          names: { '#ver': 'version' },
          values: { ':v': existing.version },
        };
      }
      try {
        await this.db.transact([this.activeCheck(hh, listId), op]);
        return { item, merged: existing !== null };
      } catch (err) {
        if (!(err instanceof ConditionFailed)) throw err;
        if (err.failed[0]) await this.listNotActive(hh, listId);
        // The row changed under us (other phone added the same product): read and retry.
      }
    }
    throw new Error('addItem: too much contention');
  }

  /**
   * Add many lines (templates into an existing list, D3). Lines are merged together first by
   * the caller; each line is one conditional write (new row or version-checked merge),
   * falling back to addItem's retry loop on a clash.
   */
  async addLines(
    hh: string,
    userId: string,
    listId: string,
    lines: LineInput[],
  ): Promise<LineChange[]> {
    await this.mustGetActive(hh, listId);
    const existing = new Map((await this.items(hh, listId)).map((i) => [i.id, i]));
    const newCount = lines.filter(
      (l) => !existing.has(lineIdFor(l.product.productId, l.unit)),
    ).length;
    if (existing.size + newCount > LIMITS.listItems) {
      return fail.conflict(
        'LIMIT',
        `That would put more than ${LIMITS.listItems} items on the list. Remove something first.`,
      );
    }
    const at = this.now().toISOString();
    return inBatches(lines, BULK_CONCURRENCY, async (line): Promise<LineChange> => {
      const id = lineIdFor(line.product.productId, line.unit);
      const prev = existing.get(id);
      try {
        if (!prev) {
          const item = this.newItem(listId, line, userId, at);
          await this.db.put(this.itemToDb(hh, item), { condition: 'attribute_not_exists(pk)' });
          return { itemId: id, created: true, addedQty: line.qty, version: 1 };
        }
        // Bulk adds cap at the unit max rather than failing the whole request.
        const qty = Math.min(sumQuantity(prev.qty, line.qty, line.unit), ITEM_QTY_MAX[line.unit]);
        const addedQty = roundQuantity(qty - prev.qty, line.unit);
        const item: ListItem = {
          ...prev,
          qty,
          note: mergeNotes(prev.note, line.note),
          ticked: false,
          tickedAt: null,
          version: prev.version + 1,
          updatedAt: at,
          updatedBy: userId,
        };
        await this.db.put(this.itemToDb(hh, item), {
          condition: '#ver = :v',
          names: { '#ver': 'version' },
          values: { ':v': prev.version },
        });
        return { itemId: id, created: false, addedQty, version: item.version };
      } catch (err) {
        if (!(err instanceof ConditionFailed)) throw err;
        const r = await this.addItem(hh, userId, listId, line);
        return { itemId: id, created: !r.merged, addedQty: line.qty, version: r.item.version };
      }
    });
  }

  /**
   * Add lines one by one by the merge rule (Stage 3 bulk add, D-072), reporting each
   * line's outcome instead of failing the whole request: lines past the 200-item limit get
   * LIMIT, a merge past the unit max gets VALIDATION. Each add is addItem's atomic,
   * version-checked write, so Undo semantics match single adds (merged rows unticked).
   */
  async addEach(
    hh: string,
    userId: string,
    listId: string,
    lines: LineInput[],
  ): Promise<
    Array<{ ok: true; change: LineChange } | { ok: false; code: BulkFailCode; message: string }>
  > {
    await this.mustGetActive(hh, listId);
    const existing = new Set((await this.items(hh, listId)).map((i) => i.id));
    let room = LIMITS.listItems - existing.size;
    const plan = lines.map((line) => {
      const id = lineIdFor(line.product.productId, line.unit);
      if (existing.has(id)) return { line, fits: true };
      if (room > 0) {
        room -= 1;
        return { line, fits: true };
      }
      return { line, fits: false };
    });
    return inBatches(plan, BULK_CONCURRENCY, async ({ line, fits }) => {
      if (!fits) {
        return {
          ok: false as const,
          code: 'LIMIT' as const,
          message: `This list is full (${LIMITS.listItems} items). Remove something first.`,
        };
      }
      try {
        const { item, merged } = await this.addItem(hh, userId, listId, line);
        return {
          ok: true as const,
          change: { itemId: item.id, created: !merged, addedQty: line.qty, version: item.version },
        };
      } catch (err) {
        if (!(err instanceof HttpFailure)) throw err;
        return { ok: false as const, ...bulkFailure(err) };
      }
    });
  }

  /**
   * Edit or tick one item. Same unit: one conditional UpdateItem of the row (ticks need no
   * version; content edits need it). Unit change: the row is re-keyed (and merged into a row
   * with the new unit if there is one) in one transaction.
   */
  async updateItem(
    hh: string,
    userId: string,
    listId: string,
    itemId: string,
    edit: EditItemInput,
  ): Promise<{ item: ListItem; replacedItemId?: string }> {
    const parsed = parseLineId(itemId);
    if (!parsed) return fail.notFound();
    const at = this.now().toISOString();
    if (edit.unit !== undefined && edit.unit !== parsed.unit) {
      return this.rekeyItem(hh, userId, listId, itemId, edit, at);
    }
    const sets = ['#ver = #ver + :one', 'updatedAt = :at', 'updatedBy = :by'];
    const values: Record<string, unknown> = { ':one': 1, ':at': at, ':by': userId };
    const names: Record<string, string> = { '#ver': 'version' };
    if (edit.qty !== undefined) {
      sets.push('#qty = :q');
      names['#qty'] = 'qty';
      values[':q'] = edit.qty;
    }
    if (edit.note !== undefined) {
      sets.push('#note = :note');
      names['#note'] = 'note';
      values[':note'] = edit.note;
    }
    if (edit.ticked !== undefined) {
      sets.push('ticked = :t', 'tickedAt = :ta');
      values[':t'] = edit.ticked;
      values[':ta'] = edit.ticked ? at : null;
    }
    let condition = 'attribute_exists(pk)';
    if (edit.version !== undefined) {
      condition += ' AND #ver = :v';
      values[':v'] = edit.version;
    }
    try {
      await this.db.transact([
        this.activeCheck(hh, listId),
        {
          update: this.itemKey(hh, listId, itemId),
          expression: `SET ${sets.join(', ')}`,
          condition,
          names,
          values,
        },
      ]);
    } catch (err) {
      if (!(err instanceof ConditionFailed)) throw err;
      if (err.failed[0]) await this.listNotActive(hh, listId);
      const current = await this.getItem(hh, listId, itemId);
      if (!current) return fail.notFound();
      return fail.conflict('STALE', 'Changed on another phone', current);
    }
    const item = await this.getItem(hh, listId, itemId);
    return { item: item ?? fail.notFound() };
  }

  private async rekeyItem(
    hh: string,
    userId: string,
    listId: string,
    itemId: string,
    edit: EditItemInput,
    at: string,
  ): Promise<{ item: ListItem; replacedItemId: string }> {
    const existing = await this.getItem(hh, listId, itemId);
    if (!existing) return fail.notFound();
    if (edit.version !== existing.version) {
      return fail.conflict('STALE', 'Changed on another phone', existing);
    }
    const newUnit = edit.unit ?? existing.unit;
    const target = await this.getItem(hh, listId, lineIdFor(existing.product.productId, newUnit));
    let r: ReturnType<typeof editLine<ListItem>>;
    try {
      r = editLine(
        target ? [existing, target] : [existing],
        itemId,
        {
          ...(edit.qty !== undefined ? { qty: edit.qty } : {}),
          ...(edit.unit !== undefined ? { unit: edit.unit } : {}),
          ...(edit.note !== undefined ? { note: edit.note } : {}),
        },
        at,
      );
    } catch (err) {
      if (err instanceof QuantityTooLargeError) return fail.validation(err.message, 'qty');
      throw err;
    }
    const ticked = edit.ticked ?? (r.merged ? false : existing.ticked);
    const item: ListItem = {
      ...r.item,
      ticked,
      tickedAt: ticked ? (r.item.tickedAt ?? at) : null,
      updatedBy: userId,
    };
    try {
      await this.db.transact([
        this.activeCheck(hh, listId),
        {
          delete: this.itemKey(hh, listId, itemId),
          condition: '#ver = :v',
          names: { '#ver': 'version' },
          values: { ':v': existing.version },
        },
        target
          ? {
              put: this.itemToDb(hh, item),
              condition: '#ver = :tv',
              names: { '#ver': 'version' },
              values: { ':tv': target.version },
            }
          : { put: this.itemToDb(hh, item), condition: 'attribute_not_exists(pk)' },
      ]);
    } catch (err) {
      if (!(err instanceof ConditionFailed)) throw err;
      if (err.failed[0]) await this.listNotActive(hh, listId);
      const current = await this.getItem(hh, listId, itemId);
      if (!current) return fail.notFound();
      return fail.conflict('STALE', 'Changed on another phone', current);
    }
    return { item, replacedItemId: itemId };
  }

  /** Delete an item (D7). With `version`, 409 if the other phone changed it. */
  async deleteItem(hh: string, listId: string, itemId: string, version?: number): Promise<void> {
    try {
      await this.db.transact([
        this.activeCheck(hh, listId),
        {
          delete: this.itemKey(hh, listId, itemId),
          condition:
            version !== undefined ? 'attribute_exists(pk) AND #ver = :v' : 'attribute_exists(pk)',
          ...(version !== undefined
            ? { names: { '#ver': 'version' }, values: { ':v': version } }
            : {}),
        },
      ]);
    } catch (err) {
      if (!(err instanceof ConditionFailed)) throw err;
      if (err.failed[0]) await this.listNotActive(hh, listId);
      const current = await this.getItem(hh, listId, itemId);
      if (!current) return fail.notFound();
      return fail.conflict('STALE', 'Changed on another phone', current);
    }
  }

  // ------------------------------------------------------------------ archive (D-049, D-050)

  /**
   * Archive if still active (conditional, so exactly once under races, F3), then write one
   * purchase row per ticked item. Returns null if the list was no longer active.
   */
  async archive(
    hh: string,
    listId: string,
    items: readonly ListItem[],
    mode: 'auto' | 'finish',
  ): Promise<ListRecord | null> {
    const at = this.now().toISOString();
    const { ticked, total } = listProgress(items);
    let row: DbItem;
    try {
      row = await this.db.update(
        this.listKey(hh, listId),
        'SET #status = :archived, completedAt = :at, finishedBy = :mode, itemCount = :n, ' +
          'boughtCount = :b, gsi2pk = :gpk, gsi2sk = :gsk, #ver = #ver + :one, updatedAt = :at',
        {
          condition: '#status = :active',
          names: { '#status': 'status', '#ver': 'version' },
          values: {
            ':archived': 'archived',
            ':active': 'active',
            ':at': at,
            ':mode': mode,
            ':n': total,
            ':b': ticked,
            ':gpk': keys.listsGsi2Pk(hh, 'archived'),
            ':gsk': keys.listsGsi2Sk(at, listId),
            ':one': 1,
          },
        },
      );
    } catch (err) {
      if (err instanceof ConditionFailed) return null;
      throw err;
    }
    await this.db.batchWrite(
      purchasesForList(listId, at, items).map((p) => ({
        put: {
          pk: keys.householdPk(hh),
          sk: purchaseSortKey(p),
          entity: 'Purchase',
          ...p,
        },
      })),
    );
    return toListRecord(row);
  }

  /** Tick-completes-list check (F1). Returns the archived record if this call archived it. */
  async archiveIfComplete(hh: string, listId: string, items: readonly ListItem[]) {
    return isListComplete(items) ? this.archive(hh, listId, items, 'auto') : null;
  }

  /** "Finish shop" (F2): archive with unticked items recorded as not bought. */
  async finish(hh: string, listId: string): Promise<void> {
    await this.mustGetActive(hh, listId);
    const items = await this.items(hh, listId);
    const rec = await this.archive(hh, listId, items, 'finish');
    if (!rec) await this.listNotActive(hh, listId);
  }

  /**
   * Undo an archive (D-049): back to active with items as they were (all ticked after an
   * auto-archive), purchase rows removed. Only within the undo window.
   */
  async reopen(hh: string, listId: string, canUndo: (r: ListRecord) => boolean): Promise<void> {
    const rec = await this.mustGetRecord(hh, listId);
    if (rec.status !== 'archived' || !rec.completedAt) {
      return fail.conflict('NOT_ARCHIVED', 'This list is not archived.');
    }
    if (!canUndo(rec)) {
      return fail.conflict('UNDO_EXPIRED', 'Too late to undo. The list stays in History.');
    }
    await this.assertActiveLimit(hh);
    const items = await this.items(hh, listId);
    try {
      await this.db.update(
        this.listKey(hh, listId),
        'SET #status = :active, gsi2pk = :gpk, gsi2sk = :gsk, #ver = #ver + :one, updatedAt = :at ' +
          'REMOVE completedAt, finishedBy, itemCount, boughtCount',
        {
          condition: '#status = :archived AND completedAt = :c',
          names: { '#status': 'status', '#ver': 'version' },
          values: {
            ':active': 'active',
            ':archived': 'archived',
            ':c': rec.completedAt,
            ':gpk': keys.listsGsi2Pk(hh, 'active'),
            ':gsk': keys.listsGsi2Sk(rec.createdAt, listId),
            ':one': 1,
            ':at': this.now().toISOString(),
          },
        },
      );
    } catch (err) {
      if (err instanceof ConditionFailed) {
        return fail.conflict('NOT_ARCHIVED', 'This list is not archived.');
      }
      throw err;
    }
    await this.db.batchWrite(
      purchasesForList(listId, rec.completedAt, items).map((p) => ({
        delete: { pk: keys.householdPk(hh), sk: purchaseSortKey(p) },
      })),
    );
  }
}
