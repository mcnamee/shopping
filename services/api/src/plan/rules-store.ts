/**
 * Recurring meal rules (HH#<hh> / PLANRULE#<id>, D-124) and per-occurrence skips
 * (PLANSKIP#<ruleId>#<date>, D-125). Occurrences are computed in @trolley/core, not stored.
 * Rule writes are conditional on the row version (409 STALE).
 */
import { randomUUID } from 'node:crypto';
import {
  expandOccurrences,
  keys,
  PLAN_MEALS,
  PLAN_RULE_LIMITS,
  skipKey,
  type ParsedPlanRule,
  type PlanMeal,
  type PlanOccurrence,
  type PlanRule,
  type PlanWeekday,
} from '@trolley/core';
import { ConditionFailed, type Db, type DbItem } from '../db';
import { fail } from '../http';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function toRule(row: DbItem): PlanRule | null {
  if (row.entity !== 'PlanRule' || typeof row.id !== 'string') return null;
  const kind = row.kind === 'recipe' ? 'recipe' : 'text';
  return {
    id: row.id,
    kind,
    ...(kind === 'recipe' && typeof row.recipeId === 'string' ? { recipeId: row.recipeId } : {}),
    ...(kind === 'text' ? { text: str(row.text) } : {}),
    meal: (PLAN_MEALS as readonly unknown[]).includes(row.meal) ? (row.meal as PlanMeal) : null,
    weekday: (typeof row.weekday === 'number' ? row.weekday : 1) as PlanWeekday,
    everyWeeks: typeof row.everyWeeks === 'number' ? row.everyWeeks : 1,
    startDate: str(row.startDate),
    ...(str(row.endDate) ? { endDate: str(row.endDate) } : {}),
    ...(str(row.note) ? { note: str(row.note) } : {}),
    paused: row.paused === true,
    version: typeof row.version === 'number' ? row.version : 1,
    createdAt: str(row.createdAt),
    updatedAt: str(row.updatedAt),
  };
}

export class PlanRuleStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  private key(hh: string, id: string) {
    return { pk: keys.householdPk(hh), sk: keys.planRuleSk(id) };
  }

  private toDb(hh: string, r: PlanRule): DbItem {
    return {
      ...this.key(hh, r.id),
      entity: 'PlanRule',
      id: r.id,
      kind: r.kind,
      ...(r.recipeId ? { recipeId: r.recipeId } : {}),
      ...(r.text !== undefined ? { text: r.text } : {}),
      meal: r.meal,
      weekday: r.weekday,
      everyWeeks: r.everyWeeks,
      startDate: r.startDate,
      ...(r.endDate ? { endDate: r.endDate } : {}),
      ...(r.note ? { note: r.note } : {}),
      paused: r.paused,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  /** All rules, oldest first. */
  async list(hh: string): Promise<PlanRule[]> {
    const rows = await this.db.queryAll(keys.householdPk(hh), keys.planRuleSkPrefix);
    return rows
      .flatMap((r) => {
        const rule = toRule(r);
        return rule ? [rule] : [];
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async get(hh: string, id: string): Promise<PlanRule | null> {
    const row = await this.db.get(this.key(hh, id));
    return row ? toRule(row) : null;
  }

  async mustGet(hh: string, id: string): Promise<PlanRule> {
    return (await this.get(hh, id)) ?? fail.notFound();
  }

  async create(hh: string, input: ParsedPlanRule): Promise<PlanRule> {
    if ((await this.list(hh)).length >= PLAN_RULE_LIMITS.perHousehold) {
      return fail.conflict(
        'LIMIT',
        `You can have up to ${PLAN_RULE_LIMITS.perHousehold} recurring meals. Remove one first.`,
      );
    }
    const at = this.now().toISOString();
    const rule: PlanRule = { ...input, id: this.newId(), version: 1, createdAt: at, updatedAt: at };
    await this.db.put(this.toDb(hh, rule), { condition: 'attribute_not_exists(pk)' });
    return rule;
  }

  async replace(
    hh: string,
    id: string,
    input: ParsedPlanRule & { version: number },
  ): Promise<PlanRule> {
    const read = await this.mustGet(hh, id);
    if (read.version !== input.version) {
      return fail.conflict('STALE', 'Changed on another phone', read);
    }
    const { version: _v, ...fields } = input;
    const next: PlanRule = {
      ...fields,
      id,
      version: read.version + 1,
      createdAt: read.createdAt,
      updatedAt: this.now().toISOString(),
    };
    try {
      await this.db.transact([
        {
          put: this.toDb(hh, next),
          condition: '#ver = :v',
          names: { '#ver': 'version' },
          values: { ':v': read.version },
        },
      ]);
    } catch (err) {
      if (!(err instanceof ConditionFailed)) throw err;
      const current = await this.get(hh, id);
      return current
        ? fail.conflict('STALE', 'Changed on another phone', current)
        : fail.notFound();
    }
    return next;
  }

  /** Deletes the rule and its skips. */
  async delete(hh: string, id: string): Promise<void> {
    try {
      await this.db.delete(this.key(hh, id), { condition: 'attribute_exists(pk)' });
    } catch (err) {
      if (err instanceof ConditionFailed) return fail.notFound();
      throw err;
    }
    const skips = await this.db.queryAll(keys.householdPk(hh), keys.planSkipRulePrefix(id));
    await Promise.all(skips.map((s) => this.db.delete({ pk: String(s.pk), sk: String(s.sk) })));
  }

  async skip(hh: string, ruleId: string, date: string): Promise<void> {
    await this.db.put({
      pk: keys.householdPk(hh),
      sk: keys.planSkipSk(ruleId, date),
      entity: 'PlanSkip',
      ruleId,
      date,
      createdAt: this.now().toISOString(),
    });
  }

  async unskip(hh: string, ruleId: string, date: string): Promise<void> {
    await this.db.delete({ pk: keys.householdPk(hh), sk: keys.planSkipSk(ruleId, date) });
  }

  /** Occurrences in from..to minus skips (one BETWEEN query per rule that has any). */
  async occurrences(hh: string, from: string, to: string): Promise<PlanOccurrence[]> {
    const rules = (await this.list(hh)).filter((r) => !r.paused);
    const skips = new Set<string>();
    await Promise.all(
      rules.map(async (r) => {
        const b = keys.planSkipRuleRange(r.id, from, to);
        const rows = await this.db.queryBetween(keys.householdPk(hh), b.from, b.to);
        for (const row of rows) skips.add(skipKey(r.id, str(row.date)));
      }),
    );
    return expandOccurrences(rules, skips, from, to);
  }
}
