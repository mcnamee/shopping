import { describe, expect, it } from 'vitest';
import { AuthError, type AuthErrorCode } from '../auth';
import {
  newPasswordFailure,
  requestCodeErrorMessage,
  resetErrorFailure,
  signInErrorMessage,
  validateEmail,
} from './authCopy';

const err = (code: AuthErrorCode) => new AuthError(code, code);

describe('signInErrorMessage', () => {
  it.each([
    ['INVALID_CREDENTIALS', 'Incorrect email or password. Please try again.'],
    ['TOO_MANY_ATTEMPTS', 'Too many attempts. Wait a few minutes, then try again.'],
    ['NETWORK', "Can't reach Trolley right now. Check your connection and try again."],
    [
      'TEMP_PASSWORD_EXPIRED',
      'Your temporary password has expired. Ask your household admin for a new one.',
    ],
    ['MISSING_INPUT', 'Enter your email and password.'],
    ['ALREADY_SIGNED_IN', "You're already signed in. Reload the page to continue."],
    ['UNKNOWN', 'Something went wrong. Please try again.'],
    ['INVALID_CODE', 'Something went wrong. Please try again.'],
  ] as const)('maps %s', (code, message) => {
    expect(signInErrorMessage(err(code))).toBe(message);
  });

  it('treats non-AuthErrors as unknown', () => {
    expect(signInErrorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });

  it('never mentions Cognito jargon', () => {
    for (const code of [
      'INVALID_CREDENTIALS',
      'TEMP_PASSWORD_EXPIRED',
      'TOO_MANY_ATTEMPTS',
    ] as const) {
      expect(signInErrorMessage(err(code))).not.toMatch(/cognito|exception|username/i);
    }
  });
});

describe('newPasswordFailure', () => {
  it('routes expiry and policy errors specially', () => {
    expect(newPasswordFailure(err('TEMP_PASSWORD_EXPIRED'))).toEqual({ kind: 'expired' });
    expect(newPasswordFailure(err('PASSWORD_POLICY'))).toEqual({ kind: 'policy' });
  });
  it('maps network errors to a banner', () => {
    expect(newPasswordFailure(err('NETWORK'))).toMatchObject({ kind: 'banner' });
  });
});

describe('reset errors', () => {
  it('maps code errors', () => {
    expect(resetErrorFailure(err('INVALID_CODE'))).toEqual({
      kind: 'code',
      message: "That code isn't right. Check your email and try again.",
    });
    expect(resetErrorFailure(err('EXPIRED_CODE'))).toEqual({
      kind: 'banner',
      message: 'That code has expired. Tap Resend to get a new one.',
    });
    expect(resetErrorFailure(err('PASSWORD_POLICY')).kind).toBe('password');
  });
  it('uses the request-specific rate limit copy', () => {
    expect(requestCodeErrorMessage(err('TOO_MANY_ATTEMPTS'))).toBe(
      'Too many requests. Wait a few minutes, then try again.',
    );
  });
});

describe('validateEmail', () => {
  it('validates', () => {
    expect(validateEmail('  ')).toBe('Enter your email address.');
    expect(validateEmail('nope')).toBe("That email address doesn't look right.");
    expect(validateEmail('a@b.co')).toBeNull();
  });
});
