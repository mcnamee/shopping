/**
 * Mock of the Stage 4 SPA endpoints (consent screen and Connected apps), mirroring
 * services/api/src/oauth/routes.ts. State lives in localStorage like the Stage 2 mock.
 *
 * Pending connection requests (for /connect?request=<id>):
 *   "mock-claude"  -> Claude, returns to claude.ai
 *   "mock-chatgpt" -> ChatGPT, returns to chatgpt.com
 *   "mock-long"    -> a 60-character app name (truncation)
 *   anything else  -> 404 (invalid or expired link)
 * Unlike the server, mock requests are reusable so tests can repeat them. Allow adds a
 * connected app for the household; Deny adds nothing.
 */
import type {
  ShortcutKey,
  ConnectedApp,
  ConnectedAppsResponse,
  OAuthConsentResponse,
  OAuthRequestDetails,
} from '@trolley/core';

type Claims = Record<string, string>;
interface Ctx {
  claims: Claims | null;
  body: unknown;
  url: URL;
  params: Record<string, string>;
}

export const MOCK_MCP_URL = 'https://trolley.mcn.am/mcp';
export const MOCK_MAX_SHORTCUT_KEYS = 5;
export const MOCK_STAGE4_KEY = 'trolley.mock.stage4.v1';

const REQUESTS: Record<string, { clientName: string; redirectUri: string }> = {
  'mock-claude': { clientName: 'Claude', redirectUri: 'https://claude.ai/api/mcp/auth_callback' },
  'mock-chatgpt': {
    clientName: 'ChatGPT',
    redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
  },
  'mock-long': {
    clientName: 'A very long connector name that keeps going and going on and',
    redirectUri: 'https://example.com/oauth/callback',
  },
};

interface State {
  apps: Record<string, ConnectedApp[]>;
  shortcutKeys?: Record<string, ShortcutKey[]>;
}

let memory: State = { apps: {} };

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function load(): State {
  try {
    const raw = storage()?.getItem(MOCK_STAGE4_KEY);
    if (raw) memory = JSON.parse(raw) as State;
  } catch {
    // keep memory
  }
  return memory;
}

function save(): void {
  try {
    storage()?.setItem(MOCK_STAGE4_KEY, JSON.stringify(memory));
  } catch {
    // in-memory only
  }
}

/** Test helper: forget all Stage 4 mock state. */
export function resetMockStage4(): void {
  memory = { apps: {}, shortcutKeys: {} };
  try {
    storage()?.removeItem(MOCK_STAGE4_KEY);
  } catch {
    // ignore
  }
}

/** Test helper: set a household's connected apps. */
export function seedMockConnectedApps(householdId: string, apps: ConnectedApp[]): void {
  load().apps[householdId] = apps;
  save();
}

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const notFound = () => json(404, { code: 'NOT_FOUND', message: 'Not found' });
const invalid = (message: string, field: string) =>
  json(400, { code: 'VALIDATION', message, field });

function authed(handler: (ctx: Ctx & { householdId: string; claims: Claims }) => Response) {
  return {
    auth: true,
    handler: (ctx: Ctx): Response => {
      const householdId = ctx.claims?.['custom:householdId'];
      if (!householdId || !ctx.claims?.sub) {
        return json(403, {
          code: 'NO_HOUSEHOLD',
          message: 'This account is not linked to a household',
        });
      }
      return handler({ ...ctx, householdId, claims: ctx.claims });
    },
  };
}

function withParams(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export function createStage4MockRoutes() {
  return {
    'GET /api/oauth/requests/{requestId}': authed(({ params }) => {
      const id = params.requestId ?? '';
      const r = REQUESTS[id];
      if (!r) return notFound();
      return json(200, {
        requestId: id,
        clientName: r.clientName,
        redirectHost: new URL(r.redirectUri).host,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      } satisfies OAuthRequestDetails);
    }),
    'POST /api/oauth/consent': authed(({ body, householdId, claims }) => {
      const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
      if (typeof b.requestId !== 'string') return invalid('requestId is required', 'requestId');
      if (typeof b.allow !== 'boolean') return invalid('allow must be true or false', 'allow');
      const r = REQUESTS[b.requestId];
      if (!r) return notFound();
      if (!b.allow) {
        return json(200, {
          redirectUrl: withParams(r.redirectUri, {
            error: 'access_denied',
            error_description: 'The user declined',
            state: 'mock-state',
          }),
        } satisfies OAuthConsentResponse);
      }
      const state = load();
      const apps = (state.apps[householdId] ??= []);
      apps.unshift({
        grantId: crypto.randomUUID().replace(/-/g, '').slice(0, 22),
        clientName: r.clientName,
        connectedBy: claims.name || (claims.email ?? '').split('@')[0] || 'Someone',
        connectedAt: new Date().toISOString(),
        lastUsedAt: null,
      });
      save();
      return json(200, {
        redirectUrl: withParams(r.redirectUri, { code: 'mock-code', state: 'mock-state' }),
      } satisfies OAuthConsentResponse);
    }),
    'GET /api/connected-apps': authed(({ householdId }) =>
      json(200, {
        apps: load().apps[householdId] ?? [],
        mcpUrl: MOCK_MCP_URL,
      } satisfies ConnectedAppsResponse),
    ),
    'GET /api/shortcut-keys': authed(({ householdId }) =>
      json(200, {
        keys: load().shortcutKeys?.[householdId] ?? [],
        max: MOCK_MAX_SHORTCUT_KEYS,
      }),
    ),
    'POST /api/shortcut-keys': authed(({ body, householdId, claims }) => {
      const name = String((body as { name?: unknown } | null)?.name ?? '').trim();
      if (!name) return invalid('Give the key a name', 'name');
      if (name.length > 40) return invalid('Keep the name to 40 characters or fewer', 'name');
      const state = load();
      const all = ((state.shortcutKeys ??= {})[householdId] ??= []);
      if (all.length >= MOCK_MAX_SHORTCUT_KEYS) {
        return json(409, {
          code: 'CONFLICT',
          reason: 'LIMIT',
          message: `You can have up to ${MOCK_MAX_SHORTCUT_KEYS} keys. Revoke one first.`,
        });
      }
      const shortcutKey: ShortcutKey = {
        keyId: crypto.randomUUID().replace(/-/g, '').slice(0, 22),
        name,
        createdBy: claims.name || (claims.email ?? '').split('@')[0] || 'Someone',
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      };
      all.unshift(shortcutKey);
      save();
      return json(201, { key: `trl_${'MockKey0'.repeat(6)}abc`, shortcutKey });
    }),
    'DELETE /api/shortcut-keys/{keyId}': authed(({ householdId, params }) => {
      const state = load();
      const all = state.shortcutKeys?.[householdId] ?? [];
      const next = all.filter((k) => k.keyId !== params.keyId);
      if (next.length === all.length) return notFound();
      (state.shortcutKeys ??= {})[householdId] = next;
      save();
      return json(204, null);
    }),
    'DELETE /api/connected-apps/{grantId}': authed(({ householdId, params }) => {
      const state = load();
      const apps = state.apps[householdId] ?? [];
      const next = apps.filter((a) => a.grantId !== params.grantId);
      if (next.length === apps.length) return notFound();
      state.apps[householdId] = next;
      save();
      return json(204, null);
    }),
  };
}
