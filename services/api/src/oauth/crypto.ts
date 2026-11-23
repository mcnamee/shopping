/**
 * OAuth secrets (D-083): opaque 256-bit random values, stored only as SHA-256 hashes, and
 * constant-time comparisons for anything checked against a request.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random, base64url (43 chars). Used for codes, access and refresh tokens. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** 128-bit random id (client ids, pending request ids). */
export function newId(): string {
  return randomBytes(16).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

/** Constant-time string equality (length leaks only, which is public for every use here). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) {
    // Still do the work so timing does not depend on where the strings differ.
    timingSafeEqual(x, x);
    return false;
  }
  return timingSafeEqual(x, y);
}

/** RFC 7636: verifier is 43-128 chars of [A-Za-z0-9-._~]. */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
/** S256 challenge: base64url of a SHA-256 digest (43 chars). */
export const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** PKCE S256 check: BASE64URL(SHA256(verifier)) == challenge, compared in constant time. */
export function pkceMatches(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !VERIFIER.test(verifier)) return false;
  return safeEqual(sha256(verifier), challenge);
}

/** Opaque key for a rate-limit bucket (never store raw IPs). */
export function hashForKey(value: string): string {
  return sha256(`trolley-rl:${value}`).slice(0, 22);
}
