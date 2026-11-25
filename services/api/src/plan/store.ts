/**
 * Meal-plan entries (HH#<hh> / PLAN#<date>#<id>, D-117). The date in the sort key makes a
 * week one BETWEEN query; moving to another day is a delete + put in one transaction.
 * Writes are conditional on the row version (409 STALE).
 */
import { randomUUID } from 'node:crypto';
import {
  keys,
  MEAL_PLAN_LIMITS,
  PLAN_MEALS,
  sortPlanEntries,
  type MealPlanEntry,
  type MovePlanEntryRequest,
  type PlanMeal,
} from '@trolley/core';
import { ConditionFailed, type Db, type DbItem } from '../db';
import { fail } from '../http';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function toEntry(row: DbItem): MealPlanEntry | null {
  if (row.entity !== 'PlanEntry' || typeof row.id !== 'string' || typeof row.date !== 'string') {
    return null;
  }
  const meal = (PLAN_MEALS as readonly unknown[]).includes(row.meal)
    ? (row.meal as PlanMeal)
    : null;
  const kind = row.kind === 'recipe' ? 'recipe' : 'text';
  return {
    id: row.id,
    date: row.date,
    meal,
    kind,
    ...(kind === 'recipe' && typeof row.recipeId === 'string' ? { recipeId: row.recipeId } : {}),
    ...(kind === 'text' ? { text: str(row.text) } : {}),
    ...(str(row.note) ? { note: str(row.note) } : {}),
    order: typeof row.order === 'number' ? row.order : 0,
    version: typeof row.version === 'number' ? row.version : 1,
    createdAt: str(row.createdAt),
    updatedAt: str(row.updatedAt),
  };
}

export interface NewEntry {
  date: string;
  meal: PlanMeal | null;
  kind: 'recipe' | 'text';
  recipeId?: string;
  text?: string;
  note: string;
  order?: number;
}

