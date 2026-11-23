/**
 * OAuth 2.1 authorisation server shim for the chatbot connector (D-083, D-084, D-089).
 *
 * Public (no Cognito JWT; OAuth clients call these):
 *   GET  /.well-known/oauth-authorization-server     RFC 8414 metadata
 *   GET  /.well-known/oauth-protected-resource[/mcp] RFC 9728 metadata for /mcp
 *   POST /oauth/register                             RFC 7591 dynamic client registration
 *   GET  /oauth/authorize                            validates, then 302 to the SPA /connect
 *   POST /oauth/token                                authorization_code (PKCE S256) + refresh_token
 *   POST /oauth/revoke                               RFC 7009
 * SPA (Cognito JWT, household from the token):
 *   GET  /api/oauth/requests/{requestId}             pending connection for the consent screen
 *   POST /api/oauth/consent                          Allow/Deny -> { redirectUrl }
 *   GET  /api/connected-apps, DELETE /api/connected-apps/{grantId}
 *
 * Logs carry client id, outcome and timing only: never a token, code, verifier or state (B8).
 */
import type {
  ConnectedApp,
  ConnectedAppsResponse,
  OAuthConsentResponse,
  OAuthRequestDetails,
} from '@trolley/core';
import { errors, fail, json, readJsonBody, type HttpResult } from '../http';
import type { ApiEvent, AuthedRequest, PublicRequest, RouteTable } from '../router';
import { hashForKey, newId, newSecret, pkceMatches, safeEqual, sha256 } from './crypto';
import {
  CODE_TTL_MS,
  REQUEST_TTL_MS,
  type ClientRecord,
  type OAuthStore,
  type PendingRequest,
} from './store';
import {
  basicCredentials,
  cleanClientName,
  parseAuthorizeRest,
  parseFormBody,
  parseRegistration,
  resourceMatches,
} from './validate';

export interface OAuthDeps {
  store: OAuthStore;
  /** Public origin, e.g. "https://trolley.mcn.am" (issuer; /mcp lives under it). */
  origin: string;
  now: () => Date;
  log?: (entry: Record<string, unknown>) => void;
}

/** Registrations per source address per hour (B3), and a global hourly backstop. */
export const REGISTER_PER_IP_PER_HOUR = 20;
export const REGISTER_GLOBAL_PER_HOUR = 200;
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
/** B-018: fixed one-minute windows, counted per viewer address and per client. */
export const AUTHORIZE_PER_IP_PER_MIN = 30;
export const AUTHORIZE_PER_CLIENT_PER_MIN = 20;
export const TOKEN_PER_IP_PER_MIN = 60;
export const TOKEN_PER_CLIENT_PER_MIN = 30;

export const SCOPE = 'lists';

export function urlsFor(origin: string) {
  return {
    issuer: origin,
    mcp: `${origin}/mcp`,
    resourceMetadata: `${origin}/.well-known/oauth-protected-resource/mcp`,
    connect: `${origin}/connect`,
  };
}

/** Public origin from PUBLIC_ORIGIN (CDK: https://<domainName>). */
export function originFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PUBLIC_ORIGIN?.trim();
  if (!raw) throw new Error('PUBLIC_ORIGIN is not set');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_ORIGIN must be an https origin');
  }
  return url.origin;
}

// ------------------------------------------------------------------ HTTP helpers

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type, MCP-Protocol-Version',
  'access-control-max-age': '600',
};

function oauthJson(status: number, body: unknown, extra: Record<string, string> = {}): HttpResult {
  return {
    statusCode: status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      pragma: 'no-cache',
      ...CORS,
      ...extra,
    },
    body: JSON.stringify(body),
  };
}

function oauthError(status: number, error: string, description: string, extra = {}): HttpResult {
  return oauthJson(status, { error, error_description: description }, extra);
}

