import { AuthError, type AuthErrorCode } from './types';

const BY_NAME: Record<string, AuthErrorCode> = {
  NotAuthorizedException: 'INVALID_CREDENTIALS',
  UserNotFoundException: 'INVALID_CREDENTIALS',
  InvalidPasswordException: 'PASSWORD_POLICY',
  CodeMismatchException: 'INVALID_CODE',
  ExpiredCodeException: 'EXPIRED_CODE',
  LimitExceededException: 'TOO_MANY_ATTEMPTS',
  TooManyRequestsException: 'TOO_MANY_ATTEMPTS',
  TooManyFailedAttemptsException: 'TOO_MANY_ATTEMPTS',
  EmptySignInUsername: 'MISSING_INPUT',
  EmptySignInPassword: 'MISSING_INPUT',
  EmptyResetPasswordUsername: 'MISSING_INPUT',
  EmptyConfirmResetPasswordUsername: 'MISSING_INPUT',
  EmptyConfirmResetPasswordNewPassword: 'MISSING_INPUT',
  EmptyConfirmResetPasswordConfirmationCode: 'MISSING_INPUT',
  EmptyConfirmSignInChallengeResponse: 'MISSING_INPUT',
  UserAlreadyAuthenticatedException: 'ALREADY_SIGNED_IN',
  NetworkError: 'NETWORK',
};

/** Normalise an Amplify/Cognito error into an AuthError with a stable code. */
export function toAuthError(err: unknown): AuthError {
  if (err instanceof AuthError) return err;

  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);

  if (name === 'NotAuthorizedException') {
    if (/temporary password has expired/i.test(message)) {
      return new AuthError('TEMP_PASSWORD_EXPIRED', message, { cause: err });
    }
    if (/cannot be reset in the current state/i.test(message)) {
      return new AuthError('RESET_NOT_ALLOWED', message, { cause: err });
    }
  }
  if (err instanceof TypeError && /fetch|network/i.test(message)) {
    return new AuthError('NETWORK', message, { cause: err });
  }

  return new AuthError(BY_NAME[name] ?? 'UNKNOWN', message, { cause: err });
}
