import { describe, expect, it } from 'vitest';
import { keys } from './keys';

describe('keys', () => {
  it('builds household-scoped keys', () => {
    expect(keys.householdPk('home-1')).toBe('HH#home-1');
    expect(keys.listItemPk('home-1', 'abc')).toBe('HH#home-1#LIST#abc');
    expect(keys.productPk('12345')).toBe('PRODUCT#12345');
  });

  it('refuses ids that could break out of the household partition', () => {
    expect(() => keys.householdPk('home#2')).toThrow();
    expect(() => keys.listItemPk('home-1', 'x#ITEM')).toThrow();
    expect(() => keys.productPk('')).toThrow();
  });
});
