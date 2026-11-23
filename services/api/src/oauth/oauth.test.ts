import { describe, expect, it } from 'vitest';
import { ORIGIN, setup, type Harness } from '../test/harness';
import {
  authorize,
  CHATGPT_REDIRECT,
  CLAUDE_REDIRECT,
  connect,
  consent,
  form,
  mcp,
  MCP_URL,
  pkcePair,
  register,
  requestIdFrom,
  token,
} from '../test/oauth-client';
import {
  AUTHORIZE_PER_CLIENT_PER_MIN,
  AUTHORIZE_PER_IP_PER_MIN,
  TOKEN_PER_CLIENT_PER_MIN,
} from './routes';
import { cleanClientName, isAllowedRedirectUri } from './validate';

const MIN = 60 * 1000;

async function codeFor(h: Harness, clientId: string, hh = 'home-1') {
  const { verifier, challenge } = pkcePair();
  const auth = await authorize(h, clientId, challenge);
  const c = await consent(h, requestIdFrom(auth.headers.location), true, { hh });
  return { code: new URL(c.body.redirectUrl).searchParams.get('code') ?? '', verifier };
}

const exchange = (h: Harness, clientId: string, code: string, verifier: string, extra = {}) =>
  token(h, {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: CLAUDE_REDIRECT,
    ...extra,
  });

describe('metadata (B1)', () => {
  it('serves authorisation server and protected resource metadata', async () => {
    const h = setup();
    const as = await h.call('GET /.well-known/oauth-authorization-server', { hh: null });
    expect(as.status).toBe(200);
    expect(as.body).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      revocation_endpoint: `${ORIGIN}/oauth/revoke`,
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      response_types_supported: ['code'],
    });
    expect(as.body.token_endpoint_auth_methods_supported).toContain('none');
    expect(as.headers['access-control-allow-origin']).toBe('*');
    for (const route of [
      'GET /.well-known/oauth-protected-resource',
      'GET /.well-known/oauth-protected-resource/mcp',
    ]) {
      const pr = await h.call(route, { hh: null });
      expect(pr.body).toMatchObject({ resource: MCP_URL, authorization_servers: [ORIGIN] });
    }
    const pre = await h.call('OPTIONS /oauth/token', { hh: null });
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-methods']).toContain('POST');
  });
});

