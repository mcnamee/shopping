/**
 * OAuth data in the single table (D-083, D-089). Secrets are stored only as SHA-256
 * hashes; every short-lived row carries a DynamoDB `ttl` and an explicit expiry that is
 * checked on read (TTL deletion is lazy).
 *
 *   Client           OAUTHCLIENT#<clientId>      / CLIENT     (ttl 24 h until first authorised)
 *   Pending request  OAUTHREQ#<requestId>        / REQUEST    (10 min)
 *   Auth code        OAUTHCODE#<sha256(code)>    / CODE       (5 min, row kept 1 day for reuse detection)
 *   Token            OAUTHTOKEN#<sha256(token)>  / TOKEN      (access 1 h, refresh 30 d)
 *   Grant            HH#<hh>                     / OAUTHGRANT#<grantId>  (no ttl; deleted on revoke)
 *   Rate counters    OAUTHRL#<scope>#<key>       / <window>   (ttl)
 *
 * A token is valid only while its grant row exists, so deleting the grant revokes every
 * access and refresh token issued under it at once.
 */
import { keys } from '@trolley/core';
import { ConditionFailed, type Db, type DbItem, type TransactOp } from '../db';
import type { TokenAuthMethod } from './validate';

export const CLIENT_UNUSED_TTL_MS = 24 * 60 * 60 * 1000;
export const REQUEST_TTL_MS = 10 * 60 * 1000;
export const CODE_TTL_MS = 5 * 60 * 1000;
const CODE_ROW_KEEP_MS = 24 * 60 * 60 * 1000;
export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Grant "last used" is written at most this often (E1). */
const LAST_USED_EVERY_MS = 15 * 60 * 1000;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const ttlOf = (ms: number) => Math.ceil(ms / 1000);

export interface ClientRecord {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  authMethod: TokenAuthMethod;
  secretHash: string | null;
  createdAt: number;
  authorisedAt: number | null;
}

export interface PendingRequest {
  requestId: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scope: string | null;
  resource: string | null;
  expiresAt: number;
}

export interface CodeRecord {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  userId: string;
  householdId: string;
  grantId: string;
  connectedBy: string;
  scope: string | null;
  expiresAt: number;
  used: boolean;
}

export interface TokenRecord {
  kind: 'access' | 'refresh';
  clientId: string;
  householdId: string;
  userId: string;
  grantId: string;
  expiresAt: number;
  used: boolean;
}

export interface GrantRecord {
  grantId: string;
  householdId: string;
  clientId: string;
  clientName: string;
  userId: string;
  connectedBy: string;
  createdAt: number;
  lastUsedAt: number | null;
}

const clientKey = (id: string) => ({ pk: `OAUTHCLIENT#${id}`, sk: 'CLIENT' });
const requestKey = (id: string) => ({ pk: `OAUTHREQ#${id}`, sk: 'REQUEST' });
const codeKey = (hash: string) => ({ pk: `OAUTHCODE#${hash}`, sk: 'CODE' });
const tokenKey = (hash: string) => ({ pk: `OAUTHTOKEN#${hash}`, sk: 'TOKEN' });
const grantKey = (hh: string, grantId: string) => ({
  pk: keys.householdPk(hh),
  sk: `OAUTHGRANT#${grantId}`,
});
const GRANT_PREFIX = 'OAUTHGRANT#';

function toGrant(row: DbItem): GrantRecord | null {
  const grantId = str(row.grantId);
  const householdId = str(row.householdId);
  const clientId = str(row.clientId);
  const createdAt = num(row.createdAt);
  if (!grantId || !householdId || !clientId || createdAt === null) return null;
  return {
    grantId,
    householdId,
    clientId,
    clientName: str(row.clientName) ?? 'Unnamed app',
    userId: str(row.userId) ?? '',
    connectedBy: str(row.connectedBy) ?? '',
    createdAt,
    lastUsedAt: num(row.lastUsedAt),
  };
}

