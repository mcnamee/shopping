/**
 * Personal access keys for the Shortcuts app (D-096). Two rows per key, written and deleted
 * in one transaction:
 *   Lookup   SHORTKEY#<sha256(key)>  / KEY             -> household, user, keyId (the secret never stored)
 *   Listing  HH#<hh>                 / SHORTKEY#<keyId> -> name, who, created, last used
 * A request is valid only if both rows exist, so deleting either revokes the key.
 */
import { keys, type ShortcutKey } from '@trolley/core';
import { ConditionFailed, type Db, type DbItem } from '../db';

export const MAX_KEYS_PER_HOUSEHOLD = 5;
const LAST_USED_EVERY_MS = 15 * 60 * 1000;
const PREFIX = 'SHORTKEY#';

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' ? v : null);

const lookupKey = (hash: string) => ({ pk: `SHORTKEY#${hash}`, sk: 'KEY' });
const listingKey = (hh: string, keyId: string) => ({
  pk: keys.householdPk(hh),
  sk: `${PREFIX}${keyId}`,
});

export interface ShortcutKeyRecord extends ShortcutKey {
  householdId: string;
  userId: string;
  hash: string;
  lastUsedMs: number | null;
}

function toRecord(row: DbItem): ShortcutKeyRecord | null {
  const keyId = str(row.keyId);
  const householdId = str(row.householdId);
  const hash = str(row.hash);
  const createdAt = num(row.createdAt);
  if (!keyId || !householdId || !hash || createdAt === null) return null;
  const lastUsedMs = num(row.lastUsedAt);
  return {
    keyId,
    householdId,
    hash,
    userId: str(row.userId) ?? '',
    name: str(row.name) ?? 'Shortcut',
    createdBy: str(row.createdBy) ?? '',
    createdAt: new Date(createdAt).toISOString(),
    lastUsedAt: lastUsedMs === null ? null : new Date(lastUsedMs).toISOString(),
    lastUsedMs,
  };
}

export const publicKey = (r: ShortcutKeyRecord): ShortcutKey => ({
  keyId: r.keyId,
  name: r.name,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  lastUsedAt: r.lastUsedAt,
});

export class ShortcutKeyStore {
  constructor(private readonly db: Db) {}

  async list(hh: string): Promise<ShortcutKeyRecord[]> {
    const rows = await this.db.queryAll(keys.householdPk(hh), PREFIX);
    return rows
      .flatMap((r) => {
        const rec = toRecord(r);
        return rec ? [rec] : [];
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.keyId.localeCompare(b.keyId));
  }

  /** False when the household already has the maximum. */
  async create(
    rec: { keyId: string; hash: string; name: string; userId: string; createdBy: string },
    hh: string,
    nowMs: number,
  ): Promise<boolean> {
    if ((await this.db.count(keys.householdPk(hh), PREFIX)) >= MAX_KEYS_PER_HOUSEHOLD) {
      return false;
    }
    await this.db.transact([
      {
        put: {
          ...lookupKey(rec.hash),
          entity: 'ShortcutKeyLookup',
          keyId: rec.keyId,
          householdId: hh,
          userId: rec.userId,
        },
        condition: 'attribute_not_exists(pk)',
      },
      {
        put: {
          ...listingKey(hh, rec.keyId),
          entity: 'ShortcutKey',
          keyId: rec.keyId,
          householdId: hh,
          userId: rec.userId,
          hash: rec.hash,
          name: rec.name,
          createdBy: rec.createdBy,
          createdAt: nowMs,
        },
        condition: 'attribute_not_exists(pk)',
      },
    ]);
    return true;
  }

  /** The key behind a presented secret's hash, or null (unknown or revoked). */
  async findByHash(hash: string): Promise<ShortcutKeyRecord | null> {
    const look = await this.db.get(lookupKey(hash));
    const keyId = look ? str(look.keyId) : null;
    const hh = look ? str(look.householdId) : null;
    if (!keyId || !hh) return null;
    const row = await this.db.get(listingKey(hh, keyId));
    const rec = row ? toRecord(row) : null;
    return rec && rec.hash === hash && rec.householdId === hh ? rec : null;
  }

  async revoke(hh: string, keyId: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(keyId)) return false;
    const row = await this.db.get(listingKey(hh, keyId));
    const rec = row ? toRecord(row) : null;
    if (!rec) return false;
    try {
      await this.db.transact([
        { delete: listingKey(hh, keyId), condition: 'attribute_exists(pk)' },
        { delete: lookupKey(rec.hash) },
      ]);
      return true;
    } catch (err) {
      if (err instanceof ConditionFailed) return false;
      throw err;
    }
  }

  /** Record use at most every 15 minutes per key. */
  async touch(rec: ShortcutKeyRecord, nowMs: number): Promise<void> {
    if (rec.lastUsedMs !== null && nowMs - rec.lastUsedMs < LAST_USED_EVERY_MS) return;
    try {
      await this.db.update(listingKey(rec.householdId, rec.keyId), 'SET lastUsedAt = :now', {
        condition:
          'attribute_exists(pk) AND (attribute_not_exists(lastUsedAt) OR lastUsedAt < :cutoff)',
        values: { ':now': nowMs, ':cutoff': nowMs - LAST_USED_EVERY_MS },
      });
    } catch (err) {
      if (!(err instanceof ConditionFailed)) throw err;
    }
  }
}