describe('dynamic client registration (B3)', () => {
  it('registers public clients with Claude and ChatGPT callbacks', async () => {
    const h = setup();
    const res = await h.call('POST /oauth/register', {
      hh: null,
      body: {
        client_name: 'ChatGPT',
        redirect_uris: [CHATGPT_REDIRECT, CLAUDE_REDIRECT, 'http://127.0.0.1:33418/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ client_name: 'ChatGPT', token_endpoint_auth_method: 'none' });
    expect(res.body.client_secret).toBeUndefined();
    expect(String(res.body.client_id)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('rejects bad redirect URIs and metadata', async () => {
    const h = setup();
    const bad: unknown[] = [
      undefined,
      [],
      ['http://evil.example/cb'],
      ['https://claude.ai/cb#frag'],
      ['cursor://callback'],
      ['https://user:pw@claude.ai/cb'],
      ['javascript:alert(1)'],
      Array.from({ length: 6 }, (_, i) => `https://a.example/${i}`),
    ];
    for (const redirect_uris of bad) {
      const res = await h.call('POST /oauth/register', { hh: null, body: { redirect_uris } });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_redirect_uri');
    }
    const res = await h.call('POST /oauth/register', {
      hh: null,
      body: { redirect_uris: [CLAUDE_REDIRECT], grant_types: ['client_credentials'] },
    });
    expect(res.body.error).toBe('invalid_client_metadata');
  });

  it('cleans client names', () => {
    expect(cleanClientName('<b>Claude</b>\u0000\n  Desktop')).toBe('Claude Desktop');
    expect(cleanClientName('x'.repeat(80))).toHaveLength(60);
    expect(cleanClientName(undefined)).toBe('Unnamed app');
    expect(isAllowedRedirectUri('http://localhost:8080/cb')).toBe(true);
    expect(isAllowedRedirectUri('http://localhost.evil.com/cb')).toBe(false);
  });

  it('limits registrations to 20 per hour per address', async () => {
    const h = setup();
    const viewer = { 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < 20; i++) await register(h, {}, { headers: viewer });
    const res = await h.call('POST /oauth/register', {
      hh: null,
      headers: viewer,
      body: { redirect_uris: [CLAUDE_REDIRECT] },
    });
    expect(res.status).toBe(429);
    // A spoofed first X-Forwarded-For entry does not dodge the limit (CloudFront appends the viewer).
    const spoofed = await h.call('POST /oauth/register', {
      hh: null,
      headers: { 'x-forwarded-for': '198.51.100.1, 203.0.113.9' },
      body: { redirect_uris: [CLAUDE_REDIRECT] },
    });
    expect(spoofed.status).toBe(429);
    await register(h, {}, { headers: { 'x-forwarded-for': '203.0.113.10' } });
    h.advance(60 * MIN);
    await register(h, {}, { headers: viewer });
  });

  it('expires clients never authorised after 24 hours, keeps authorised ones', async () => {
    const h = setup();
    const unused = await register(h);
    const used = (await connect(h)).clientId;
    h.advance(24 * 60 * MIN + 1000);
    const { challenge } = pkcePair();
    expect((await authorize(h, unused, challenge)).status).toBe(400);
    expect((await authorize(h, used, challenge)).status).toBe(302);
  });
});

describe('authorize (B4)', () => {
  it('shows an error page, never a redirect, for a bad client or redirect URI', async () => {
    const h = setup();
    const clientId = await register(h);
    const { challenge } = pkcePair();
    const cases = [
      await authorize(h, 'no-such-client-000000', challenge),
      await authorize(h, clientId, challenge, { redirect_uri: 'https://evil.example/cb' }),
      await authorize(h, clientId, challenge, { redirect_uri: `${CLAUDE_REDIRECT}/` }),
      await authorize(h, clientId, challenge, { redirect_uri: `${CLAUDE_REDIRECT}?x=1` }),
      await h.call('GET /oauth/authorize', {
        hh: null,
        rawQuery: `client_id=${clientId}&client_id=${clientId}&redirect_uri=${encodeURIComponent(CLAUDE_REDIRECT)}`,
      }),
    ];
    for (const res of cases) {
      expect(res.status).toBe(400);
      expect(res.headers.location).toBeUndefined();
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.raw).toContain("This connection link isn't valid");
    }
  });

  it('redirects protocol errors back to the client with state', async () => {
    const h = setup();
    const clientId = await register(h);
    const { challenge } = pkcePair();
    const cases: Array<[Record<string, string>, string]> = [
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ code_challenge: 'short' }, 'invalid_request'],
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ resource: 'https://other.example/mcp' }, 'invalid_target'],
    ];
    for (const [extra, error] of cases) {
      const res = await authorize(h, clientId, challenge, extra);
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.location ?? '');
      expect(`${loc.origin}${loc.pathname}`).toBe(CLAUDE_REDIRECT);
      expect(loc.searchParams.get('error')).toBe(error);
      expect(loc.searchParams.get('state')).toBe('st-123');
      expect(loc.searchParams.get('code')).toBeNull();
    }
  });

  it('stores a pending request and sends the browser to /connect', async () => {
    const h = setup();
    const clientId = await register(h, { client_name: 'Claude <script>' });
    const { challenge } = pkcePair();
    const res = await authorize(h, clientId, challenge);
    expect(res.status).toBe(302);
    const requestId = requestIdFrom(res.headers.location);
    const details = await h.call(`GET /api/oauth/requests/{requestId}`, {
      path: { requestId },
    });
    expect(details.body).toMatchObject({
      requestId,
      clientName: 'Claude',
      redirectHost: 'claude.ai',
    });
    // The SPA endpoints need the Cognito token.
    expect(
      (await h.call('GET /api/oauth/requests/{requestId}', { path: { requestId }, hh: null }))
        .status,
    ).toBe(401);
    expect(
      (await h.call('GET /api/oauth/requests/{requestId}', { path: { requestId: 'nope' } })).status,
    ).toBe(404);
    h.advance(11 * MIN);
    expect(
      (await h.call('GET /api/oauth/requests/{requestId}', { path: { requestId } })).status,
    ).toBe(404);
  });
});

describe('consent (B5)', () => {
  it('deny returns access_denied with state; a request is single use', async () => {
    const h = setup();
    const clientId = await register(h);
    const { challenge } = pkcePair();
    const requestId = requestIdFrom((await authorize(h, clientId, challenge)).headers.location);
    const denied = await consent(h, requestId, false);
    expect(denied.status).toBe(200);
    const url = new URL(denied.body.redirectUrl);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('st-123');
    expect(url.searchParams.get('iss')).toBe(ORIGIN);
    expect((await consent(h, requestId, true)).status).toBe(404);
  });

  it('validates the body', async () => {
    const h = setup();
    expect((await h.call('POST /api/oauth/consent', { body: { requestId: 'x' } })).status).toBe(
      400,
    );
    expect((await h.call('POST /api/oauth/consent', { body: { allow: true } })).status).toBe(400);
  });
});

describe('token endpoint (B6)', () => {
  it('runs the full flow: register, authorize, consent, token, refresh rotation, reuse detection, revoke', async () => {
    const h = setup();
    const c = await connect(h);
    expect(c.access).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(c.refresh).not.toBe(c.access);
    expect((await mcp(h, c.access, 'ping')).status).toBe(200);

    // Rotation: a new pair; the old refresh token dies on use.
    const r1 = await token(h, {
      grant_type: 'refresh_token',
      refresh_token: c.refresh,
      client_id: c.clientId,
    });
    expect(r1.status).toBe(200);
    expect(r1.body.refresh_token).not.toBe(c.refresh);
    expect((await mcp(h, r1.body.access_token, 'ping')).status).toBe(200);

    // Reuse of the rotated token revokes the whole grant.
    const reuse = await token(h, {
      grant_type: 'refresh_token',
      refresh_token: c.refresh,
      client_id: c.clientId,
    });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toBe('invalid_grant');
    expect((await mcp(h, r1.body.access_token, 'ping')).status).toBe(401);
    expect((await mcp(h, c.access, 'ping')).status).toBe(401);
    const after = await token(h, {
      grant_type: 'refresh_token',
      refresh_token: r1.body.refresh_token,
      client_id: c.clientId,
    });
    expect(after.body.error).toBe('invalid_grant');

    // Revocation endpoint: always 200; a revoked refresh token revokes its grant.
    const c2 = await connect(h, { clientId: c.clientId });
    const rv = await h.call('POST /oauth/revoke', {
      hh: null,
      ...form({ token: c2.refresh, client_id: c.clientId }),
    });
    expect(rv.status).toBe(200);
    expect((await mcp(h, c2.access, 'ping')).status).toBe(401);
    const unknown = await h.call('POST /oauth/revoke', {
      hh: null,
      ...form({ token: 'not-a-token', client_id: c.clientId }),
    });
    expect(unknown.status).toBe(200);

    // Revoking an access token kills it at once.
    const c3 = await connect(h, { clientId: c.clientId });
    await h.call('POST /oauth/revoke', {
      hh: null,
      ...form({ token: c3.access, client_id: c.clientId }),
    });
    expect((await mcp(h, c3.access, 'ping')).status).toBe(401);
  });

  it('rejects a wrong PKCE verifier without burning the code', async () => {
    const h = setup();
    const clientId = await register(h);
    const { code, verifier } = await codeFor(h, clientId);
    const wrong = await exchange(h, clientId, code, pkcePair().verifier);
    expect(wrong.body.error).toBe('invalid_grant');
    const bad = await exchange(h, clientId, code, 'too-short');
    expect(bad.body.error).toBe('invalid_grant');
    expect((await exchange(h, clientId, code, verifier)).status).toBe(200);
  });

  it('requires the exact redirect_uri and the same client', async () => {
    const h = setup();
    const clientId = await register(h);
    const other = await register(h);
    const { code, verifier } = await codeFor(h, clientId);
    expect(
      (await exchange(h, clientId, code, verifier, { redirect_uri: `${CLAUDE_REDIRECT}/` })).body
        .error,
    ).toBe('invalid_grant');
    expect((await exchange(h, other, code, verifier)).body.error).toBe('invalid_grant');
    expect(
      (await exchange(h, clientId, code, verifier, { resource: 'https://x.example/mcp' })).body
        .error,
    ).toBe('invalid_target');
  });

  it('expires codes after 5 minutes', async () => {
    const h = setup();
    const clientId = await register(h);
    const { code, verifier } = await codeFor(h, clientId);
    h.advance(5 * MIN + 1000);
    expect((await exchange(h, clientId, code, verifier)).body.error).toBe('invalid_grant');
  });

  it('a replayed code revokes the tokens issued from it', async () => {
    const h = setup();
    const c = await connect(h);
    const replay = await exchange(h, c.clientId, c.code, c.verifier);
    expect(replay.body.error).toBe('invalid_grant');
    expect((await mcp(h, c.access, 'ping')).status).toBe(401);
    const refresh = await token(h, {
      grant_type: 'refresh_token',
      refresh_token: c.refresh,
      client_id: c.clientId,
    });
    expect(refresh.body.error).toBe('invalid_grant');
  });

  it('rejects unknown clients, grant types and malformed bodies', async () => {
    const h = setup();
    const clientId = await register(h);
    const unknown = await token(h, {
      grant_type: 'authorization_code',
      client_id: 'nobody-0000000000',
    });
    expect([unknown.status, unknown.body.error]).toEqual([401, 'invalid_client']);
    const grant = await token(h, { grant_type: 'password', client_id: clientId });
    expect(grant.body.error).toBe('unsupported_grant_type');
    const dup = await h.call('POST /oauth/token', {
      hh: null,
      rawBody: `grant_type=a&grant_type=b&client_id=${clientId}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(dup.body.error).toBe('invalid_request');
    expect(dup.headers['cache-control']).toBe('no-store');
  });

  it('requires the client secret from a client that registered for one', async () => {
    const h = setup();
    const reg = await h.call<{ client_id: string; client_secret: string }>('POST /oauth/register', {
      hh: null,
      body: { redirect_uris: [CLAUDE_REDIRECT], token_endpoint_auth_method: 'client_secret_basic' },
    });
    const { client_id: clientId, client_secret: secret } = reg.body;
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const { code, verifier } = await codeFor(h, clientId);
    const noSecret = await exchange(h, clientId, code, verifier);
    expect([noSecret.status, noSecret.body.error]).toEqual([401, 'invalid_client']);
    const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
    const ok = await token(
      h,
      {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: CLAUDE_REDIRECT,
      },
      {
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${basic}`,
        },
      },
    );
    expect(ok.status).toBe(200);
  });

  it('expires access tokens after an hour', async () => {
    const h = setup();
    const c = await connect(h);
    h.advance(60 * MIN + 1000);
    expect((await mcp(h, c.access, 'ping')).status).toBe(401);
    const r = await token(h, {
      grant_type: 'refresh_token',
      refresh_token: c.refresh,
      client_id: c.clientId,
    });
    expect((await mcp(h, r.body.access_token, 'ping')).status).toBe(200);
  });

  it('never logs tokens, codes, verifiers or state (B8)', async () => {
    const h = setup();
    const c = await connect(h);
    await token(h, {
      grant_type: 'refresh_token',
      refresh_token: c.refresh,
      client_id: c.clientId,
    });
    await mcp(h, c.access, 'tools/call', { name: 'get_current_list', arguments: {} });
    const logged = JSON.stringify(h.logs);
    for (const secret of [c.access, c.refresh, c.code, c.verifier, 'st-123']) {
      expect(logged).not.toContain(secret);
    }
    expect(h.logs.some((l) => l.event === 'tool' && l.tool === 'get_current_list')).toBe(true);
  });
});

