import { describe, expect, it } from 'vitest';
import { UNIT_TYPES, type UnitType } from './product';
import {
  announceQuantity,
  clampQuantity,
  convertQuantity,
  describeQuantity,
  formatQuantity,
  parseQuantity,
  presetLabel,
  QUANTITY_RULES,
  roundQuantity,
  sanitiseQuantityInput,
  stepQuantity,
} from './quantity';

describe('QUANTITY_RULES', () => {
  it('matches the spec table', () => {
    expect(QUANTITY_RULES.each).toMatchObject({ default: 1, step: 1, min: 1, max: 99 });
    expect(QUANTITY_RULES.pack).toMatchObject({ default: 1, step: 1, min: 1, max: 99 });
    expect(QUANTITY_RULES.kg).toMatchObject({ default: 1, step: 0.25, min: 0.05, max: 20 });
    expect(QUANTITY_RULES.kg.presets).toEqual([0.5, 1, 1.5, 2]);
    expect(QUANTITY_RULES.g).toMatchObject({ default: 500, step: 100, min: 10, max: 20000 });
    expect(QUANTITY_RULES.g.presets).toEqual([250, 500, 1000]);
    expect(QUANTITY_RULES.L).toMatchObject({ default: 1, step: 0.5, min: 0.1, max: 20 });
    expect(QUANTITY_RULES.L.presets).toEqual([0.5, 1, 1.5, 2]);
    expect(QUANTITY_RULES.mL).toMatchObject({ default: 500, step: 250, min: 50, max: 20000 });
    expect(QUANTITY_RULES.mL.presets).toEqual([250, 500, 750, 1000]);
  });

  it('defaults sit on the grid and inside the range', () => {
    for (const u of UNIT_TYPES) {
      const r = QUANTITY_RULES[u];
      expect(r.default).toBeGreaterThanOrEqual(r.min);
      expect(r.default).toBeLessThanOrEqual(r.max);
      for (const p of r.presets) expect(p).toBeGreaterThanOrEqual(r.min);
    }
  });
});

describe('stepQuantity', () => {
  it('steps without float artefacts', () => {
    let v = 0.25;
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      v = stepQuantity(v, 'kg', 1) as number;
      seen.push(v);
    }
    expect(seen).toEqual([0.5, 0.75, 1, 1.25, 1.5, 1.75]);
    expect(stepQuantity(0.1 + 0.2, 'L', 1)).toBe(0.5);
  });

  it('goes to the next multiple from an off-grid value', () => {
    expect(stepQuantity(1.3, 'kg', 1)).toBe(1.5);
    expect(stepQuantity(1.3, 'kg', -1)).toBe(1.25);
    expect(stepQuantity(130, 'g', 1)).toBe(200);
    expect(stepQuantity(130, 'g', -1)).toBe(100);
  });

  it('returns null at the limits', () => {
    expect(stepQuantity(1, 'each', -1)).toBeNull();
    expect(stepQuantity(99, 'pack', 1)).toBeNull();
    expect(stepQuantity(0.25, 'kg', -1)).toBeNull(); // 0 is below min 0.05
    expect(stepQuantity(20, 'kg', 1)).toBeNull();
    expect(stepQuantity(100, 'g', -1)).toBeNull();
    expect(stepQuantity(0.5, 'L', -1)).toBeNull();
    expect(stepQuantity(250, 'mL', -1)).toBeNull();
  });

  it('steps up from the minimum on the grid', () => {
    expect(stepQuantity(0.05, 'kg', 1)).toBe(0.25);
    expect(stepQuantity(10, 'g', 1)).toBe(100);
  });
});

describe('convertQuantity', () => {
  it('converts within a family and back', () => {
    expect(convertQuantity(1.5, 'kg', 'g')).toBe(1500);
    expect(convertQuantity(1500, 'g', 'kg')).toBe(1.5);
    expect(convertQuantity(500, 'mL', 'L')).toBe(0.5);
    expect(convertQuantity(0.75, 'L', 'mL')).toBe(750);
  });

  it('clamps to the new unit range', () => {
    expect(convertQuantity(20, 'kg', 'g')).toBe(20000);
    expect(convertQuantity(15, 'g', 'kg')).toBe(0.05); // 0.015 kg -> min
    expect(convertQuantity(100000, 'g', 'kg')).toBe(20);
  });

  it('resets to the default across families or for counted units', () => {
    expect(convertQuantity(3, 'each', 'kg')).toBe(1);
    expect(convertQuantity(1.5, 'kg', 'each')).toBe(1);
    expect(convertQuantity(2, 'kg', 'L')).toBe(1);
    expect(convertQuantity(2, 'L', 'g')).toBe(500);
    expect(convertQuantity(4, 'each', 'pack')).toBe(1);
  });

  it('is a no-op for the same unit', () => {
    expect(convertQuantity(2.25, 'kg', 'kg')).toBe(2.25);
  });
});

