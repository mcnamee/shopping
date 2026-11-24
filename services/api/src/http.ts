import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export type HttpResult = APIGatewayProxyStructuredResultV2;

export function json(statusCode: number, body: unknown): HttpResult {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

/** Error bodies always carry a stable machine-readable `code` (see ErrorCode in @trolley/core). */
export const errors = {
  unauthorised: () => json(401, { code: 'UNAUTHORISED', message: 'Unauthorised' }),
  noHousehold: () =>
    json(403, { code: 'NO_HOUSEHOLD', message: 'This account is not linked to a household' }),
  forbidden: () => json(403, { code: 'FORBIDDEN', message: 'Forbidden' }),
  notFound: () => json(404, { code: 'NOT_FOUND', message: 'Not found' }),
  validation: (message: string, field?: string) =>
    json(400, { code: 'VALIDATION', message, ...(field ? { field } : {}) }),
  internal: () => json(500, { code: 'INTERNAL', message: 'Internal server error' }),
  rateLimited: (message: string) => json(429, { code: 'RATE_LIMITED', message }),
  conflict: (reason: ConflictReason, message: string, current?: unknown) =>
    json(409, { code: 'CONFLICT', reason, message, ...(current !== undefined ? { current } : {}) }),
};

export type ConflictReason = 'STALE' | 'LIST_ARCHIVED' | 'NOT_ARCHIVED' | 'LIMIT' | 'UNDO_EXPIRED';

/**
 * Thrown from deep inside a route (stores, services) to end the request with an error
 * response; the router turns it into the HTTP result.
 */
export class HttpFailure extends Error {
  override name = 'HttpFailure';
  constructor(public readonly result: HttpResult) {
    super(`HTTP ${String(result.statusCode)}`);
  }
}

export const fail = {
  notFound: (): never => {
    throw new HttpFailure(errors.notFound());
  },
  validation: (message: string, field?: string): never => {
    throw new HttpFailure(errors.validation(message, field));
  },
  conflict: (reason: ConflictReason, message: string, current?: unknown): never => {
    throw new HttpFailure(errors.conflict(reason, message, current));
  },
  rateLimited: (message: string): never => {
    throw new HttpFailure(errors.rateLimited(message));
  },
};

const MAX_BODY_BYTES = 16 * 1024;

/** Parse a JSON body (base64-aware). Missing body is `undefined`; bad JSON is a 400. */
export function readJsonBody(
  event: {
    body?: string | undefined;
    isBase64Encoded?: boolean;
  },
  maxChars = MAX_BODY_BYTES,
): unknown {
  const raw = event.body;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const text = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  if (text.length > maxChars) return fail.validation('Body is too large');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fail.validation('Body must be valid JSON');
  }
}
