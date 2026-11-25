/**
 * Meal planner (Stage 6, D-117 to D-121, docs/stages/stage-6.md): entry types, limits,
 * request validation and Monday-start week arithmetic. Pure, shared by services/api and
 * the web mock. Dates are plain YYYY-MM-DD strings in Canberra time (no time zones here).
 */
import { ENTITY_ID_PATTERN, cleanText, type Parsed } from './lists';

export const MEAL_PLAN_LIMITS = {
  /** Entries on one day. */
  perDay: 20,
  text: 100,
  note: 200,
  /** Widest GET /plan range, in days between `from` and `to`. */
  rangeDays: 62,
} as const;

export const PLAN_MEALS = ['breakfast', 'lunch', 'dinner'] as const;
export type PlanMeal = (typeof PLAN_MEALS)[number];

export interface MealPlanEntry {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  /** null = untimed ("Other"). */
  meal: PlanMeal | null;
  kind: 'recipe' | 'text';
  recipeId?: string;
  text?: string;
  note?: string;
  /** Position within the day (ascending). */
  order: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MealPlanResponse {
  entries: MealPlanEntry[];
}

export interface CreatePlanEntryRequest {
  date: string;
  meal?: PlanMeal | null;
  kind: 'recipe' | 'text';
  recipeId?: string;
  text?: string;
  note?: string;
  order?: number;
}

export interface UpdatePlanEntryRequest {
  version: number;
  /** Text entries only. */
  text?: string;
  /** null or '' clears it. */
  note?: string | null;
}

export interface MovePlanEntryRequest {
  version: number;
  date: string;
  meal: PlanMeal | null;
  order?: number;
}

const fail = (message: string, field?: string): { ok: false; message: string; field?: string } =>
  field ? { ok: false, message, field } : { ok: false, message };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------------------
// Dates

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isPlanDate(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v;
}

const toUtc = (date: string): number => {
  const m = DATE_RE.exec(date) as RegExpExecArray;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};
const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
  return fromUtc(toUtc(date) + n * 86_400_000);
}

export function planDaysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** The Monday on or before `date`. */
export function weekStart(date: string): string {
  const dow = new Date(toUtc(date)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

/** Monday to Sunday of the week starting at `monday`. */
export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Length of the rolling planner range: today plus six days. */
export const PLAN_RANGE_DAYS = 7;

/** The rolling range of `PLAN_RANGE_DAYS` dates starting at `start`. */
export function rangeDates(start: string, n: number = PLAN_RANGE_DAYS): string[] {
  return Array.from({ length: n }, (_, i) => addDays(start, i));
}

// ---------------------------------------------------------------------------------------
// Validation

function parseMeal(v: unknown): Parsed<PlanMeal | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v === 'string' && (PLAN_MEALS as readonly string[]).includes(v)) {
    return { ok: true, value: v as PlanMeal };
  }
  return fail('meal must be breakfast, lunch, dinner or null', 'meal');
}

function parseOrder(v: unknown): Parsed<number | undefined> {
  if (v === undefined) return { ok: true, value: undefined };
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1_000_000) {
    return fail('order must be a whole number', 'order');
  }
  return { ok: true, value: v };
}

function parseText(v: unknown): Parsed<string> {
  if (typeof v !== 'string') return fail('Enter some text.', 'text');
  const s = cleanText(v);
  if (!s) return fail('Enter some text.', 'text');
  if (s.length > MEAL_PLAN_LIMITS.text) {
    return fail(`Keep the text to ${MEAL_PLAN_LIMITS.text} characters or fewer.`, 'text');
  }
  return { ok: true, value: s };
}

/** '' when absent or blank. */
function parseNote(v: unknown): Parsed<string> {
  if (v === undefined || v === null) return { ok: true, value: '' };
  if (typeof v !== 'string') return fail('note must be text', 'note');
  const s = cleanText(v);
  if (s.length > MEAL_PLAN_LIMITS.note) {
    return fail(`Keep the note to ${MEAL_PLAN_LIMITS.note} characters or fewer.`, 'note');
  }
  return { ok: true, value: s };
}

function parseVersion(v: unknown): Parsed<number> {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    return fail('version is required', 'version');
  }
  return { ok: true, value: v };
}

