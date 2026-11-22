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
  internal: () => json(500, { code: 'INTERNAL', message: 'Internal server error' }),
};
