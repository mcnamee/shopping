/**
 * Household identity, derived only from verified JWT claims.
 *
 * API Gateway's JWT authoriser has already verified the token signature, issuer,
 * audience and expiry before our Lambda runs. These helpers turn the verified claims
 * into a household context. The household is NEVER taken from the request body,
 * query string or path.
 */

/** Allowed household id shape. Must not contain '#' (used as a key separator). */
export const HOUSEHOLD_ID_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

export const HOUSEHOLD_CLAIM = 'custom:householdId';

export type JwtClaims = Readonly<Record<string, unknown>>;

export interface HouseholdContext {
  /** Cognito `sub` - stable user id. */
  userId: string;
  email: string;
  householdId: string;
}

export type HouseholdContextResult =
  | { ok: true; context: HouseholdContext }
  | {
      ok: false;
      reason: 'missing_user' | 'wrong_token_use' | 'missing_household' | 'invalid_household';
    };

export function isValidHouseholdId(value: unknown): value is string {
  return typeof value === 'string' && HOUSEHOLD_ID_PATTERN.test(value);
}

function claimString(claims: JwtClaims, name: string): string | undefined {
  const value = claims[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Build a household context from verified Cognito ID-token claims.
 *
 * - `token_use` must be `id` (the web app sends the ID token; access tokens do not
 *   carry custom attributes or an `aud` claim).
 * - `custom:householdId` must be present and well-formed.
 */
export function householdContextFromClaims(
  claims: JwtClaims | undefined | null,
): HouseholdContextResult {
  if (!claims) return { ok: false, reason: 'missing_user' };

  const userId = claimString(claims, 'sub');
  if (!userId) return { ok: false, reason: 'missing_user' };

  const tokenUse = claimString(claims, 'token_use');
  if (tokenUse !== undefined && tokenUse !== 'id') return { ok: false, reason: 'wrong_token_use' };

  const householdId = claimString(claims, HOUSEHOLD_CLAIM);
  if (householdId === undefined) return { ok: false, reason: 'missing_household' };
  if (!isValidHouseholdId(householdId)) return { ok: false, reason: 'invalid_household' };

  return {
    ok: true,
    context: { userId, email: claimString(claims, 'email') ?? '', householdId },
  };
}