export function parseCreatePlanEntry(body: unknown): Parsed<{
  date: string;
  meal: PlanMeal | null;
  kind: 'recipe' | 'text';
  recipeId?: string;
  text?: string;
  note: string;
  order?: number;
}> {
  if (!isObject(body)) return { ok: false, message: 'Body must be a JSON object' };
  if (!isPlanDate(body.date)) return fail('date must be YYYY-MM-DD', 'date');
  const meal = parseMeal(body.meal);
  if (!meal.ok) return meal;
  const note = parseNote(body.note);
  if (!note.ok) return note;
  const order = parseOrder(body.order);
  if (!order.ok) return order;
  const base = {
    date: body.date,
    meal: meal.value,
    note: note.value,
    ...(order.value !== undefined ? { order: order.value } : {}),
  };
  if (body.kind === 'recipe') {
    if (typeof body.recipeId !== 'string' || !ENTITY_ID_PATTERN.test(body.recipeId)) {
      return fail('Choose a recipe.', 'recipeId');
    }
    return { ok: true, value: { ...base, kind: 'recipe', recipeId: body.recipeId } };
  }
  if (body.kind === 'text') {
    const text = parseText(body.text);
    if (!text.ok) return text;
    return { ok: true, value: { ...base, kind: 'text', text: text.value } };
  }
  return fail('kind must be recipe or text', 'kind');
}

export function parseUpdatePlanEntry(
  body: unknown,
): Parsed<{ version: number; text?: string; note?: string }> {
  if (!isObject(body)) return { ok: false, message: 'Body must be a JSON object' };
  const version = parseVersion(body.version);
  if (!version.ok) return version;
  const out: { version: number; text?: string; note?: string } = { version: version.value };
  if (body.text !== undefined) {
    const text = parseText(body.text);
    if (!text.ok) return text;
    out.text = text.value;
  }
  if (body.note !== undefined) {
    const note = parseNote(body.note);
    if (!note.ok) return note;
    out.note = note.value;
  }
  if (out.text === undefined && out.note === undefined) {
    return fail('Nothing to change', 'note');
  }
  return { ok: true, value: out };
}

export function parseMovePlanEntry(body: unknown): Parsed<MovePlanEntryRequest> {
  if (!isObject(body)) return { ok: false, message: 'Body must be a JSON object' };
  const version = parseVersion(body.version);
  if (!version.ok) return version;
  if (!isPlanDate(body.date)) return fail('date must be YYYY-MM-DD', 'date');
  const meal = parseMeal(body.meal);
  if (!meal.ok) return meal;
  const order = parseOrder(body.order);
  if (!order.ok) return order;
  return {
    ok: true,
    value: {
      version: version.value,
      date: body.date,
      meal: meal.value,
      ...(order.value !== undefined ? { order: order.value } : {}),
    },
  };
}

/** GET /plan query: inclusive `from`..`to`, at most `rangeDays` apart. */
export function parsePlanRange(q: {
  from?: string | undefined;
  to?: string | undefined;
}): Parsed<{ from: string; to: string }> {
  if (!isPlanDate(q.from)) return fail('from must be YYYY-MM-DD', 'from');
  if (!isPlanDate(q.to)) return fail('to must be YYYY-MM-DD', 'to');
  const span = planDaysBetween(q.from, q.to);
  if (span < 0) return fail('to must not be before from', 'to');
  if (span > MEAL_PLAN_LIMITS.rangeDays) {
    return fail(`Ask for at most ${MEAL_PLAN_LIMITS.rangeDays + 1} days at a time.`, 'to');
  }
  return { ok: true, value: { from: q.from, to: q.to } };
}

/** Sort within a day: meal slot (breakfast, lunch, dinner, untimed), then order, then id. */
export function sortPlanEntries<T extends Pick<MealPlanEntry, 'meal' | 'order' | 'id'>>(
  entries: readonly T[],
): T[] {
  const slot = (m: PlanMeal | null) => (m === null ? 3 : PLAN_MEALS.indexOf(m));
  return [...entries].sort(
    (a, b) => slot(a.meal) - slot(b.meal) || a.order - b.order || a.id.localeCompare(b.id),
  );
}