describe('connected apps (E1, D-089)', () => {
  it('lists the household grants, records last use at most every 15 minutes, and disconnects', async () => {
    const h = setup();
    const c = await connect(h);
    const list = await h.call<{ apps: Array<Record<string, unknown>>; mcpUrl: string }>(
      'GET /api/connected-apps',
    );
    expect(list.body.mcpUrl).toBe(MCP_URL);
    expect(list.body.apps).toHaveLength(1);
    const app = list.body.apps[0] as Record<string, unknown>;
    expect(app).toMatchObject({ clientName: 'Claude', connectedBy: 'Sam' });
    expect(app.lastUsedAt).toBeNull();

    await mcp(h, c.access, 'ping');
    const t1 = (await h.call<{ apps: Array<{ lastUsedAt: string }> }>('GET /api/connected-apps'))
      .body.apps[0]?.lastUsedAt;
    expect(t1).toBe(new Date(h.stage2.now()).toISOString());
    h.advance(5 * MIN);
    await mcp(h, c.access, 'ping');
    const t2 = (await h.call<{ apps: Array<{ lastUsedAt: string }> }>('GET /api/connected-apps'))
      .body.apps[0]?.lastUsedAt;
    expect(t2).toBe(t1);
    h.advance(11 * MIN);
    await mcp(h, c.access, 'ping');
    const t3 = (await h.call<{ apps: Array<{ lastUsedAt: string }> }>('GET /api/connected-apps'))
      .body.apps[0]?.lastUsedAt;
    expect(t3).not.toBe(t1);

    // Another household sees nothing and cannot disconnect it.
    const other = await h.call<{ apps: unknown[] }>('GET /api/connected-apps', { hh: 'home-2' });
    expect(other.body.apps).toEqual([]);
    const grantId = String(app.grantId);
    expect(
      (await h.call('DELETE /api/connected-apps/{grantId}', { path: { grantId }, hh: 'home-2' }))
        .status,
    ).toBe(404);
    expect((await mcp(h, c.access, 'ping')).status).toBe(200);

    // Disconnect revokes every token of the grant at once.
    const del = await h.call('DELETE /api/connected-apps/{grantId}', { path: { grantId } });
    expect(del.status).toBe(204);
    expect((await mcp(h, c.access, 'ping')).status).toBe(401);
    const r = await token(h, {
      grant_type: 'refresh_token',
      refresh_token: c.refresh,
      client_id: c.clientId,
    });
    expect(r.body.error).toBe('invalid_grant');
    expect((await h.call<{ apps: unknown[] }>('GET /api/connected-apps')).body.apps).toEqual([]);
    expect(
      (await h.call('DELETE /api/connected-apps/{grantId}', { path: { grantId } })).status,
    ).toBe(404);
  });

  describe('rate limits (B-018)', () => {
    it('limits /oauth/authorize per client with a plain 429 page, never a redirect', async () => {
      const h = setup();
      const clientId = await register(h);
      const { challenge } = pkcePair();
      for (let i = 0; i < AUTHORIZE_PER_CLIENT_PER_MIN; i++) {
        expect((await authorize(h, clientId, challenge)).status).toBe(302);
      }
      const res = await authorize(h, clientId, challenge);
      expect(res.status).toBe(429);
      expect(res.headers.location).toBeUndefined();
      expect(res.headers['content-type']).toContain('text/html');
      // A different client from the same address is unaffected until the address limit.
      const other = await register(h);
      expect((await authorize(h, other, challenge)).status).toBe(302);
      h.advance(MIN);
      expect((await authorize(h, clientId, challenge)).status).toBe(302);
    });

    it('limits /oauth/authorize per address, even for unknown clients', async () => {
      const h = setup();
      const { challenge } = pkcePair();
      for (let i = 0; i < AUTHORIZE_PER_IP_PER_MIN; i++) {
        expect((await authorize(h, `nope-${i}`, challenge)).status).toBe(400);
      }
      const res = await authorize(h, 'nope-last', challenge);
      expect(res.status).toBe(429);
      expect(res.headers.location).toBeUndefined();
    });

    it('limits /oauth/token per client with OAuth error JSON', async () => {
      const h = setup();
      const clientId = await register(h);
      const bad = {
        grant_type: 'authorization_code',
        code: 'x',
        code_verifier: 'y',
        client_id: clientId,
        redirect_uri: CLAUDE_REDIRECT,
      };
      for (let i = 0; i < TOKEN_PER_CLIENT_PER_MIN; i++) {
        expect((await token(h, bad)).status).toBe(400);
      }
      const res = await token(h, bad);
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('slow_down');
      h.advance(MIN);
      expect((await token(h, bad)).status).toBe(400);
    });
  });
});