export class PlanStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  private key(hh: string, date: string, id: string) {
    return { pk: keys.householdPk(hh), sk: keys.planSk(date, id) };
  }

  private toDb(hh: string, e: MealPlanEntry): DbItem {
    return {
      ...this.key(hh, e.date, e.id),
      entity: 'PlanEntry',
      id: e.id,
      date: e.date,
      meal: e.meal,
      kind: e.kind,
      ...(e.recipeId ? { recipeId: e.recipeId } : {}),
      ...(e.text !== undefined ? { text: e.text } : {}),
      ...(e.note ? { note: e.note } : {}),
      order: e.order,
      version: e.version,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }

  /** Entries from..to inclusive, in date then slot order. */
  async range(hh: string, from: string, to: string): Promise<MealPlanEntry[]> {
    const b = keys.planRange(from, to);
    const rows = await this.db.queryBetween(keys.householdPk(hh), b.from, b.to);
    const entries = rows.flatMap((r) => {
      const e = toEntry(r);
      return e ? [e] : [];
    });
    const byDate = new Map<string, MealPlanEntry[]>();
    for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
    return [...byDate.keys()].sort().flatMap((d) => sortPlanEntries(byDate.get(d) ?? []));
  }

  private async day(hh: string, date: string): Promise<MealPlanEntry[]> {
    const rows = await this.db.queryAll(keys.householdPk(hh), keys.planDayPrefix(date));
    return rows.flatMap((r) => {
      const e = toEntry(r);
      return e ? [e] : [];
    });
  }

  private async checkRoom(hh: string, date: string): Promise<MealPlanEntry[]> {
    const day = await this.day(hh, date);
    if (day.length >= MEAL_PLAN_LIMITS.perDay) {
      return fail.conflict(
        'LIMIT',
        `A day can have up to ${MEAL_PLAN_LIMITS.perDay} entries. Remove one first.`,
      );
    }
    return day;
  }

  async get(hh: string, date: string, id: string): Promise<MealPlanEntry | null> {
    const row = await this.db.get(this.key(hh, date, id));
    return row ? toEntry(row) : null;
  }

  async mustGet(hh: string, date: string, id: string): Promise<MealPlanEntry> {
    return (await this.get(hh, date, id)) ?? fail.notFound();
  }

  async create(hh: string, input: NewEntry): Promise<MealPlanEntry> {
    const day = await this.checkRoom(hh, input.date);
    const at = this.now().toISOString();
    const e: MealPlanEntry = {
      id: this.newId(),
      date: input.date,
      meal: input.meal,
      kind: input.kind,
      ...(input.recipeId ? { recipeId: input.recipeId } : {}),
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.note ? { note: input.note } : {}),
      order: input.order ?? Math.max(-1, ...day.map((d) => d.order)) + 1,
      version: 1,
      createdAt: at,
      updatedAt: at,
    };
    await this.db.put(this.toDb(hh, e), { condition: 'attribute_not_exists(pk)' });
    return e;
  }

  async update(
    hh: string,
    date: string,
    id: string,
    patch: { version: number; text?: string; note?: string },
  ): Promise<MealPlanEntry> {
    const read = await this.mustGet(hh, date, id);
    if (read.version !== patch.version) {
      return fail.conflict('STALE', 'Changed on another phone', read);
    }
    if (patch.text !== undefined && read.kind !== 'text') {
      return fail.validation('Only text entries have text.', 'text');
    }
    const { note: _drop, ...rest } = read;
    const note = patch.note === undefined ? read.note : patch.note;
    const next: MealPlanEntry = {
      ...rest,
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(note ? { note } : {}),
      version: read.version + 1,
      updatedAt: this.now().toISOString(),
    };
    return this.write(hh, read, next, [
      {
        put: this.toDb(hh, next),
        condition: '#ver = :v',
        names: { '#ver': 'version' },
        values: { ':v': read.version },
      },
    ]);
  }

  /** Change day, meal and/or position. A different day is one delete + put transaction. */
  async move(
    hh: string,
    date: string,
    id: string,
    to: MovePlanEntryRequest,
  ): Promise<MealPlanEntry> {
    const read = await this.mustGet(hh, date, id);
    if (read.version !== to.version) {
      return fail.conflict('STALE', 'Changed on another phone', read);
    }
    const sameDay = to.date === date;
    const target = sameDay ? [] : await this.checkRoom(hh, to.date);
    const siblings = sameDay ? await this.day(hh, date) : target;
    const order =
      to.order ??
      (sameDay && to.meal === read.meal
        ? read.order
        : Math.max(-1, ...siblings.filter((s) => s.id !== id).map((s) => s.order)) + 1);
    const next: MealPlanEntry = {
      ...read,
      date: to.date,
      meal: to.meal,
      order,
      version: read.version + 1,
      updatedAt: this.now().toISOString(),
    };
    const cond = {
      condition: '#ver = :v',
      names: { '#ver': 'version' },
      values: { ':v': read.version },
    };
    return this.write(
      hh,
      read,
      next,
      sameDay
        ? [{ put: this.toDb(hh, next), ...cond }]
        : [
            { delete: this.key(hh, date, id), ...cond },
            { put: this.toDb(hh, next), condition: 'attribute_not_exists(pk)' },
          ],
    );
  }

  private async write(
    hh: string,
    read: MealPlanEntry,
    next: MealPlanEntry,
    ops: Parameters<Db['transact']>[0],
  ): Promise<MealPlanEntry> {
    try {
      await this.db.transact(ops);
    } catch (err) {
      if (!(err instanceof ConditionFailed)) throw err;
      const current = await this.get(hh, read.date, read.id);
      return current
        ? fail.conflict('STALE', 'Changed on another phone', current)
        : fail.notFound();
    }
    return next;
  }

  async delete(hh: string, date: string, id: string): Promise<void> {
    try {
      await this.db.delete(this.key(hh, date, id), { condition: 'attribute_exists(pk)' });
    } catch (err) {
      if (err instanceof ConditionFailed) return fail.notFound();
      throw err;
    }
  }
}
