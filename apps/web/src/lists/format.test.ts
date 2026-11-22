import { describe, expect, it } from 'vitest';
import { longDay, monthLabel, qtyLabel, shortDay, updatedLabel } from './format';

describe('qtyLabel', () => {
  it('shows counted units as "2 x" and measured units with their unit', () => {
    expect(qtyLabel(2, 'pack')).toBe('2 x');
    expect(qtyLabel(1, 'each')).toBe('1 x');
    expect(qtyLabel(1.5, 'kg')).toBe('1.5 kg');
    expect(qtyLabel(500, 'g')).toBe('500 g');
    expect(qtyLabel(2, 'L')).toBe('2 L');
    expect(qtyLabel(750, 'mL')).toBe('750 mL');
  });
});

describe('updatedLabel', () => {
  const t0 = Date.parse('2026-11-22T04:41:00Z');
  it.each([
    [0, 'Updated just now'],
    [14_000, 'Updated just now'],
    [31_000, 'Updated 30 s ago'],
    [75_000, 'Updated 1 min ago'],
    [5 * 60_000 + 10_000, 'Updated 5 min ago'],
    [42 * 60_000, 'Updated 40 min ago'],
  ])('after %i ms reads "%s"', (ms, text) => {
    expect(updatedLabel(t0, t0 + ms)).toBe(text);
  });
  it('falls back to a clock time after an hour (Sydney)', () => {
    expect(updatedLabel(t0, t0 + 3 * 3600_000)).toBe('Updated at 3:41 pm');
  });
});

describe('dates (Australia/Sydney)', () => {
  it('formats short, long and month labels', () => {
    expect(shortDay('2026-11-22T03:00:00Z')).toBe('Sun 22 Nov');
    expect(longDay('2026-11-22T03:00:00Z')).toBe('Sunday 22 November');
    expect(monthLabel('2026-11-22T03:00:00Z')).toBe('November 2026');
    // 23:00 UTC on the 21st is already the 22nd in Sydney.
    expect(shortDay('2026-11-21T23:00:00Z')).toBe('Sun 22 Nov');
  });
});
