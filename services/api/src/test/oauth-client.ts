/**
 * Scripted OAuth client for in-process tests (Stage 4 F1): DCR -> authorize -> consent
 * (the SPA's JWT call) -> token -> MCP, against the real router over the fake table.
 */
import { createHash, randomBytes } from 'node:crypto';
import { ORIGIN, type CallOptions, type Harness } from './harness';

export const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
export const CHATGPT_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
export const MCP_URL = `${ORIGIN}/mcp`;

export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export const form = (fields: Record<string, string>) => ({
  rawBody: new URLSearchParams(fields).toString(),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
});

export async function register(
  h: Harness,
  body: Record<string, unknown> = {},
  opts: CallOptions = {},
): Promise<string> {
  const res = await h.call<{ client_id: string }>('POST /oauth/register', {
    hh: null,
    body: { client_name: 'Claude', redirect_uris: [CLAUDE_REDIRECT], ...body },
    ...opts,
  });
  if (res.status !== 201) throw new Error(`register ${res.status} ${res.raw}`);
  return res.body.client_id;
}

export function authorizeQuery(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export async function authorize(
  h: Harness,
  clientId: string,
  challenge: string,
  extra: Record<string, string> = {},
) {
  return h.call('GET /oauth/authorize', {
    hh: null,
    rawQuery: authorizeQuery({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CLAUDE_REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'st-123',
      resource: MCP_URL,
      ...extra,
    }),
  });
}

/** Pending request id from the 302 to /connect. */
export function requestIdFrom(location: string | undefined): string {
  const url = new URL(location ?? '');
  if (`${url.origin}${url.pathname}` !== `${ORIGIN}/connect`)
    throw new Error(`not /connect: ${location}`);
  return url.searchParams.get('request') ?? '';
}

export async function consent(h: Harness, requestId: string, allow = true, opts: CallOptions = {}) {
  return h.call<{ redirectUrl: string }>('POST /api/oauth/consent', {
    body: { requestId, allow },
    claims: { name: 'Sam' },
    ...opts,
  });
}

export async function token(h: Harness, fields: Record<string, string>, opts: CallOptions = {}) {
  return h.call<{
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    error?: string;
  }>('POST /oauth/token', { hh: null, ...form(fields), ...opts });
}

/** Full flow to a token pair for household `hh` (default home-1). */
export async function connect(
  h: Harness,
  opts: { hh?: string; user?: string; clientId?: string } = {},
) {
  const clientId = opts.clientId ?? (await register(h));
  const { verifier, challenge } = pkcePair();
  const auth = await authorize(h, clientId, challenge);
  const requestId = requestIdFrom(auth.headers.location);
  const c = await consent(h, requestId, true, {
    hh: opts.hh ?? 'home-1',
    user: opts.user ?? 'user-1',
  });
  const code = new URL(c.body.redirectUrl).searchParams.get('code') ?? '';
  const t = await token(h, {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: CLAUDE_REDIRECT,
    resource: MCP_URL,
  });
  if (t.status !== 200) throw new Error(`token ${t.status} ${t.raw}`);
  return {
    clientId,
    code,
    verifier,
    access: t.body.access_token,
    refresh: t.body.refresh_token,
  };
}

let rpcId = 0;

/** One JSON-RPC request to /mcp with a bearer token. */
export async function mcp(
  h: Harness,
  accessToken: string | null,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  rpcId += 1;
  return h.call<{
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  }>('POST /mcp', {
    hh: null,
    rawBody: JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params }),
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
  });
}

export interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export async function callTool(
  h: Harness,
  accessToken: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolCallResult & { text: string }> {
  const res = await mcp(h, accessToken, 'tools/call', { name, arguments: args });
  if (res.status !== 200 || !res.body.result)
    throw new Error(`tools/call ${res.status} ${res.raw}`);
  const r = res.body.result as unknown as ToolCallResult;
  return { ...r, text: r.content.map((c) => c.text).join('\n') };
}
