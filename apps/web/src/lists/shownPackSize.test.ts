import { describe, expect, it } from 'vitest';
import { shownPackSize } from './ShopRow';

describe('shownPackSize (QA-1)', () => {
  it('hides a pack size the name already ends with', () => {
    expect(shownPackSize('Garlic per kg', 'per kg')).toBeUndefined();
    expect(shownPackSize('Full Cream Milk 2L', '2 L')).toBeUndefined();
  });
  it('keeps an informative pack size', () => {
    expect(shownPackSize('Brioche Hot Dog Rolls 6 Pack', '270 g')).toBe('270 g');
    expect(shownPackSize('Bananas', undefined)).toBeUndefined();
  });
});
