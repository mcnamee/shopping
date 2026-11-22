/**
 * In-browser mock of the Trolley API, used when VITE_MOCK_AUTH=true so the app and
 * Playwright tests run against `vite dev` with no AWS. Add handlers here as new
 * endpoints are built, mirroring services/api behaviour (incl. 401/403 rules).
 */
import type { ErrorResponse, HealthResponse, MeResponse } from '@trolley/core';

type Claims = Record<string, string>;
type MockHandler = (ctx: { claims: Claims | null; body: unknown; url: URL }) => Response;
interface MockRoute {
  auth: boolean;
  handler: MockHandler;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function decodeMockToken(header: string | null): Claims | null {
  const match = header?.match(/^Bearer mock\.([\w-]+)$/);
  if (!match?.[1]) return null;
  try {
    const b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b64)))) as Claims;
  } catch {
    return null;
  }
}

/** Keyed like HTTP API route keys: "METHOD /api/path". */
export const mockRoutes: Record<string, MockRoute> = {
  'GET /api/health': {
    auth: false,
    handler: () => json(200, { status: 'ok' } satisfies HealthResponse),
  },
  'GET /api/me': {
    auth: true,
    handler: ({ claims }) => {
      const householdId = claims?.['custom:householdId'];
      if (!claims?.sub || !householdId) {
        return json(403, {
          code: 'NO_HOUSEHOLD',
          message: 'This account is not linked to a household',
        } satisfies ErrorResponse);
      }
      return json(200, {
        userId: claims.sub,
        email: claims.email ?? '',
        householdId,
      } satisfies MeResponse);
    },
  },
};

export const mockFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    'http://mock.local',
  );
  const method = (init?.method ?? 'GET').toUpperCase();
  const route = mockRoutes[`${method} ${url.pathname}`];
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (!route) return json(404, { code: 'NOT_FOUND', message: 'Not found' } satisfies ErrorResponse);

  const headers = new Headers(init?.headers);
  const claims = decodeMockToken(headers.get('authorization'));
  if (route.auth && !claims) {
    return json(401, { code: 'UNAUTHORISED', message: 'Unauthorised' } satisfies ErrorResponse);
  }

  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
  return route.handler({ claims, body, url });
};
