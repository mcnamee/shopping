/**
 * Templates (HH#<hh> / TEMPLATE#<id>, items embedded; spec 5.1, A4). Every write is a
 * conditional Put on the template `version` (optimistic concurrency). Adds from search
 * retry on a version clash, so two phones adding to one template never lose an item;
 * edits and renames carry the client's version and 409 when stale (H3).
 */
import { randomUUID } from 'node:crypto';
import {
  addLine,
  editLine,
  isTemplateType,
  keys,
  LIMITS,
  QuantityTooLargeError,
  type LineChangeInput,
  type LineInput,
  type TemplateItem,
  type TemplateType,
} from '@trolley/core';
import { ConditionFailed, type Db, type DbItem } from '../db';
import { fail } from '../http';
import { lineFields, toLine } from '../lines';

export interface TemplateRecord {
  id: string;
  name: string;
  type: TemplateType;
  items: TemplateItem[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

const MAX_RETRIES = 5;

export function toTemplate(item: DbItem): TemplateRecord | null {
  if (item.entity !== 'Template' || typeof item.id !== 'string' || typeof item.name !== 'string') {
    return null;
  }
  const items = Array.isArray(item.items)
    ? item.items.flatMap((v) => {
        const l = toLine(v);
        return l ? [l] : [];
      })
    : [];
  return {
    id: item.id,
    name: item.name,
    type: isTemplateType(item.type) ? item.type : 'weekly',
    items,
    version: typeof item.version === 'number' ? item.version : 1,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
  };
}

export class TemplateStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  private key(householdId: string, id: string) {
    return { pk: keys.householdPk(householdId), sk: keys.templateSk(id) };
  }

  private toItem(householdId: string, t: TemplateRecord): DbItem {
    return {
      ...this.key(householdId, t.id),
      entity: 'Template',
      id: t.id,
      name: t.name,
      type: t.type,
      items: t.items.map(lineFields),
      itemCount: t.items.length,
      version: t.version,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  async list(householdId: string): Promise<TemplateRecord[]> {
    const rows = await this.db.queryAll(keys.householdPk(householdId), keys.templateSkPrefix);
    return rows.flatMap((r) => {
      const t = toTemplate(r);
      return t ? [t] : [];
    });
  }

  async get(householdId: string, id: string): Promise<TemplateRecord | null> {
    const row = await this.db.get(this.key(householdId, id));
    return row ? toTemplate(row) : null;
  }

  async mustGet(householdId: string, id: string): Promise<TemplateRecord> {
    return (await this.get(householdId, id)) ?? fail.notFound();
  }

  async create(householdId: string, input: { name: string; type: TemplateType }) {
    const count = await this.db.count(keys.householdPk(householdId), keys.templateSkPrefix);
    if (count >= LIMITS.templates) {
      return fail.conflict(
        'LIMIT',
        `You have ${LIMITS.templates} templates, which is the most Trolley allows. Delete one first.`,
      );
    }
    const at = this.now().toISOString();
    const t: TemplateRecord = {
      id: this.newId(),
      name: input.name,
      type: input.type,
      items: [],
      version: 1,
      createdAt: at,
      updatedAt: at,
    };
    await this.db.put(this.toItem(householdId, t), { condition: 'attribute_not_exists(pk)' });
    return t;
  }

  /** Replace the template if its version is unchanged since `read`. */
  private async save(householdId: string, read: TemplateRecord, next: TemplateRecord) {
    await this.db.put(this.toItem(householdId, next), {
      condition: 'version = :v',
      values: { ':v': read.version },
    });
  }

  async update(
    householdId: string,
    id: string,
    input: { name?: string; type?: TemplateType; version: number },
  ): Promise<TemplateRecord> {
    const read = await this.mustGet(householdId, id);
    if (read.version !== input.version) {
      return fail.conflict('STALE', 'Changed on another phone', read);
    }
    const next: TemplateRecord = {
      ...read,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      version: read.version + 1,
      updatedAt: this.now().toISOString(),
    };
    try {
      await this.save(householdId, read, next);
    } catch (err) {
      if (err instanceof ConditionFailed) {
        const current = await this.get(householdId, id);
        return current
          ? fail.conflict('STALE', 'Changed on another phone', current)
          : fail.notFound();
      }
      throw err;
    }
    return next;
  }

  async delete(householdId: string, id: string): Promise<void> {
    try {
      await this.db.delete(this.key(householdId, id), { condition: 'attribute_exists(pk)' });
    } catch (err) {
      if (err instanceof ConditionFailed) return fail.notFound();
      throw err;
    }
  }

  /** Read-modify-write with retry on a concurrent change (no lost adds). */
  private async mutate<R>(
    householdId: string,
    id: string,
    change: (read: TemplateRecord, at: string) => { next: TemplateRecord; result: R },
  ): Promise<{ template: TemplateRecord; result: R }> {
    for (let attempt = 1; ; attempt += 1) {
      const read = await this.mustGet(householdId, id);
      const { next, result } = change(read, this.now().toISOString());
      try {
        await this.save(householdId, read, next);
        return { template: next, result };
      } catch (err) {
        if (!(err instanceof ConditionFailed) || attempt >= MAX_RETRIES) throw err;
      }
    }
  }

  async addItem(householdId: string, id: string, input: LineInput) {
    return this.mutate(householdId, id, (read, at) => {
      let r: ReturnType<typeof addLine>;
      try {
        r = addLine(read.items, input, at);
      } catch (err) {
        if (err instanceof QuantityTooLargeError) return fail.validation(err.message, 'qty');
        throw err;
      }
      if (!r.merged && read.items.length >= LIMITS.templateItems) {
        return fail.conflict(
          'LIMIT',
          `This template is full (${LIMITS.templateItems} items). Remove something first.`,
        );
      }
      return {
        next: { ...read, items: r.items, version: read.version + 1, updatedAt: at },
        result: { item: r.item, merged: r.merged },
      };
    });
  }

  /** Edit one item; `version` is the item's version (H3). */
  async editItem(
    householdId: string,
    id: string,
    itemId: string,
    change: LineChangeInput,
    version: number,
  ) {
    return this.mutate(householdId, id, (read, at) => {
      const existing = read.items.find((i) => i.id === itemId);
      if (!existing) return fail.notFound();
      if (existing.version !== version) {
        return fail.conflict('STALE', 'Changed on another phone', read);
      }
      let r: ReturnType<typeof editLine<TemplateItem>>;
      try {
        r = editLine(read.items, itemId, change, at);
      } catch (err) {
        if (err instanceof QuantityTooLargeError) return fail.validation(err.message, 'qty');
        throw err;
      }
      return {
        next: { ...read, items: r.items, version: read.version + 1, updatedAt: at },
        result: r,
      };
    });
  }

  async deleteItem(householdId: string, id: string, itemId: string) {
    return this.mutate(householdId, id, (read, at) => {
      if (!read.items.some((i) => i.id === itemId)) return fail.notFound();
      return {
        next: {
          ...read,
          items: read.items.filter((i) => i.id !== itemId),
          version: read.version + 1,
          updatedAt: at,
        },
        result: null,
      };
    });
  }
}
