/**
 * User-facing copy for auth errors and validation (docs/ux/auth.md). Australian English,
 * no Cognito jargon. Each flow maps AuthError codes separately because the same code can
 * read differently (e.g. INVALID_CODE only happens on the reset screen).
 */
import { AuthError, type AuthErrorCode } from '../auth';

export const COPY = {
  network: "Can't reach Trolley right now. Check your connection and try again.",
  generic: 'Something went wrong. Please try again.',
  tooManyAttempts: 'Too many attempts. Wait a few minutes, then try again.',
  tooManyRequests: 'Too many requests. Wait a few minutes, then try again.',
  passwordRules: "Your password doesn't meet all the rules below.",
  sessionTimedOut: 'Your session timed out. Sign in again with your temporary password.',
} as const;

const codeOf = (err: unknown): AuthErrorCode => (err instanceof AuthError ? err.code : 'UNKNOWN');

export function signInErrorMessage(err: unknown): string {
  switch (codeOf(err)) {
    case 'INVALID_CREDENTIALS':
      return 'Incorrect email or password. Please try again.';
    case 'TOO_MANY_ATTEMPTS':
      return COPY.tooManyAttempts;
    case 'NETWORK':
      return COPY.network;
    case 'TEMP_PASSWORD_EXPIRED':
      return 'Your temporary password has expired. Ask your household admin for a new one.';
    case 'MISSING_INPUT':
      return 'Enter your email and password.';
    case 'ALREADY_SIGNED_IN':
      return "You're already signed in. Reload the page to continue.";
    default:
      return COPY.generic;
  }
}

export const UNSUPPORTED_STEP_MESSAGE =
  "Trolley can't sign you in with this account yet. Ask your household admin for help.";

export type NewPasswordFailure =
  { kind: 'expired' } | { kind: 'policy' } | { kind: 'banner'; message: string };

export function newPasswordFailure(err: unknown): NewPasswordFailure {
  switch (codeOf(err)) {
    case 'TEMP_PASSWORD_EXPIRED':
      return { kind: 'expired' };
    case 'PASSWORD_POLICY':
      return { kind: 'policy' };
    case 'NETWORK':
      return { kind: 'banner', message: COPY.network };
    case 'TOO_MANY_ATTEMPTS':
      return { kind: 'banner', message: COPY.tooManyAttempts };
    default:
      return { kind: 'banner', message: COPY.generic };
  }
}

export function requestCodeErrorMessage(err: unknown): string {
  switch (codeOf(err)) {
    case 'TOO_MANY_ATTEMPTS':
      return COPY.tooManyRequests;
    case 'NETWORK':
      return COPY.network;
    case 'RESET_NOT_ALLOWED':
      return "This account can't be reset yet. Sign in with your temporary password, or ask your household admin for help.";
    case 'MISSING_INPUT':
      return 'Enter your email address.';
    default:
      return COPY.generic;
  }
}

export type ResetFailure =
  | { kind: 'code'; message: string }
  | { kind: 'password'; message: string }
  | { kind: 'banner'; message: string };

export function resetErrorFailure(err: unknown): ResetFailure {
  switch (codeOf(err)) {
    case 'INVALID_CODE':
      return {
        kind: 'code',
        message: "That code isn't right. Check your email and try again.",
      };
    case 'EXPIRED_CODE':
      return {
        kind: 'banner',
        message: 'That code has expired. Tap Resend to get a new one.',
      };
    case 'PASSWORD_POLICY':
      return { kind: 'password', message: COPY.passwordRules };
    case 'TOO_MANY_ATTEMPTS':
      return { kind: 'banner', message: COPY.tooManyAttempts };
    case 'NETWORK':
      return { kind: 'banner', message: COPY.network };
    default:
      return { kind: 'banner', message: COPY.generic };
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Enter your email address.';
  if (!EMAIL_PATTERN.test(v)) return "That email address doesn't look right.";
  return null;
}
