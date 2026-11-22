import { describe, expect, it } from 'vitest';
import { householdContextFromClaims, isValidHouseholdId } from './household';

const base = {
  sub: '1b2c3d4e-0000-1111-2222-333344445555',
  email: 'someone@example.com',
  token_use: 'id',
  'custom:householdId': 'home-1',
};

describe('householdContextFromClaims', () => {
  it('returns the context for a valid ID token', () => {
    expect(householdContextFromClaims(base)).toEqual({
      ok: true,
      context: { userId: base.sub, email: base.email, householdId: 'home-1' },
    });
  });

  it('rejects missing claims', () => {
    expect(householdContextFromClaims(undefined)).toEqual({ ok: false, reason: 'missing_user' });
    expect(householdContextFromClaims({ ...base, sub: '' })).toEqual({
      ok: false,
      reason: 'missing_user',
    });
  });

  it('rejects access tokens', () => {
    expect(householdContextFromClaims({ ...base, token_use: 'access' })).toEqual({
      ok: false,
      reason: 'wrong_token_use',
    });
  });

  it('rejects a missing household claim', () => {
    const { 'custom:householdId': _omit, ...rest } = base;
    expect(householdContextFromClaims(rest)).toEqual({ ok: false, reason: 'missing_household' });
  });

  it('rejects a malformed household claim', () => {
    for (const bad of ['a#b', 'x', 'has space', 'a'.repeat(65)]) {
      expect(householdContextFromClaims({ ...base, 'custom:householdId': bad })).toEqual({
        ok: false,
        reason: 'invalid_household',
      });
    }
  });

  it('defaults email to empty string when absent', () => {
    const { email: _omit, ...rest } = base;
    const result = householdContextFromClaims(rest);
    expect(result.ok && result.context.email).toBe('');
  });
});

describe('isValidHouseholdId', () => {
  it('accepts slugs and uuids', () => {
    expect(isValidHouseholdId('smith-family')).toBe(true);
    expect(isValidHouseholdId('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(true);
  });
  it('rejects non-strings', () => {
    expect(isValidHouseholdId(123)).toBe(false);
    expect(isValidHouseholdId(null)).toBe(false);
  });
});
