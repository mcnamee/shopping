/**
 * Recurring meals (docs/stages/stage-6b.md, D-124 to D-128): rule type, validation and the
 * pure occurrence maths. Occurrences are computed for a date range, never stored. All dates
 * are plain YYYY-MM-DD strings handled as UTC day numbers, so daylight saving cannot shift
 * a day or break the every-N-weeks parity.
 */
import { ENTITY_ID_PATTERN, cleanText, type Parsed } from './lists';
import {
  MEAL_PLAN_LIMITS,
  PLAN_MEALS,
  addDays,
  isPlanDate,
  planDaysBetween,
  type PlanMeal,
} from './meal-plan';

export const PLAN_RULE_LIMITS = {
  /** Rules per household. */
  perHousehold: 30,
  maxEveryWeeks: 4,
} as const;

/** ISO weekday: Monday = 1 ... Sunday = 7. */
export type PlanWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const PLAN_WEEKDAYS: readonly PlanWeekday[] = [1, 2, 3, 4, 5, 6, 7];

export interface PlanRule {
  id: string;
  kind: 'recipe' | 'text';
  recipeId?: string;
  text?: string;
  meal: PlanMeal | null;
  weekday: PlanWeekday;
  /** 1 = every week, 2 = every second week ... */
  everyWeeks: number;
  /** First occurrence (falls on `weekday`); weeks are counted from it. */
  startDate: string;
  /** Last day an occurrence can fall on (inclusive). */
  endDate?: string;
  note?: string;
  paused: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** One computed occurrence of a rule. */
export interface PlanOccurrence {
  ruleId: string;
  recurring: true;
  date: string;
  meal: PlanMeal | null;
  kind: 'recipe' | 'text';
  recipeId?: string;
  text?: string;
  note?: string;
}

export interface PlanRulesResponse {
  rules: PlanRule[];
}

export interface PlanRuleRequest {
  kind: 'recipe' | 'text';
  recipeId?: string;
  text?: string;
  meal?: PlanMeal | null;
  weekday: PlanWeekday;
  everyWeeks: number;
  startDate: string;
  endDate?: string | null;
  note?: string | null;
  paused?: boolean;
}

export interface UpdatePlanRuleRequest extends PlanRuleRequest {
  version: number;
}

// ---------------------------------------------------------------------------------------
// Date maths

/** ISO weekday (Mon = 1 ... Sun = 7) of a YYYY-MM-DD date. */
export function planWeekday(date: string): PlanWeekday {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return (dow === 0 ? 7 : dow) as PlanWeekday;
}

/** The first date on or after `date` that falls on `weekday`. */
export function nextWeekdayOnOrAfter(date: string, weekday: PlanWeekday): string {
  return addDays(date, (weekday - planWeekday(date) + 7) % 7);
}

/** Whether `date` is an occurrence of `rule` (ignores `paused`: that is the caller's call). */
export function fallsOnRule(
  rule: Pick<PlanRule, 'weekday' | 'everyWeeks' | 'startDate' | 'endDate'>,
  date: string,
): boolean {
  if (date < rule.startDate) return false;
  if (rule.endDate && date > rule.endDate) return false;
  if (planWeekday(date) !== rule.weekday) return false;
  return (planDaysBetween(rule.startDate, date) / 7) % rule.everyWeeks === 0;
}

/** Dates in `from`..`to` (inclusive) the rule falls on. Paused rules have none. */
export function ruleDates(rule: PlanRule, from: string, to: string): string[] {
  if (rule.paused || to < from) return [];
  const first = from > rule.startDate ? from : rule.startDate;
  const last = rule.endDate && rule.endDate < to ? rule.endDate : to;
  if (last < first) return [];
  // Jump to the first matching weekday, then step by whole fortnights/weeks.
  let d = nextWeekdayOnOrAfter(first, rule.weekday);
  const weeksIn = planDaysBetween(rule.startDate, d) / 7;
  const off = (rule.everyWeeks - (weeksIn % rule.everyWeeks)) % rule.everyWeeks;
  d = addDays(d, off * 7);
  const out: string[] = [];
  for (; d <= last; d = addDays(d, rule.everyWeeks * 7)) out.push(d);
  return out;
}

/** The next occurrence on or after `from`, or null when paused or the rule has ended. */
export function nextRuleDate(rule: PlanRule, from: string): string | null {
  if (rule.paused) return null;
  const horizon = addDays(from > rule.startDate ? from : rule.startDate, 7 * rule.everyWeeks);
  return ruleDates(rule, from, horizon)[0] ?? null;
}

export const skipKey = (ruleId: string, date: string): string => `${ruleId}#${date}`;

/** Slot order within a day: breakfast, lunch, dinner, untimed. */
const slot = (m: PlanMeal | null) => (m === null ? 3 : PLAN_MEALS.indexOf(m));

/**
 * Occurrences of `rules` in `from`..`to` minus `skips` (keys from `skipKey`), sorted by date,
 * meal slot, then rule id.
 */
export function expandOccurrences(
  rules: readonly PlanRule[],
  skips: ReadonlySet<string>,
  from: string,
  to: string,
): PlanOccurrence[] {
  const out: PlanOccurrence[] = [];
  for (const r of rules) {
    for (const date of ruleDates(r, from, to)) {
      if (skips.has(skipKey(r.id, date))) continue;
      out.push({
        ruleId: r.id,
        recurring: true,
        date,
        meal: r.meal,
        kind: r.kind,
        ...(r.kind === 'recipe' && r.recipeId ? { recipeId: r.recipeId } : {}),
        ...(r.kind === 'text' ? { text: r.text ?? '' } : {}),
        ...(r.note ? { note: r.note } : {}),
      });
    }
  }
  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      slot(a.meal) - slot(b.meal) ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

// ---------------------------------------------------------------------------------------
// Validation

const fail = (message: string, field?: string): { ok: false; message: string; field?: string } =>
  field ? { ok: false, message, field } : { ok: false, message };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export type ParsedPlanRule = Omit<PlanRule, 'id' | 'version' | 'createdAt' | 'updatedAt'>;

export function parsePlanRule(body: unknown): Parsed<ParsedPlanRule> {
  if (!isObject(body)) return { ok: false, message: 'Body must be a JSON object' };
  let meal: PlanMeal | null = null;
  if (body.meal !== undefined && body.meal !== null) {
    if (typeof body.meal !== 'string' || !(PLAN_MEALS as readonly string[]).includes(body.meal)) {
      return fail('meal must be breakfast, lunch, dinner or null', 'meal');
    }
    meal = body.meal as PlanMeal;
  }
  const weekday = body.weekday;
  if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    return fail('weekday must be 1 (Monday) to 7 (Sunday)', 'weekday');
  }
  const everyWeeks = body.everyWeeks;
  if (
    typeof everyWeeks !== 'number' ||
    !Number.isInteger(everyWeeks) ||
    everyWeeks < 1 ||
    everyWeeks > PLAN_RULE_LIMITS.maxEveryWeeks
  ) {
    return fail(`everyWeeks must be 1 to ${PLAN_RULE_LIMITS.maxEveryWeeks}`, 'everyWeeks');
  }
  if (!isPlanDate(body.startDate)) return fail('startDate must be YYYY-MM-DD', 'startDate');
  if (planWeekday(body.startDate) !== weekday) {
    return fail('startDate must fall on the chosen weekday', 'startDate');
  }
  let endDate: string | undefined;
  if (body.endDate !== undefined && body.endDate !== null && body.endDate !== '') {
    if (!isPlanDate(body.endDate)) return fail('endDate must be YYYY-MM-DD', 'endDate');
    if (body.endDate < body.startDate)
      return fail('End date must not be before the start.', 'endDate');
    endDate = body.endDate;
  }
  let note = '';
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') return fail('note must be text', 'note');
    note = cleanText(body.note);
    if (note.length > MEAL_PLAN_LIMITS.note) {
      return fail(`Keep the note to ${MEAL_PLAN_LIMITS.note} characters or fewer.`, 'note');
    }
  }
  if (body.paused !== undefined && typeof body.paused !== 'boolean') {
    return fail('paused must be true or false', 'paused');
  }
  const base = {
    meal,
    weekday: weekday as PlanWeekday,
    everyWeeks,
    startDate: body.startDate,
    ...(endDate ? { endDate } : {}),
    ...(note ? { note } : {}),
    paused: body.paused === true,
  };
  if (body.kind === 'recipe') {
    if (typeof body.recipeId !== 'string' || !ENTITY_ID_PATTERN.test(body.recipeId)) {
      return fail('Choose a recipe.', 'recipeId');
    }
    return { ok: true, value: { ...base, kind: 'recipe', recipeId: body.recipeId } };
  }
  if (body.kind === 'text') {
    const text = typeof body.text === 'string' ? cleanText(body.text) : '';
    if (!text) return fail('Enter some text.', 'text');
    if (text.length > MEAL_PLAN_LIMITS.text) {
      return fail(`Keep the text to ${MEAL_PLAN_LIMITS.text} characters or fewer.`, 'text');
    }
    return { ok: true, value: { ...base, kind: 'text', text } };
  }
  return fail('kind must be recipe or text', 'kind');
}

export function parseUpdatePlanRule(body: unknown): Parsed<ParsedPlanRule & { version: number }> {
  const rule = parsePlanRule(body);
  if (!rule.ok) return rule;
  const v = (body as Record<string, unknown>).version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    return fail('version is required', 'version');
  }
  return { ok: true, value: { ...rule.value, version: v } };
}