const preflight = (): HttpResult => ({ statusCode: 204, headers: { ...CORS } });

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/** Bad client or redirect URI: never redirect (B4); a plain page instead. */
function errorPage(
  detail: string,
  status = 400,
  title = "This connection link isn't valid",
): HttpResult {
  const html =
    '<!doctype html><html lang="en-AU"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>Trolley - ${title}</title></head>` +
    '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem">' +
    `<h1>${title}</h1>` +
    "<p>Start again from the app you're connecting.</p>" +
    `<p style="color:#666;font-size:0.875rem">${escapeHtml(detail)}</p></body></html>`;
  return {
    statusCode: status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...(status === 429 ? { 'retry-after': '60' } : {}),
    },
    body: html,
  };
}

function header(event: ApiEvent, name: string): string | undefined {
  const headers = event.headers ?? {};
  return headers[name] ?? Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1];
}

/** Query string with duplicates detected (API Gateway joins repeats with commas). */
function parseQuery(event: ApiEvent): Record<string, string> | null {
  const params = new URLSearchParams(event.rawQueryString ?? '');
  const out: Record<string, string> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    if (all.length !== 1) return null;
    out[key] = all[0] as string;
  }
  return out;
}

/**
 * Viewer address for rate limiting. CloudFront appends the viewer IP to X-Forwarded-For
 * (anything before it is client-supplied); API Gateway's sourceIp is then CloudFront.
 */
