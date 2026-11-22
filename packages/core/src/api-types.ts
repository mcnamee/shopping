/** Response shapes shared between services/api and apps/web. */

export interface HealthResponse {
  status: 'ok';
}

export interface MeResponse {
  userId: string;
  email: string;
  householdId: string;
}

export type ErrorCode = 'UNAUTHORISED' | 'NO_HOUSEHOLD' | 'FORBIDDEN' | 'NOT_FOUND' | 'INTERNAL';

export interface ErrorResponse {
  code: ErrorCode;
  message: string;
}
