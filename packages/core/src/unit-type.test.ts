import { describe, expect, it } from 'vitest';
import type { UnitType } from './product';
import {
  displayPackSize,
  formatPackSize,
  inferUnitType,
  parsePackSize,
  type UnitHints,
} from './unit-type';

/**
 * Real ALDI AU strings (api.aldi.com.au, ALDI Casey ACT, Nov 2026):
 * [name, sellingSize, unit-price text, loose (weightType "3"), expected unitType, expected packSize]
 */
const REAL: Array<[string, string | null, string | null, boolean, UnitType, string | null]> = [
  // Loose produce, weighed at the till
  ['Cavendish Bananas per kg', null, '1 kg', true, 'kg', 'per kg'],
  ['Broccoli per kg', null, '1 kg', true, 'kg', 'per kg'],
  ['Cut Kent Pumpkins per kg', null, '1 kg', true, 'kg', 'per kg'],
  // Random-weight pre-packs (weightType "1"): picked up as packs
  [
    'Beef Blade Steak per kg',
    'approx. 0.96 kg per package',
    '$20.99 per 1 kg',
    false,
    'pack',
    'approx. 0.96 kg',
  ],
  [
    '3 Star Beef Mince per kg',
    'approx. 1.9 kg per package',
    '$12.99 per 1 kg',
    false,
    'pack',
    'approx. 1.9 kg',
  ],
  [
    'Beef Chuck Casserole',
    'approx. 1 kg per package',
    '$16.99 per 1 kg',
    false,
    'pack',
    'approx. 1 kg',
  ],
  // Each
  ['Lime Each', '1 each', '$1.29 per 1 each', false, 'each', '1 each'],
  ['Hass Avocado Each', '1 each', '$2.99 per 1 each', false, 'each', '1 each'],
  ['Iceberg Bagged Lettuce Each', '1 each', '$3.99 per 1 each', false, 'each', '1 each'],
  // Multi-count packs
  ['Lemons 5 Pack', '5 each', '$1.10 per 1 each', false, 'pack', '5 each'],
  ['Baby Cos Lettuce 2 Pack', '2 each', '$1.50 per 1 each', false, 'pack', '2 each'],
  ['Crumpets 6 Pack 300g', '6 each', '$0.33 per 1 each', false, 'pack', '6 each'],
  // Fixed weight / volume packs (spec: "2L" -> pack of 2L)
  ['Light Milk 2L', '2 l', '$1.70 per 1 L', false, 'pack', '2 L'],
  ['Evaporated Milk 384ml', '384 ml', '$0.49 per 100 ml', false, 'pack', '384 mL'],
  ['Mandarins 1kg', '1 kg', '$2.99 per 1 kg', false, 'pack', '1 kg'],
  ['Navel Oranges 1.5kg', '1.5 kg', '$3.33 per 1 kg', false, 'pack', '1.5 kg'],
  ['Baby Spinach 280g', '280 g', '$14.25 per 1 kg', false, 'pack', '280 g'],
  ['Birdseye Chillies 20g', '20 g', '$1.75 per 10 g', false, 'pack', '20 g'],
  ['All Butter Croissants 3 Pack 189g', '189 g', '$1.21 per 100 g', false, 'pack', '189 g'],
  ['Milk Mouse - Milk Chocolate 168g', '168 g', '$2.38 per 100 g', false, 'pack', '168 g'],
  // No selling size: fall back to the name
  ['Bordeaux 750ml', null, null, false, 'pack', '750 mL'],
  ['Irish Cream Salted Caramel 700mL', null, null, false, 'pack', '700 mL'],
  ['Prosecco DOC', null, null, false, 'each', null],
  ['Milk Frother', null, null, false, 'each', null],
];

describe('inferUnitType (real ALDI strings)', () => {
  it.each(REAL)('%s | %s -> %s', (name, packSize, unitPrice, soldByWeight, expected, display) => {
    const hints: UnitHints = { name, packSize, unitPrice, soldByWeight };
    const unitType = inferUnitType(hints);
    expect(unitType).toBe(expected);
    expect(displayPackSize(hints, unitType)).toBe(display);
  });
});