export function viewerAddress(event: ApiEvent): string {
  const source = event.requestContext.http.sourceIp;
  const xff = (header(event, 'x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== source);
  return xff.at(-1) ?? source;
}

function withParams(base: string, params: Record<string, string | null>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== null) url.searchParams.set(k, v);
  return url.toString();
}

/** Exact match against every registered URI (no early exit). */
function registeredRedirect(client: ClientRecord, uri: string): boolean {
  let found = false;
  for (const r of client.redirectUris) if (safeEqual(r, uri)) found = true;
  return found;
}

/** "Sam" from the ID token's name, else the email's local part. */
export function displayNameFromClaims(claims: Readonly<Record<string, unknown>> | undefined) {
  const pick = (k: string) => (typeof claims?.[k] === 'string' ? (claims[k] as string) : '');
  const raw =
    pick('name') ||
    pick('given_name') ||
    pick('email').split('@')[0] ||
    'Someone in your household';
  return cleanClientName(raw).slice(0, 60);
}

// ------------------------------------------------------------------ routes

export function createOAuthRoutes(getDeps: () => OAuthDeps): RouteTable {
  const nowMs = () => getDeps().now().getTime();
  const log = (entry: Record<string, unknown>) => {
    const d = getDeps();
    (d.log ?? ((e) => console.log(JSON.stringify(e))))({ area: 'oauth', ...entry });
  };

  function authServerMetadata(): HttpResult {
    const { origin } = getDeps();
    const methods = ['none', 'client_secret_post', 'client_secret_basic'];
    return oauthJson(200, {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: methods,
      revocation_endpoint_auth_methods_supported: methods,
      scopes_supported: [SCOPE],
      authorization_response_iss_parameter_supported: true,
    });
  }

  function resourceMetadata(): HttpResult {
    const { origin } = getDeps();
    return oauthJson(200, {
      resource: urlsFor(origin).mcp,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
      scopes_supported: [SCOPE],
      resource_name: 'Trolley',
    });
  }

  async function register({ event }: PublicRequest): Promise<HttpResult> {
    const { store } = getDeps();
    const now = nowMs();
    const ipKey = hashForKey(viewerAddress(event));
    const allowed =
      (await store.consume('REG', ipKey, HOUR_MS, REGISTER_PER_IP_PER_HOUR, now)) &&
      (await store.consume('REG', 'ALL', HOUR_MS, REGISTER_GLOBAL_PER_HOUR, now));
    if (!allowed) {
      log({ event: 'register', outcome: 'rate_limited' });
      return oauthError(429, 'slow_down', 'Too many registrations - try again later');
    }
    let body: unknown;
    try {
      body = readJsonBody(event);
    } catch {
      return oauthError(400, 'invalid_client_metadata', 'Body must be valid JSON');
    }
    const parsed = parseRegistration(body);
    if (!parsed.ok) {
      log({ event: 'register', outcome: parsed.error });
      return oauthError(400, parsed.error, parsed.description);
    }
    const r = parsed.value;
    const clientId = newId();
    const secret = r.authMethod === 'none' ? null : newSecret();
    await store.createClient({
      clientId,
      clientName: r.clientName,
      redirectUris: r.redirectUris,
      authMethod: r.authMethod,
      secretHash: secret ? sha256(secret) : null,
      createdAt: now,
      authorisedAt: null,
    });
    log({ event: 'register', clientId, outcome: 'ok' });
    return oauthJson(201, {
      client_id: clientId,
      client_id_issued_at: Math.floor(now / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: r.clientName,
      redirect_uris: r.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: r.authMethod,
    });
  }

  async function authorize({ event }: PublicRequest): Promise<HttpResult> {
    const { store, origin } = getDeps();
    const now = nowMs();
    const ipKey = hashForKey(viewerAddress(event));
    if (!(await store.consume('AUTHIP', ipKey, MIN_MS, AUTHORIZE_PER_IP_PER_MIN, now))) {
      log({ event: 'authorize', outcome: 'rate_limited', scope: 'ip' });
      return errorPage(
        'Too many attempts. Wait a minute, then try again.',
        429,
        'Too many attempts',
      );
    }
    const q = parseQuery(event);
    if (!q) return errorPage('A parameter was repeated.');
    if (
      q.client_id &&
      !(await store.consume(
        'AUTHCL',
        hashForKey(q.client_id),
        MIN_MS,
        AUTHORIZE_PER_CLIENT_PER_MIN,
        now,
      ))
    ) {
      log({ event: 'authorize', clientId: q.client_id, outcome: 'rate_limited', scope: 'client' });
      return errorPage(
        'Too many attempts. Wait a minute, then try again.',
        429,
        'Too many attempts',
      );
    }
    const client = q.client_id ? await store.getClient(q.client_id, now) : null;
    if (!client) {
      log({ event: 'authorize', outcome: 'unknown_client' });
      return errorPage('The app is not registered, or its registration expired.');
    }
    const redirectUri = q.redirect_uri;
    if (!redirectUri || !registeredRedirect(client, redirectUri)) {
      log({ event: 'authorize', clientId: client.clientId, outcome: 'redirect_mismatch' });
      return errorPage('The return address does not match the app’s registration.');
    }
    const rest = parseAuthorizeRest(q, urlsFor(origin).mcp);
    if (!rest.ok) {
      log({ event: 'authorize', clientId: client.clientId, outcome: rest.error });
      return {
        statusCode: 302,
        headers: {
          location: withParams(redirectUri, {
            error: rest.error,
            error_description: rest.description,
            state: q.state ?? null,
            iss: origin,
          }),
          'cache-control': 'no-store',
        },
      };
    }
    const requestId = newId();
    await store.putRequest({
      requestId,
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUri,
      ...rest.value,
      expiresAt: now + REQUEST_TTL_MS,
    });
    log({ event: 'authorize', clientId: client.clientId, outcome: 'pending' });
    return {
      statusCode: 302,
      headers: {
        location: withParams(urlsFor(origin).connect, { request: requestId }),
        'cache-control': 'no-store',
      },
    };
  }

  /** Client authentication at the token and revocation endpoints. */
  async function authenticateClient(
    event: ApiEvent,
    form: Record<string, string>,
  ): Promise<{ ok: true; client: ClientRecord } | { ok: false; result: HttpResult }> {
    const basic = basicCredentials(header(event, 'authorization'));
    if (basic && form.client_id && form.client_id !== basic.clientId) {
      return {
        ok: false,
        result: oauthError(400, 'invalid_request', 'client_id does not match the credentials'),
      };
    }
    const clientId = basic?.clientId ?? form.client_id;
    const client = clientId ? await getDeps().store.getClient(clientId, nowMs()) : null;
    const unauthorised = () => ({
      ok: false as const,
      result: oauthError(
        401,
        'invalid_client',
        'Client authentication failed',
        basic ? { 'www-authenticate': 'Basic realm="trolley"' } : {},
      ),
    });
    if (!client) return unauthorised();
    if (client.secretHash) {
      const secret = basic?.secret ?? form.client_secret;
      if (!secret || !safeEqual(sha256(secret), client.secretHash)) return unauthorised();
    }
    return { ok: true, client };
  }

  function tokenResponse(access: string, refresh: string): HttpResult {
    return oauthJson(200, {
      access_token: access,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refresh,
      scope: SCOPE,
    });
  }

  async function token({ event }: PublicRequest): Promise<HttpResult> {
    const started = Date.now();
    const { store, origin } = getDeps();
    const now = nowMs();
    if (
      !(await store.consume(
        'TOKIP',
        hashForKey(viewerAddress(event)),
        MIN_MS,
        TOKEN_PER_IP_PER_MIN,
        now,
      ))
    ) {
      log({ event: 'token', outcome: 'rate_limited', scope: 'ip' });
      return oauthError(429, 'slow_down', 'Too many requests - try again shortly', {
        'retry-after': '60',
      });
    }
    const form = parseFormBody(event.body, event.isBase64Encoded, header(event, 'content-type'));
    if (!form) return oauthError(400, 'invalid_request', 'Malformed request body');
    const limitedId = basicCredentials(header(event, 'authorization'))?.clientId ?? form.client_id;
    if (
      limitedId &&
      !(await store.consume('TOKCL', hashForKey(limitedId), MIN_MS, TOKEN_PER_CLIENT_PER_MIN, now))
    ) {
      log({ event: 'token', clientId: limitedId, outcome: 'rate_limited', scope: 'client' });
      return oauthError(429, 'slow_down', 'Too many requests - try again shortly', {
        'retry-after': '60',
      });
    }
    const auth = await authenticateClient(event, form);
    if (!auth.ok) {
      log({ event: 'token', outcome: 'invalid_client' });
      return auth.result;
    }
    const { client } = auth;
    const done = (outcome: string, result: HttpResult, grantType = form.grant_type) => {
      log({
        event: 'token',
        grantType,
        clientId: client.clientId,
        outcome,
        ms: Date.now() - started,
      });
      return result;
    };
    const invalidGrant = (outcome: string) =>
      done(outcome, oauthError(400, 'invalid_grant', 'The grant is invalid, expired or revoked'));

    if (form.resource !== undefined && !resourceMatches(form.resource, urlsFor(origin).mcp)) {
      return done('invalid_target', oauthError(400, 'invalid_target', 'Unknown resource'));
    }

    if (form.grant_type === 'authorization_code') {
      if (!form.code || !form.code_verifier || !form.redirect_uri) {
        return done(
          'invalid_request',
          oauthError(400, 'invalid_request', 'code, code_verifier and redirect_uri are required'),
        );
      }
      const codeHash = sha256(form.code);
      const code = await store.getCode(codeHash);
      if (!code) return invalidGrant('unknown_code');
      if (code.used) {
        // Replay of a redeemed code: revoke everything issued from it (B6).
        await store.revokeGrant(code.householdId, code.grantId);
        return invalidGrant('code_reuse');
      }
      if (now > code.expiresAt) return invalidGrant('code_expired');
      if (!safeEqual(code.clientId, client.clientId)) return invalidGrant('client_mismatch');
      if (!safeEqual(code.redirectUri, form.redirect_uri)) return invalidGrant('redirect_mismatch');
      if (!pkceMatches(form.code_verifier, code.codeChallenge)) return invalidGrant('pkce_failed');
      const access = newSecret();
      const refresh = newSecret();
      const redeemed = await store.redeemCode(
        codeHash,
        code,
        client,
        { accessHash: sha256(access), refreshHash: sha256(refresh) },
        now,
      );
      if (!redeemed) {
        await store.revokeGrant(code.householdId, code.grantId);
        return invalidGrant('code_reuse');
      }
      return done('ok', tokenResponse(access, refresh));
    }

    if (form.grant_type === 'refresh_token') {
      if (!form.refresh_token) {
        return done(
          'invalid_request',
          oauthError(400, 'invalid_request', 'refresh_token is required'),
        );
      }
      const oldHash = sha256(form.refresh_token);
      const old = await store.getToken(oldHash);
      if (!old || old.kind !== 'refresh') return invalidGrant('unknown_token');
      if (!safeEqual(old.clientId, client.clientId)) return invalidGrant('client_mismatch');
      if (old.used) {
        // A rotated refresh token came back: assume it leaked, revoke the grant (B6).
        await store.revokeGrant(old.householdId, old.grantId);
        return invalidGrant('refresh_reuse');
      }
      if (now > old.expiresAt) return invalidGrant('refresh_expired');
      const access = newSecret();
      const refresh = newSecret();
      const outcome = await store.rotateRefresh(
        oldHash,
        old,
        { accessHash: sha256(access), refreshHash: sha256(refresh) },
        now,
      );
      if (outcome === 'reused') {
        await store.revokeGrant(old.householdId, old.grantId);
        return invalidGrant('refresh_reuse');
      }
      if (outcome === 'revoked') return invalidGrant('grant_revoked');
      return done('ok', tokenResponse(access, refresh));
    }

    return done(
      'unsupported_grant_type',
      oauthError(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token'),
    );
  }

  /** RFC 7009: 200 whether or not the token was known. */
  async function revoke({ event }: PublicRequest): Promise<HttpResult> {
    const { store } = getDeps();
    const form = parseFormBody(event.body, event.isBase64Encoded, header(event, 'content-type'));
    if (!form || !form.token) return oauthError(400, 'invalid_request', 'token is required');
    const auth = await authenticateClient(event, form);
    if (!auth.ok) return auth.result;
    const hash = sha256(form.token);
    const t = await store.getToken(hash);
    let outcome = 'unknown';
    if (t && safeEqual(t.clientId, auth.client.clientId)) {
      if (t.kind === 'refresh') await store.revokeGrant(t.householdId, t.grantId);
      else await store.deleteToken(hash);
      outcome = `revoked_${t.kind}`;
    }
    log({ event: 'revoke', clientId: auth.client.clientId, outcome });
    return { statusCode: 200, headers: { 'cache-control': 'no-store', ...CORS }, body: '' };
  }

  // ------------------------------------------------------------------ SPA (JWT)

  async function pendingRequest(req: AuthedRequest): Promise<PendingRequest> {
    const id = req.event.pathParameters?.requestId ?? '';
    return (await getDeps().store.getRequest(id, nowMs())) ?? fail.notFound();
  }

  async function requestDetails(req: AuthedRequest): Promise<HttpResult> {
    const r = await pendingRequest(req);
    return json(200, {
      requestId: r.requestId,
      clientName: r.clientName,
      redirectHost: new URL(r.redirectUri).host,
      expiresAt: new Date(r.expiresAt).toISOString(),
    } satisfies OAuthRequestDetails);
  }

  async function consent(req: AuthedRequest): Promise<HttpResult> {
    const { store, origin } = getDeps();
    const body = readJsonBody(req.event);
    if (typeof body !== 'object' || body === null)
      return fail.validation('Body must be a JSON object');
    const { requestId, allow } = body as Record<string, unknown>;
    if (typeof requestId !== 'string') return fail.validation('requestId is required', 'requestId');
    if (typeof allow !== 'boolean') return fail.validation('allow must be true or false', 'allow');
    const now = nowMs();
    const r = await store.getRequest(requestId, now);
    // Single use: a second Allow (double tap, other tab) finds nothing.
    if (!r || !(await store.takeRequest(requestId))) return errors.notFound();
    const reply = (params: Record<string, string | null>) =>
      json(200, {
        redirectUrl: withParams(r.redirectUri, { ...params, state: r.state, iss: origin }),
      } satisfies OAuthConsentResponse);
    if (!allow) {
      log({ event: 'consent', clientId: r.clientId, outcome: 'denied' });
      return reply({ error: 'access_denied', error_description: 'The user declined' });
    }
    const client = await store.getClient(r.clientId, now);
    if (!client) return errors.notFound();
    const code = newSecret();
    await store.putCode(sha256(code), {
      clientId: client.clientId,
      redirectUri: r.redirectUri,
      codeChallenge: r.codeChallenge,
      userId: req.household.userId,
      householdId: req.household.householdId,
      grantId: newId(),
      connectedBy: displayNameFromClaims(req.event.requestContext.authorizer?.jwt?.claims),
      scope: r.scope,
      expiresAt: now + CODE_TTL_MS,
    });
    log({ event: 'consent', clientId: r.clientId, outcome: 'allowed' });
    return reply({ code });
  }

  async function connectedApps(req: AuthedRequest): Promise<HttpResult> {
    const { store, origin } = getDeps();
    const grants = await store.listGrants(req.household.householdId);
    const apps: ConnectedApp[] = grants
      .sort((a, b) => b.createdAt - a.createdAt || a.grantId.localeCompare(b.grantId))
      .map((g) => ({
        grantId: g.grantId,
        clientName: g.clientName,
        connectedBy: g.connectedBy,
        connectedAt: new Date(g.createdAt).toISOString(),
        lastUsedAt: g.lastUsedAt === null ? null : new Date(g.lastUsedAt).toISOString(),
      }));
    return json(200, { apps, mcpUrl: urlsFor(origin).mcp } satisfies ConnectedAppsResponse);
  }

  async function disconnect(req: AuthedRequest): Promise<HttpResult> {
    const grantId = req.event.pathParameters?.grantId ?? '';
    const { store } = getDeps();
    const hh = req.household.householdId;
    const grant = await store.getGrant(hh, grantId);
    if (!grant || !(await store.revokeGrant(hh, grantId))) return errors.notFound();
    log({ event: 'disconnect', clientId: grant.clientId, outcome: 'revoked' });
    return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
  }

  const pub = (handler: (req: PublicRequest) => Promise<HttpResult> | HttpResult) => ({
    auth: false as const,
    handler,
  });
  const authed = (handler: (req: AuthedRequest) => Promise<HttpResult>) => ({
    auth: true as const,
    handler,
  });

  return {
    'GET /.well-known/oauth-authorization-server': pub(authServerMetadata),
    'OPTIONS /.well-known/oauth-authorization-server': pub(preflight),
    'GET /.well-known/oauth-protected-resource': pub(resourceMetadata),
    'OPTIONS /.well-known/oauth-protected-resource': pub(preflight),
    'GET /.well-known/oauth-protected-resource/mcp': pub(resourceMetadata),
    'OPTIONS /.well-known/oauth-protected-resource/mcp': pub(preflight),
    'POST /oauth/register': pub(register),
    'OPTIONS /oauth/register': pub(preflight),
    'GET /oauth/authorize': pub(authorize),
    'POST /oauth/token': pub(token),
    'OPTIONS /oauth/token': pub(preflight),
    'POST /oauth/revoke': pub(revoke),
    'OPTIONS /oauth/revoke': pub(preflight),
    'GET /api/oauth/requests/{requestId}': authed(requestDetails),
    'POST /api/oauth/consent': authed(consent),
    'GET /api/connected-apps': authed(connectedApps),
    'DELETE /api/connected-apps/{grantId}': authed(disconnect),
  };
}
