import { describe, expect, it } from 'vitest';
import { toAuthError } from './errors';
import { AuthError } from './types';

function named(name: string, message = 'x') {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe('toAuthError', () => {
  it.each([
    ['NotAuthorizedException', 'INVALID_CREDENTIALS'],
    ['UserNotFoundException', 'INVALID_CREDENTIALS'],
    ['InvalidPasswordException', 'PASSWORD_POLICY'],
    ['CodeMismatchException', 'INVALID_CODE'],
    ['ExpiredCodeException', 'EXPIRED_CODE'],
    ['LimitExceededException', 'TOO_MANY_ATTEMPTS'],
    ['UserAlreadyAuthenticatedException', 'ALREADY_SIGNED_IN'],
    ['SomethingElse', 'UNKNOWN'],
  ])('maps %s to %s', (name, code) => {
    expect(toAuthError(named(name)).code).toBe(code);
  });

  it('detects an expired temporary password', () => {
    const err = named(
      'NotAuthorizedException',
      'Temporary password has expired and must be reset by an administrator.',
    );
    expect(toAuthError(err).code).toBe('TEMP_PASSWORD_EXPIRED');
  });

  it('detects network failures', () => {
    expect(toAuthError(new TypeError('Failed to fetch')).code).toBe('NETWORK');
  });

  it('passes AuthErrors through', () => {
    const err = new AuthError('INVALID_CODE', 'bad');
    expect(toAuthError(err)).toBe(err);
  });
});