describe('sanitiseQuantityInput', () => {
  it('keeps digits and one separator, normalising comma', () => {
    expect(sanitiseQuantityInput('1,5')).toBe('1.5');
    expect(sanitiseQuantityInput('1.5.2')).toBe('1.52');
    expect(sanitiseQuantityInput('abc2x')).toBe('2');
    expect(sanitiseQuantityInput('-3')).toBe('3');
    expect(sanitiseQuantityInput('')).toBe('');
  });
});

describe('parseQuantity', () => {
  it('accepts valid values and rounds extra decimals silently', () => {
    expect(parseQuantity('1.5', 'kg')).toEqual({ ok: true, value: 1.5 });
    expect(parseQuantity('1,5', 'L')).toEqual({ ok: true, value: 1.5 });
    expect(parseQuantity(' 0.755 ', 'kg')).toEqual({ ok: true, value: 0.76 });
    expect(parseQuantity('500', 'g')).toEqual({ ok: true, value: 500 });
    expect(parseQuantity('3', 'each')).toEqual({ ok: true, value: 3 });
    expect(parseQuantity('.5', 'kg')).toEqual({ ok: true, value: 0.5 });
  });

  it('uses the spec messages', () => {
    expect(parseQuantity('', 'kg')).toEqual({ ok: false, error: 'Enter a quantity.' });
    expect(parseQuantity('  ', 'kg')).toEqual({ ok: false, error: 'Enter a quantity.' });
    expect(parseQuantity('abc', 'kg')).toEqual({ ok: false, error: 'Use numbers only, like 1.5.' });
    expect(parseQuantity('1.2.3', 'kg')).toEqual({
      ok: false,
      error: 'Use numbers only, like 1.5.',
    });
    expect(parseQuantity('1.5', 'each')).toEqual({
      ok: false,
      error: 'Use a whole number, like 2.',
    });
    expect(parseQuantity('2.5', 'g')).toEqual({ ok: false, error: 'Use a whole number, like 2.' });
  });

  it('range errors name min, max and unit', () => {
    expect(parseQuantity('0', 'kg')).toEqual({
      ok: false,
      error: 'Enter an amount from 0.05 to 20 kg.',
    });
    expect(parseQuantity('21', 'kg')).toEqual({
      ok: false,
      error: 'Enter an amount from 0.05 to 20 kg.',
    });
    expect(parseQuantity('0', 'each')).toEqual({
      ok: false,
      error: 'Enter an amount from 1 to 99.',
    });
    expect(parseQuantity('100', 'pack')).toEqual({
      ok: false,
      error: 'Enter an amount from 1 to 99.',
    });
    expect(parseQuantity('5', 'g')).toEqual({
      ok: false,
      error: 'Enter an amount from 10 to 20000 g.',
    });
    expect(parseQuantity('0.01', 'L')).toEqual({
      ok: false,
      error: 'Enter an amount from 0.1 to 20 L.',
    });
  });
});

describe('formatting', () => {
  it('formats with unit and never shows float noise', () => {
    expect(formatQuantity(1.5, 'kg')).toBe('1.5 kg');
    expect(formatQuantity(0.75, 'kg')).toBe('0.75 kg');
    expect(formatQuantity(0.1 + 0.2 + 0.45, 'kg')).toBe('0.75 kg');
    expect(formatQuantity(1.0, 'L')).toBe('1 L');
    expect(formatQuantity(500, 'g')).toBe('500 g');
    expect(formatQuantity(250, 'mL')).toBe('250 mL');
    expect(formatQuantity(3, 'each')).toBe('3');
    expect(formatQuantity(2, 'pack')).toBe('2');
  });

  it('describes a line for toasts', () => {
    expect(describeQuantity(1.5, 'kg', 'Potatoes')).toBe('1.5 kg Potatoes');
    expect(describeQuantity(2, 'L', 'Full Cream Milk')).toBe('2 L Full Cream Milk');
    expect(describeQuantity(2, 'each', 'Bananas')).toBe('2 x Bananas');
  });

  it('labels presets (1000 g reads 1 kg)', () => {
    expect(presetLabel(1000, 'g')).toBe('1 kg');
    expect(presetLabel(250, 'g')).toBe('250 g');
    expect(presetLabel(1000, 'mL')).toBe('1 L');
    expect(presetLabel(750, 'mL')).toBe('750 mL');
    expect(presetLabel(0.5, 'L')).toBe('0.5 L');
  });

  it('announces in words', () => {
    expect(announceQuantity(1.5, 'L')).toBe('Quantity 1.5 litres');
    expect(announceQuantity(1, 'kg')).toBe('Quantity 1 kilogram');
    expect(announceQuantity(1500, 'g')).toBe('Quantity 1500 grams');
  });
});

describe('rounding helpers', () => {
  it('rounds to unit precision and clamps', () => {
    const cases: Array<[number, UnitType, number]> = [
      [0.7500000000000001, 'kg', 0.75],
      [1.005, 'L', 1.01],
      [499.6, 'g', 500],
    ];
    for (const [v, u, want] of cases) expect(roundQuantity(v, u)).toBe(want);
    expect(clampQuantity(0, 'kg')).toBe(0.05);
    expect(clampQuantity(500, 'each')).toBe(99);
  });
});