/** Stage 1 criterion B1: inferUnitType from pack-size text alone. */
describe('inferUnitType (B1 pack-size text)', () => {
  it.each<[string, UnitType]>([
    ['per kg', 'kg'],
    ['kg', 'kg'],
    ['per 100g', 'g'],
    ['2L', 'pack'],
    ['500mL', 'pack'],
    ['6 pack', 'pack'],
    ['x 12', 'pack'],
    ['12 x', 'pack'],
    ['each', 'each'],
    ['', 'each'],
    ['assorted', 'each'],
    ['per litre', 'L'],
    ['litre', 'L'],
  ])('%j -> %s', (packSize, expected) => {
    expect(inferUnitType({ name: 'Product', packSize })).toBe(expected);
  });
});

describe('inferUnitType (text-only rules)', () => {
  it.each<[UnitHints, UnitType]>([
    [{ name: 'Sweet Potatoes per kg' }, 'kg'],
    [{ name: 'Potatoes', packSize: 'per kg' }, 'kg'],
    [{ name: 'Potatoes', packSize: '$3.99/kg' }, 'kg'],
    [{ name: 'Shaved Ham', packSize: 'per 100g' }, 'g'],
    [{ name: 'Olives', soldByWeight: true, unitPrice: '$2.50 per 100 g' }, 'g'],
    [{ name: 'Fresh Juice per litre' }, 'L'],
    [{ name: 'Yoghurt 6 x 100g' }, 'pack'],
    [{ name: 'Sparkling Water', packSize: '24 x 600ml' }, 'pack'],
    [{ name: 'Croissants Pack of 6' }, 'pack'],
    [{ name: 'Sourdough 1 Pack' }, 'each'],
    [{ name: 'Watermelon Each' }, 'each'],
    [{ name: 'Tea Towel' }, 'each'],
    [{ name: '' }, 'each'],
  ])('%j -> %s', (hints, expected) => {
    expect(inferUnitType(hints)).toBe(expected);
  });
});

describe('parsePackSize', () => {
  it.each<[string, ReturnType<typeof parsePackSize>]>([
    ['2 l', { quantity: 2, unit: 'L' }],
    ['384 ml', { quantity: 384, unit: 'mL' }],
    ['1.5 kg', { quantity: 1.5, unit: 'kg' }],
    ['0,5 kg', { quantity: 0.5, unit: 'kg' }],
    ['168 g', { quantity: 168, unit: 'g' }],
    ['5 each', { quantity: 5, unit: 'each' }],
    ['Light Milk 3L', { quantity: 3, unit: 'L' }],
    ['6 x 100g', { quantity: 100, unit: 'g', count: 6 }],
    ['24x375mL', { quantity: 375, unit: 'mL', count: 24 }],
    ['2 Star Beef Mince 500g', { quantity: 500, unit: 'g' }],
    ['approx. 0.96 kg per package', { quantity: 0.96, unit: 'kg' }],
  ])('%s', (text, expected) => {
    expect(parsePackSize(text)).toEqual(expected);
  });

  it('returns null when there is no size', () => {
    expect(parsePackSize('Prosecco DOC')).toBeNull();
    expect(parsePackSize('1/2m Chocolate Tube')).toBeNull();
    expect(parsePackSize(null)).toBeNull();
    expect(parsePackSize('0 g')).toBeNull();
  });

  it('does not read units out of words', () => {
    expect(parsePackSize('3 Large Eggs')).toBeNull();
    expect(parsePackSize('2 Gourmet Sausages')).toBeNull();
  });
});

describe('formatPackSize', () => {
  it('formats multipacks and decimals', () => {
    expect(formatPackSize({ quantity: 100, unit: 'g', count: 6 })).toBe('6 x 100 g');
    expect(formatPackSize({ quantity: 0.333333, unit: 'kg' })).toBe('0.333 kg');
  });
});
