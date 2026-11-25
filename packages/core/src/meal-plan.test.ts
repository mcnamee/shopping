import { describe, expect, it } from 'vitest';
import { keys } from './keys';
import {
  addDays,
  isPlanDate,
  parseCreatePlanEntry,
  parseMovePlanEntry,
  parsePlanRange,
  parseUpdatePlanEntry,
  sortPlanEntries,
  weekDates,
  weekStart,
} from './meal-plan';

const R = '11111111-2222-4333-8444-555555555555';

describe('week arithmetic', () => {
  it('starts weeks on Monday', () => {
    expect(weekStart('2026-11-23')).toBe('2026-11-23'); // Monday
    expect(weekStart('2026-11-22')).toBe('2026-11-16'); // Sunday belongs to the week before
    expect(weekStart('2026-11-25')).toBe('2026-11-23');
    expect(weekDates('2026-11-23')).toHaveLength(7);
    expect(weekDates('2026-11-23')[6]).toBe('2026-11-29');
  });
  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('validates real dates only', () => {
    expect(isPlanDate('2026-02-30')).toBe(false);
    expect(isPlanDate('2026-2-3')).toBe(false);
    expect(isPlanDate('2024-02-29')).toBe(true);
  });
});

describe('parseCreatePlanEntry', () => {
  it('accepts recipe and text entries', () => {
    expect(
      parseCreatePlanEntry({ date: '2026-11-23', meal: 'dinner', kind: 'recipe', recipeId: R }),
    ).toEqual({
      ok: true,
      value: { date: '2026-11-23', meal: 'dinner', kind: 'recipe', recipeId: R, note: '' },
    });
    const t = parseCreatePlanEntry({
      date: '2026-11-23',
      kind: 'text',
      text: '  Eat   out ',
      note: 'Pizza',
    });
    expect(t).toMatchObject({ ok: true, value: { meal: null, text: 'Eat out', note: 'Pizza' } });
  });
  it('rejects bad input naming the field', () => {
    expect(parseCreatePlanEntry({ date: 'x', kind: 'text', text: 'a' })).toMatchObject({
      field: 'date',
    });
    expect(
      parseCreatePlanEntry({ date: '2026-11-23', meal: 'brunch', kind: 'text', text: 'a' }),
    ).toMatchObject({ field: 'meal' });
    expect(
      parseCreatePlanEntry({ date: '2026-11-23', kind: 'recipe', recipeId: 'nope' }),
    ).toMatchObject({ field: 'recipeId' });
    expect(parseCreatePlanEntry({ date: '2026-11-23', kind: 'text', text: '  ' })).toMatchObject({
      field: 'text',
    });
    expect(
      parseCreatePlanEntry({ date: '2026-11-23', kind: 'text', text: 'a'.repeat(101) }),
    ).toMatchObject({ field: 'text' });
    expect(
      parseCreatePlanEntry({ date: '2026-11-23', kind: 'text', text: 'a', note: 'n'.repeat(201) }),
    ).toMatchObject({ field: 'note' });
    expect(parseCreatePlanEntry({ date: '2026-11-23', kind: 'other' })).toMatchObject({
      field: 'kind',
    });
  });
});

describe('update, move and range', () => {
  it('needs a version and something to change', () => {
    expect(parseUpdatePlanEntry({ note: 'x' })).toMatchObject({ field: 'version' });
    expect(parseUpdatePlanEntry({ version: 1 })).toMatchObject({ ok: false });
    expect(parseUpdatePlanEntry({ version: 1, note: '' })).toEqual({
      ok: true,
      value: { version: 1, note: '' },
    });
  });
  it('parses a move', () => {
    expect(parseMovePlanEntry({ version: 2, date: '2026-11-24', meal: null })).toEqual({
      ok: true,
      value: { version: 2, date: '2026-11-24', meal: null },
    });
    expect(parseMovePlanEntry({ version: 2, date: '2026-11-24', meal: 'x' })).toMatchObject({
      field: 'meal',
    });
  });
  it('limits the range', () => {
    expect(parsePlanRange({ from: '2026-11-23', to: '2026-11-29' }).ok).toBe(true);
    expect(parsePlanRange({ from: '2026-11-29', to: '2026-11-23' }).ok).toBe(false);
    expect(parsePlanRange({ from: '2026-01-01', to: '2026-12-31' }).ok).toBe(false);
    expect(parsePlanRange({ from: '2026-01-01' }).ok).toBe(false);
  });
});

describe('sorting and keys', () => {
  it('orders meals then order', () => {
    const e = (id: string, meal: 'lunch' | 'dinner' | null, order: number) => ({ id, meal, order });
    expect(
      sortPlanEntries([
        e('a', null, 0),
        e('b', 'dinner', 2),
        e('c', 'lunch', 5),
        e('d', 'dinner', 1),
      ]).map((x) => x.id),
    ).toEqual(['c', 'd', 'b', 'a']);
  });
  it('builds date-ordered keys', () => {
    expect(keys.planSk('2026-11-23', 'x')).toBe('PLAN#2026-11-23#x');
    const r = keys.planRange('2026-11-23', '2026-11-29');
    expect('PLAN#2026-11-29#ffff' <= r.to && 'PLAN#2026-11-23#a' >= r.from).toBe(true);
    expect('PLAN#2026-11-30#a' <= r.to).toBe(false);
    expect(() => keys.planSk('bad', 'x')).toThrow();
  });
});
