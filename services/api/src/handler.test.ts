import type { Context } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createHandler, handler } from './handler';
import { createRouter, type ApiEvent } from './router';

function event(routeKey: string, claims?: Record<string, unknown>): ApiEvent {
  const [method = 'GET', path = '/'] = routeKey.split(' ');
  return {
    version: '2.0',
    routeKey,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    isBase64Encoded: false,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api',
      domainName: 'example.com',
      domainPrefix: 'example',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req-1',
      routeKey,
      stage: '$default',
      time: '',
      timeEpoch: 0,
      ...(claims ? { authorizer: { jwt: { claims, scopes: null } } } : {}),
    },
  };
}

const context = { awsRequestId: 'aws-req-1' } as Context;

const idClaims = {
  sub: 'user-1',
  email: 'a@example.com',
  token_use: 'id',
  'custom:householdId': 'home-1',
};

function body(result: Awaited<ReturnType<typeof handler>>): unknown {
  return JSON.parse(String(result.body));
}

describe('handler', () => {
  it('GET /api/health returns ok without auth', async () => {
    const res = await handler(event('GET /api/health'), context);
    expect(res.statusCode).toBe(200);
    expect(body(res)).toEqual({ status: 'ok' });
    expect(res.headers?.['cache-control']).toBe('no-store');
  });

  it('GET /api/me returns the identity from verified claims', async () => {
    const res = await handler(event('GET /api/me', idClaims), context);
    expect(res.statusCode).toBe(200);
    expect(body(res)).toEqual({ userId: 'user-1', email: 'a@example.com', householdId: 'home-1' });
  });

  it('GET /api/me returns 403 when the household claim is missing', async () => {
    const { 'custom:householdId': _omit, ...claims } = idClaims;
    const res = await handler(event('GET /api/me', claims), context);
    expect(res.statusCode).toBe(403);
    expect(body(res)).toMatchObject({ code: 'NO_HOUSEHOLD' });
  });

  it('GET /api/me returns 403 for an access token', async () => {
    const res = await handler(event('GET /api/me', { ...idClaims, token_use: 'access' }), context);
    expect(res.statusCode).toBe(403);
    expect(body(res)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('GET /api/me returns 401 when no authoriser claims are present', async () => {
    const res = await handler(event('GET /api/me'), context);
    expect(res.statusCode).toBe(401);
    expect(body(res)).toMatchObject({ code: 'UNAUTHORISED' });
  });

  it('ignores any household id supplied in the request', async () => {
    const e = event('GET /api/me', idClaims);
    e.queryStringParameters = { householdId: 'someone-else' };
    e.headers = { 'x-household-id': 'someone-else' };
    e.body = JSON.stringify({ householdId: 'someone-else' });
    const res = await handler(e, context);
    expect(body(res)).toMatchObject({ householdId: 'home-1' });
  });

  it('returns 404 for unknown routes', async () => {
    const res = await handler(event('GET /api/nope'), context);
    expect(res.statusCode).toBe(404);
  });
});

describe('createHandler', () => {
  it('returns 500 without leaking details when a handler throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const boom = createHandler(
      createRouter({
        'GET /api/boom': {
          auth: false,
          handler: () => {
            throw new Error('secret detail');
          },
        },
      }),
    );
    const res = await boom(event('GET /api/boom'), context);
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret detail');
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