export interface NewTokens {
  accessHash: string;
  refreshHash: string;
}

export class OAuthStore {
  constructor(private readonly db: Db) {}

  // ------------------------------------------------------------------ clients

  async createClient(c: ClientRecord): Promise<void> {
    await this.db.put(
      {
        ...clientKey(c.clientId),
        entity: 'OAuthClient',
        clientId: c.clientId,
        clientName: c.clientName,
        redirectUris: c.redirectUris,
        authMethod: c.authMethod,
        ...(c.secretHash ? { secretHash: c.secretHash } : {}),
        createdAt: c.createdAt,
        ttl: ttlOf(c.createdAt + CLIENT_UNUSED_TTL_MS),
      },
      { condition: 'attribute_not_exists(pk)' },
    );
  }

  /** The client, or null if unknown or registered more than 24 h ago and never authorised. */
  async getClient(clientId: string, nowMs: number): Promise<ClientRecord | null> {
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(clientId)) return null;
    const row = await this.db.get(clientKey(clientId));
    if (!row) return null;
    const createdAt = num(row.createdAt) ?? 0;
    const authorisedAt = num(row.authorisedAt);
    if (authorisedAt === null && nowMs > createdAt + CLIENT_UNUSED_TTL_MS) return null;
    const uris = Array.isArray(row.redirectUris)
      ? row.redirectUris.filter((u): u is string => typeof u === 'string')
      : [];
    const method = str(row.authMethod);
    return {
      clientId,
      clientName: str(row.clientName) ?? 'Unnamed app',
      redirectUris: uris,
      authMethod:
        method === 'client_secret_post' || method === 'client_secret_basic' ? method : 'none',
      secretHash: str(row.secretHash),
      createdAt,
      authorisedAt,
    };
  }

  // ------------------------------------------------------------------ pending requests

  async putRequest(r: PendingRequest): Promise<void> {
    await this.db.put({
      ...requestKey(r.requestId),
      entity: 'OAuthRequest',
      ...r,
      ttl: ttlOf(r.expiresAt),
    });
  }

  async getRequest(requestId: string, nowMs: number): Promise<PendingRequest | null> {
    if (!/^[A-Za-z0-9_-]{22}$/.test(requestId)) return null;
    const row = await this.db.get(requestKey(requestId));
    if (!row) return null;
    const expiresAt = num(row.expiresAt) ?? 0;
    const clientId = str(row.clientId);
    const redirectUri = str(row.redirectUri);
    const codeChallenge = str(row.codeChallenge);
    if (nowMs > expiresAt || !clientId || !redirectUri || !codeChallenge) return null;
    return {
      requestId,
      clientId,
      clientName: str(row.clientName) ?? 'Unnamed app',
      redirectUri,
      codeChallenge,
      state: str(row.state),
      scope: str(row.scope),
      resource: str(row.resource),
      expiresAt,
    };
  }

  /** Single use: true only for the caller that deleted it. */
  async takeRequest(requestId: string): Promise<boolean> {
    try {
      await this.db.delete(requestKey(requestId), { condition: 'attribute_exists(pk)' });
      return true;
    } catch (err) {
      if (err instanceof ConditionFailed) return false;
      throw err;
    }
  }

  // ------------------------------------------------------------------ codes

  async putCode(hash: string, c: Omit<CodeRecord, 'used'>): Promise<void> {
    await this.db.put({
      ...codeKey(hash),
      entity: 'OAuthCode',
      ...c,
      ttl: ttlOf(c.expiresAt + CODE_ROW_KEEP_MS),
    });
  }

  async getCode(hash: string): Promise<CodeRecord | null> {
    const row = await this.db.get(codeKey(hash));
    if (!row) return null;
    const fields = ['clientId', 'redirectUri', 'codeChallenge', 'userId', 'householdId', 'grantId'];
    if (fields.some((f) => !str(row[f]))) return null;
    return {
      clientId: row.clientId as string,
      redirectUri: row.redirectUri as string,
      codeChallenge: row.codeChallenge as string,
      userId: row.userId as string,
      householdId: row.householdId as string,
      grantId: row.grantId as string,
      connectedBy: str(row.connectedBy) ?? '',
      scope: str(row.scope),
      expiresAt: num(row.expiresAt) ?? 0,
      used: row.usedAt !== undefined,
    };
  }

  private tokenItems(
    t: Omit<TokenRecord, 'kind' | 'expiresAt' | 'used'>,
    tokens: NewTokens,
    nowMs: number,
  ): TransactOp[] {
    const base = { entity: 'OAuthToken', ...t };
    return [
      {
        put: {
          ...tokenKey(tokens.accessHash),
          ...base,
          kind: 'access',
          expiresAt: nowMs + ACCESS_TTL_MS,
          ttl: ttlOf(nowMs + ACCESS_TTL_MS),
        },
        condition: 'attribute_not_exists(pk)',
      },
      {
        put: {
          ...tokenKey(tokens.refreshHash),
          ...base,
          kind: 'refresh',
          expiresAt: nowMs + REFRESH_TTL_MS,
          ttl: ttlOf(nowMs + REFRESH_TTL_MS),
        },
        condition: 'attribute_not_exists(pk)',
      },
    ];
  }

  /**
   * Redeem a code: mark it used (exactly once), create the grant, issue the first token
   * pair and keep the client (clear its unused-client TTL), atomically. Returns false when
   * the code was already used.
   */
  async redeemCode(
    codeHash: string,
    code: CodeRecord,
    client: ClientRecord,
    tokens: NewTokens,
    nowMs: number,
  ): Promise<boolean> {
    try {
      await this.db.transact([
        {
          update: codeKey(codeHash),
          expression: 'SET usedAt = :now',
          condition: 'attribute_exists(pk) AND attribute_not_exists(usedAt)',
          values: { ':now': nowMs },
        },
        {
          put: {
            ...grantKey(code.householdId, code.grantId),
            entity: 'OAuthGrant',
            grantId: code.grantId,
            householdId: code.householdId,
            clientId: client.clientId,
            clientName: client.clientName,
            userId: code.userId,
            connectedBy: code.connectedBy,
            createdAt: nowMs,
          },
          condition: 'attribute_not_exists(pk)',
        },
        ...this.tokenItems(
          {
            clientId: client.clientId,
            householdId: code.householdId,
            userId: code.userId,
            grantId: code.grantId,
          },
          tokens,
          nowMs,
        ),
        {
          update: clientKey(client.clientId),
          expression: 'SET authorisedAt = if_not_exists(authorisedAt, :now) REMOVE #ttl',
          condition: 'attribute_exists(pk)',
          names: { '#ttl': 'ttl' },
          values: { ':now': nowMs },
        },
      ]);
      return true;
    } catch (err) {
      if (err instanceof ConditionFailed && err.failed[0]) return false;
      throw err;
    }
  }

  // ------------------------------------------------------------------ tokens

  async getToken(hash: string): Promise<TokenRecord | null> {
    const row = await this.db.get(tokenKey(hash));
    if (!row) return null;
    const kind = row.kind === 'access' || row.kind === 'refresh' ? row.kind : null;
    const fields = ['clientId', 'householdId', 'userId', 'grantId'];
    if (!kind || fields.some((f) => !str(row[f]))) return null;
    return {
      kind,
      clientId: row.clientId as string,
      householdId: row.householdId as string,
      userId: row.userId as string,
      grantId: row.grantId as string,
      expiresAt: num(row.expiresAt) ?? 0,
      used: row.usedAt !== undefined,
    };
  }

  /**
   * Refresh rotation: the old refresh token dies (marked used, kept for reuse detection)
   * and a new pair is issued, only while the grant still exists. Returns 'reused' when the
   * old token was already used, 'revoked' when the grant is gone.
   */
  async rotateRefresh(
    oldHash: string,
    old: TokenRecord,
    tokens: NewTokens,
    nowMs: number,
  ): Promise<'ok' | 'reused' | 'revoked'> {
    try {
      await this.db.transact([
        {
          update: tokenKey(oldHash),
          expression: 'SET usedAt = :now',
          condition: 'attribute_exists(pk) AND attribute_not_exists(usedAt)',
          values: { ':now': nowMs },
        },
        {
          check: grantKey(old.householdId, old.grantId),
          condition: 'attribute_exists(pk)',
        },
        ...this.tokenItems(
          {
            clientId: old.clientId,
            householdId: old.householdId,
            userId: old.userId,
            grantId: old.grantId,
          },
          tokens,
          nowMs,
        ),
      ]);
      return 'ok';
    } catch (err) {
      if (!(err instanceof ConditionFailed)) throw err;
      if (err.failed[0]) return 'reused';
      if (err.failed[1]) return 'revoked';
      throw err;
    }
  }

  async deleteToken(hash: string): Promise<void> {
    await this.db.delete(tokenKey(hash));
  }

  // ------------------------------------------------------------------ grants

  async getGrant(hh: string, grantId: string): Promise<GrantRecord | null> {
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(grantId)) return null;
    const row = await this.db.get(grantKey(hh, grantId));
    return row ? toGrant(row) : null;
  }

  async listGrants(hh: string): Promise<GrantRecord[]> {
    const rows = await this.db.queryAll(keys.householdPk(hh), GRANT_PREFIX);
    return rows.flatMap((r) => {
      const g = toGrant(r);
      return g ? [g] : [];
    });
  }

  /** Revoke a grant (and so every token under it). False if it did not exist. */
  async revokeGrant(hh: string, grantId: string): Promise<boolean> {
    try {
      await this.db.delete(grantKey(hh, grantId), { condition: 'attribute_exists(pk)' });
      return true;
    } catch (err) {
      if (err instanceof ConditionFailed) return false;
      throw err;
    }
  }

  /** Record use at most every 15 minutes per grant (E1). */
  async touchGrant(g: GrantRecord, nowMs: number): Promise<void> {
    if (g.lastUsedAt !== null && nowMs - g.lastUsedAt < LAST_USED_EVERY_MS) return;
    try {
      await this.db.update(grantKey(g.householdId, g.grantId), 'SET lastUsedAt = :now', {
        condition:
          'attribute_exists(pk) AND (attribute_not_exists(lastUsedAt) OR lastUsedAt < :cutoff)',
        values: { ':now': nowMs, ':cutoff': nowMs - LAST_USED_EVERY_MS },
      });
    } catch (err) {
      if (!(err instanceof ConditionFailed)) throw err;
    }
  }

  // ------------------------------------------------------------------ rate limits

  /**
   * Count one event in a fixed window; false (nothing counted) once `max` is reached.
   * One conditional UpdateItem, so concurrent callers cannot overshoot.
   */
  async consume(
    scope: string,
    key: string,
    windowMs: number,
    max: number,
    nowMs: number,
  ): Promise<boolean> {
    const window = Math.floor(nowMs / windowMs);
    try {
      await this.db.update(
        { pk: `OAUTHRL#${scope}#${key}`, sk: String(window) },
        'SET hits = if_not_exists(hits, :zero) + :one, #ttl = :ttl, entity = :entity',
        {
          condition: 'attribute_not_exists(hits) OR hits < :max',
          names: { '#ttl': 'ttl' },
          values: {
            ':zero': 0,
            ':one': 1,
            ':max': max,
            ':ttl': ttlOf((window + 2) * windowMs),
            ':entity': 'RateCounter',
          },
        },
      );
      return true;
    } catch (err) {
      if (err instanceof ConditionFailed) return false;
      throw err;
    }
  }
}
