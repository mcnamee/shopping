/**
 * OAuth request parsing and validation (pure; D-083). Anything that fails here is either
 * an error page (bad client / redirect) or an OAuth error response; nothing is trusted.
 */
import { CHALLENGE } from './crypto';

export const MAX_REDIRECT_URIS = 5;
export const MAX_REDIRECT_URI_LENGTH = 512;
export const MAX_CLIENT_NAME = 60;
const MAX_STATE = 1024;
const MAX_SCOPE = 200;

export type TokenAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';
const AUTH_METHODS: readonly TokenAuthMethod[] = [
  'none',
  'client_secret_post',
  'client_secret_basic',
];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Registered redirect URIs: absolute https URLs (any host: Claude, ChatGPT and others), or
 * http on a loopback host for desktop clients. No fragment, no credentials.
 */
export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.length > MAX_REDIRECT_URI_LENGTH || value.includes('#')) return false;
  if (/[\s\p{Cc}]/u.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || !url.hostname) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

/** Self-declared app name: control characters and markup removed, at most 60 characters. */
export function cleanClientName(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  const cleaned = text
    .replace(/\p{Cc}|\p{Cf}/gu, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...cleaned];
  const name =
    chars.length > MAX_CLIENT_NAME ? chars.slice(0, MAX_CLIENT_NAME).join('').trim() : cleaned;
  return name || 'Unnamed app';
}

export type OAuthError = { ok: false; error: string; description: string };
const oauthError = (error: string, description: string): OAuthError => ({
  ok: false,
  error,
  description,
});

export interface Registration {
  clientName: string;
  redirectUris: string[];
  authMethod: TokenAuthMethod;
}

/** RFC 7591 client metadata. Unknown fields are ignored. */
export function parseRegistration(body: unknown): { ok: true; value: Registration } | OAuthError {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return oauthError('invalid_client_metadata', 'Body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) {
    return oauthError('invalid_redirect_uri', 'redirect_uris is required');
  }
  if (uris.length > MAX_REDIRECT_URIS) {
    return oauthError('invalid_redirect_uri', `At most ${MAX_REDIRECT_URIS} redirect_uris`);
  }
  for (const u of uris) {
    if (!isAllowedRedirectUri(u)) {
      return oauthError(
        'invalid_redirect_uri',
        'Each redirect URI must be https (or http on localhost) with no fragment',
      );
    }
  }
  if (b.grant_types !== undefined) {
    const g = b.grant_types;
    if (
      !Array.isArray(g) ||
      !g.includes('authorization_code') ||
      g.some((x) => x !== 'authorization_code' && x !== 'refresh_token')
    ) {
      return oauthError(
        'invalid_client_metadata',
        'grant_types must be authorization_code (and optionally refresh_token)',
      );
    }
  }
  if (b.response_types !== undefined) {
    const r = b.response_types;
    if (!Array.isArray(r) || r.length === 0 || r.some((x) => x !== 'code')) {
      return oauthError('invalid_client_metadata', 'response_types must be ["code"]');
    }
  }
  const method = b.token_endpoint_auth_method ?? 'none';
  if (!AUTH_METHODS.includes(method as TokenAuthMethod)) {
    return oauthError(
      'invalid_client_metadata',
      'token_endpoint_auth_method must be none, client_secret_post or client_secret_basic',
    );
  }
  return {
    ok: true,
    value: {
      clientName: cleanClientName(b.client_name),
      redirectUris: [...new Set(uris as string[])],
      authMethod: method as TokenAuthMethod,
    },
  };
}

/** `resource` (RFC 8707) must name this MCP server; a trailing slash is tolerated. */
export function resourceMatches(resource: string, mcpUrl: string): boolean {
  return resource === mcpUrl || resource === `${mcpUrl}/`;
}

export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scope: string | null;
  resource: string | null;
}

/** Query parameters after client and redirect_uri are known good: errors go back to the client. */
export function parseAuthorizeRest(
  q: Readonly<Record<string, string | undefined>>,
  mcpUrl: string,
): { ok: true; value: Omit<AuthorizeRequest, 'clientId' | 'redirectUri'> } | OAuthError {
  if (q.response_type !== 'code') {
    return oauthError('unsupported_response_type', 'response_type must be code');
  }
  if (q.code_challenge_method !== 'S256') {
    return oauthError('invalid_request', 'PKCE with code_challenge_method S256 is required');
  }
  if (!q.code_challenge || !CHALLENGE.test(q.code_challenge)) {
    return oauthError('invalid_request', 'code_challenge is missing or malformed');
  }
  if (q.state !== undefined && q.state.length > MAX_STATE) {
    return oauthError('invalid_request', 'state is too long');
  }
  if (q.scope !== undefined && q.scope.length > MAX_SCOPE) {
    return oauthError('invalid_scope', 'scope is too long');
  }
  if (q.resource !== undefined && !resourceMatches(q.resource, mcpUrl)) {
    return oauthError('invalid_target', 'resource must be this server’s MCP URL');
  }
  return {
    ok: true,
    value: {
      codeChallenge: q.code_challenge,
      state: q.state ?? null,
      scope: q.scope ?? null,
      resource: q.resource ?? null,
    },
  };
}

/** Form (or JSON) body of the token and revocation endpoints, as string fields. */
export function parseFormBody(
  raw: string | undefined,
  isBase64: boolean | undefined,
  contentType: string | undefined,
): Record<string, string> | null {
  if (!raw) return {};
  const text = isBase64 ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  if (text.length > 8 * 1024) return null;
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
  if (type === 'application/json') {
    try {
      const v = JSON.parse(text) as unknown;
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
      const out: Record<string, string> = {};
      for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x;
      return out;
    } catch {
      return null;
    }
  }
  const out: Record<string, string> = {};
  const params = new URLSearchParams(text);
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    // RFC 6749 3.1: parameters must not be repeated.
    if (all.length !== 1) return null;
    out[key] = all[0] as string;
  }
  return out;
}

/** client_id / client_secret from an HTTP Basic header (RFC 6749 2.3.1), or null. */
export function basicCredentials(
  header: string | undefined,
): { clientId: string; secret: string } | null {
  const m = header?.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
  if (!m?.[1]) return null;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return null;
  try {
    return {
      clientId: decodeURIComponent(decoded.slice(0, i)),
      secret: decodeURIComponent(decoded.slice(i + 1)),
    };
  } catch {
    return null;
  }
}
