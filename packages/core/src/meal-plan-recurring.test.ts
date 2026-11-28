import { describe, expect, it } from 'vitest';
import {
  expandOccurrences,
  fallsOnRule,
  nextRuleDate,
  nextWeekdayOnOrAfter,
  parsePlanRule,
  parseUpdatePlanRule,
  planWeekday,
  ruleDates,
  skipKey,
  type PlanRule,
} from './meal-plan-recurring';

const rule = (over: Partial<PlanRule> = {}): PlanRule => ({
  id: 'r1',
  kind: 'text',
  text: 'Pizza',
  meal: 'dinner',
  weekday: 5,
  everyWeeks: 1,
  startDate: '2026-11-27', // Friday
  paused: false,
  version: 1,
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('weekday maths', () => {
  it('uses ISO weekdays and finds the next matching day', () => {
    expect(planWeekday('2026-11-23')).toBe(1);
    expect(planWeekday('2026-11-29')).toBe(7);
    expect(nextWeekdayOnOrAfter('2026-11-28', 4)).toBe('2026-12-03');
    expect(nextWeekdayOnOrAfter('2026-12-03', 4)).toBe('2026-12-03');
  });
});

describe('ruleDates', () => {
  it('weekly rules fall on every matching weekday from the start', () => {
    expect(ruleDates(rule(), '2026-11-20', '2026-12-20')).toEqual([
      '2026-11-27',
      '2026-12-04',
      '2026-12-11',
      '2026-12-18',
    ]);
  });

  it('every 2 weeks keeps parity from startDate whatever the range start', () => {
    const r = rule({ weekday: 4, everyWeeks: 2, startDate: '2026-12-03' });
    expect(ruleDates(r, '2026-11-01', '2027-01-31')).toEqual([
      '2026-12-03',
      '2026-12-17',
      '2026-12-31',
      '2027-01-14',
      '2027-01-28',
    ]);
    // Starting the range on the off week gives the same days.
    expect(ruleDates(r, '2026-12-10', '2026-12-31')).toEqual(['2026-12-17', '2026-12-31']);
    expect(ruleDates(r, '2026-12-18', '2027-01-14')).toEqual(['2026-12-31', '2027-01-14']);
  });

  it('handles every 3 and 4 weeks', () => {
    const base = { weekday: 5 as const, startDate: '2026-11-27' };
    expect(ruleDates(rule({ ...base, everyWeeks: 3 }), '2026-11-28', '2027-01-31')).toEqual([
      '2026-12-18',
      '2027-01-08',
      '2027-01-29',
    ]);
    expect(ruleDates(rule({ ...base, everyWeeks: 4 }), '2026-11-27', '2027-01-31')).toEqual([
      '2026-11-27',
      '2026-12-25',
      '2027-01-22',
    ]);
  });

  it('is not affected by daylight saving changes (Sydney, 4 Apr and 3 Oct 2026)', () => {
    const r = rule({ weekday: 7, everyWeeks: 1, startDate: '2026-03-29' }); // Sundays
    const dates = ruleDates(r, '2026-03-29', '2026-10-25');
    expect(dates).toHaveLength(31);
    expect(dates.every((d) => planWeekday(d) === 7)).toBe(true);
    expect(dates).toContain('2026-04-05');
    expect(dates).toContain('2026-10-04');
    const fortnightly = ruleDates(rule({ ...r, everyWeeks: 2 }), '2026-03-29', '2026-10-25');
    expect(fortnightly[1]).toBe('2026-04-12');
    expect(fortnightly).toContain('2026-10-11');
  });

  it('respects start and end bounds inclusively', () => {
    const r = rule({ endDate: '2026-12-11' });
    expect(ruleDates(r, '2026-11-01', '2027-01-01')).toEqual([
      '2026-11-27',
      '2026-12-04',
      '2026-12-11',
    ]);
    expect(ruleDates(r, '2026-12-12', '2027-01-01')).toEqual([]);
    expect(ruleDates(r, '2026-11-01', '2026-11-26')).toEqual([]);
    expect(ruleDates(rule({ endDate: '2026-12-10' }), '2026-11-01', '2027-01-01')).toHaveLength(2);
  });

  it('paused rules have no occurrences', () => {
    expect(ruleDates(rule({ paused: true }), '2026-11-01', '2027-01-01')).toEqual([]);
    expect(nextRuleDate(rule({ paused: true }), '2026-11-28')).toBeNull();
  });

  it('works across year ends and leap days', () => {
    const r = rule({ weekday: 1, everyWeeks: 2, startDate: '2027-12-27' });
    expect(ruleDates(r, '2027-12-27', '2028-03-06')).toEqual([
      '2027-12-27',
      '2028-01-10',
      '2028-01-24',
      '2028-02-07',
      '2028-02-21',
      '2028-03-06',
    ]);
  });
});

describe('nextRuleDate and fallsOnRule', () => {
  it('finds the next occurrence, including today, and null after the end', () => {
    const r = rule({ weekday: 4, everyWeeks: 2, startDate: '2026-12-03' });
    expect(nextRuleDate(r, '2026-11-28')).toBe('2026-12-03');
    expect(nextRuleDate(r, '2026-12-03')).toBe('2026-12-03');
    expect(nextRuleDate(r, '2026-12-04')).toBe('2026-12-17');
    expect(nextRuleDate({ ...r, endDate: '2026-12-10' }, '2026-12-04')).toBeNull();
  });

  it('checks a single date', () => {
    const r = rule({ weekday: 4, everyWeeks: 2, startDate: '2026-12-03' });
    expect(fallsOnRule(r, '2026-12-17')).toBe(true);
    expect(fallsOnRule(r, '2026-12-10')).toBe(false);
    expect(fallsOnRule(r, '2026-11-19')).toBe(false);
    expect(fallsOnRule(r, '2026-12-18')).toBe(false);
  });
});

describe('expandOccurrences', () => {
  it('merges rules, drops skips and sorts by date then slot', () => {
    const a = rule({ id: 'a', meal: 'dinner' });
    const b = rule({ id: 'b', meal: 'lunch', kind: 'recipe', recipeId: 'rec', text: undefined });
    const occ = expandOccurrences(
      [a, b],
      new Set([skipKey('a', '2026-12-04')]),
      '2026-11-27',
      '2026-12-04',
    );
    expect(occ.map((o) => `${o.date} ${o.ruleId}`)).toEqual([
      '2026-11-27 b',
      '2026-11-27 a',
      '2026-12-04 b',
    ]);
    expect(occ[0]).toMatchObject({ recurring: true, kind: 'recipe', recipeId: 'rec' });
    expect(occ[1]).toMatchObject({ kind: 'text', text: 'Pizza' });
  });
});

describe('parsePlanRule', () => {
  const ok = {
    kind: 'text',
    text: ' Pizza ',
    meal: 'dinner',
    weekday: 5,
    everyWeeks: 2,
    startDate: '2026-11-27',
  };
  it('accepts a valid rule and cleans text', () => {
    expect(parsePlanRule(ok)).toMatchObject({
      ok: true,
      value: { text: 'Pizza', everyWeeks: 2, paused: false, meal: 'dinner' },
    });
  });
  it.each([
    [{ ...ok, weekday: 8 }, 'weekday'],
    [{ ...ok, everyWeeks: 5 }, 'everyWeeks'],
    [{ ...ok, everyWeeks: 0 }, 'everyWeeks'],
    [{ ...ok, startDate: '2026-11-28' }, 'startDate'],
    [{ ...ok, startDate: 'nope' }, 'startDate'],
    [{ ...ok, endDate: '2026-11-20' }, 'endDate'],
    [{ ...ok, meal: 'brunch' }, 'meal'],
    [{ ...ok, text: '  ' }, 'text'],
    [{ ...ok, kind: 'recipe' }, 'recipeId'],
    [{ ...ok, kind: 'x' }, 'kind'],
    [{ ...ok, note: 'n'.repeat(201) }, 'note'],
    [{ ...ok, paused: 'yes' }, 'paused'],
  ])('rejects %j on %s', (body, field) => {
    expect(parsePlanRule(body)).toMatchObject({ ok: false, field });
  });
  it('requires a version to update', () => {
    expect(parseUpdatePlanRule(ok)).toMatchObject({ ok: false, field: 'version' });
    expect(parseUpdatePlanRule({ ...ok, version: 2 })).toMatchObject({ ok: true });
  });
});
