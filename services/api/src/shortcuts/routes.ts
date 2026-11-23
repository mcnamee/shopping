/**
 * Siri & Shortcuts (D-096 to D-098).
 *
 * SPA (Cognito JWT):
 *   POST   /api/shortcut-keys        { name } -> { key, shortcutKey } (the key is shown once)
 *   GET    /api/shortcut-keys        -> { keys, max }
 *   DELETE /api/shortcut-keys/{id}   revoke
 * Shortcuts app (public at the gateway; `Authorization: Bearer trl_...` checked here):
 *   POST /api/quick/add   { text, quantity? } or a plain-text body -> { spoken, added? }
 *   GET  /api/quick/list  -> { spoken }
 * A key can only do those two things: add to this week's list and read it. Logs carry the
 * key id and outcome only, never the key or the text said.
 */
import type { QuickResponse } from '@trolley/core';
import { cleanText } from '@trolley/core';
import { errors, fail, json, type HttpResult } from '../http';
import type { ListStore } from '../lists/store';
import type { ToolContext, ToolName, ToolResult } from '../mcp/tools';
import { newId, newSecret, safeEqual, sha256 } from '../oauth/crypto';
import { displayNameFromClaims } from '../oauth/routes';
import type { OAuthStore } from '../oauth/store';
import type { AuthedRequest, PublicRequest, RouteTable } from '../router';
import { activeThisWeekId } from '../this-week';
import {
  MAX_KEYS_PER_HOUSEHOLD,
  publicKey,
  type ShortcutKeyRecord,
  type ShortcutKeyStore,
} from './store';

export interface ShortcutDeps {
  keys: ShortcutKeyStore;
  /** Fixed-window rate counters live with the OAuth store. */
  limiter: Pick<OAuthStore, 'consume'>;
  lists: ListStore;
  callTool: (
    name: ToolName,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
  now: () => Date;
  log?: (entry: Record<string, unknown>) => void;
}

export const QUICK_PER_MINUTE = 30;
const MAX_NAME = 40;
const MAX_ITEMS = 8;
const MAX_LIST_NAMES = 20;
const MAX_BODY_CHARS = 2000;
const KEY_FORMAT = /^trl_[A-Za-z0-9_-]{43,128}$/;

const quick = (status: number, body: QuickResponse): HttpResult => json(status, body);
const invalidKey = () => quick(401, { spoken: "That Trolley key isn't valid any more." });

/** "a, b or c" (Siri reads this aloud). */
export function spokenJoin(parts: string[], last = 'and'): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} ${last} ${parts[parts.length - 1] as string}`;
}

/** "milk and eggs" / "milk, eggs and bread" -> separate items (max MAX_ITEMS). */
export function splitItems(text: string): string[] {
  return text
    .split(/\s*(?:,|;|\n|\s+and\s+|\s+&\s+)\s*/i)
    .map((s) => cleanText(s))
    .filter((s) => s.length > 0)
    .slice(0, MAX_ITEMS);
}

type Parsed = { text: string; quantity?: number };

/** JSON {text, quantity?}, a JSON string, or plain text (Shortcuts "Request Body: File"). */
export function parseQuickBody(event: {
  body?: string | undefined;
  isBase64Encoded?: boolean;
}): Parsed | null {
  const raw = event.body;
  if (!raw) return null;
  const decoded = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  if (decoded.length > MAX_BODY_CHARS) return null;
  const trimmed = decoded.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
    try {
      const v = JSON.parse(trimmed) as unknown;
      if (typeof v === 'string') return v.trim() ? { text: v } : null;
      if (typeof v === 'object' && v !== null) {
        const o = v as Record<string, unknown>;
        if (typeof o.text !== 'string' || !o.text.trim()) return null;
        const q = o.quantity;
        return {
          text: o.text,
          ...(typeof q === 'number' && Number.isFinite(q) ? { quantity: q } : {}),
        };
      }
      return null;
    } catch {
      // Not JSON after all: treat it as something said.
    }
  }
  return trimmed ? { text: trimmed } : null;
}

export function createShortcutRoutes(getDeps: () => ShortcutDeps): RouteTable {
  const log = (entry: Record<string, unknown>) => {
    const d = getDeps();
    (d.log ?? ((e) => console.log(JSON.stringify(e))))({ area: 'shortcuts', ...entry });
  };

  // ---------------------------------------------------------------- key management (SPA)

  async function createKey(req: AuthedRequest): Promise<HttpResult> {
    const { keys, now } = getDeps();
    const body = req.event.body ? parseJson(req.event) : undefined;
    const rawName =
      typeof body === 'object' && body !== null ? (body as { name?: unknown }).name : undefined;
    const name = typeof rawName === 'string' ? cleanText(rawName) : '';
    if (!name) return errors.validation('Give the key a name, e.g. "Sam\'s iPhone"', 'name');
    if (name.length > MAX_NAME) {
      return errors.validation(`Keep the name to ${MAX_NAME} characters or fewer`, 'name');
    }
    const key = `trl_${newSecret()}`;
    const keyId = newId();
    const { householdId, userId } = req.household;
    const createdBy = displayNameFromClaims(req.event.requestContext.authorizer?.jwt?.claims);
    const ok = await keys.create(
      { keyId, hash: sha256(key), name, userId, createdBy },
      householdId,
      now().getTime(),
    );
    if (!ok) {
      return errors.conflict(
        'LIMIT',
        `You can have up to ${MAX_KEYS_PER_HOUSEHOLD} keys. Revoke one first.`,
      );
    }
    log({ event: 'key_created', keyId });
    const created = (await keys.list(householdId)).find((k) => k.keyId === keyId);
    return json(201, {
      key,
      shortcutKey: created
        ? publicKey(created)
        : { keyId, name, createdBy, createdAt: now().toISOString(), lastUsedAt: null },
    });
  }

  async function listKeys(req: AuthedRequest): Promise<HttpResult> {
    const list = await getDeps().keys.list(req.household.householdId);
    return json(200, { keys: list.map(publicKey), max: MAX_KEYS_PER_HOUSEHOLD });
  }

  async function revokeKey(req: AuthedRequest): Promise<HttpResult> {
    const keyId = req.event.pathParameters?.keyId ?? '';
    if (!(await getDeps().keys.revoke(req.household.householdId, keyId))) return errors.notFound();
    log({ event: 'key_revoked', keyId });
    return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
  }

  // ---------------------------------------------------------------- quick routes (public)

  /** The key behind `Authorization: Bearer trl_...`, rate-limited; or the response to send. */
  async function authenticate(
    req: PublicRequest,
  ): Promise<{ rec: ShortcutKeyRecord } | { res: HttpResult }> {
    const { keys, limiter, now } = getDeps();
    const header = req.event.headers?.authorization ?? req.event.headers?.Authorization ?? '';
    const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
    const presented = m?.[1] ?? '';
    if (!KEY_FORMAT.test(presented)) return { res: invalidKey() };
    const hash = sha256(presented);
    const rec = await keys.findByHash(hash);
    // The lookup is by hash; the compare keeps the check constant-time regardless.
    if (!rec || !safeEqual(rec.hash, hash)) {
      log({ event: 'quick_denied' });
      return { res: invalidKey() };
    }
    const nowMs = now().getTime();
    if (!(await limiter.consume('QUICK', rec.keyId, 60_000, QUICK_PER_MINUTE, nowMs))) {
      log({ event: 'quick_rate_limited', keyId: rec.keyId });
      return {
        res: {
          ...quick(429, { spoken: "That's a lot at once. Give it a minute, then try again." }),
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'retry-after': '60',
          },
        },
      };
    }
    await keys.touch(rec, nowMs);
    return { rec };
  }

  async function quickAdd(req: PublicRequest): Promise<HttpResult> {
    const auth = await authenticate(req);
    if ('res' in auth) return auth.res;
    const { rec } = auth;
    const parsed = parseQuickBody(req.event);
    if (!parsed) return quick(400, { spoken: "I didn't catch what to add. Try again." });
    const items = splitItems(parsed.text);
    if (items.length === 0) return quick(400, { spoken: "I didn't catch what to add. Try again." });

    const ctx: ToolContext = { householdId: rec.householdId, userId: rec.userId };
    const single = items.length === 1;
    const added: NonNullable<QuickResponse['added']> = [];
    const addedNames: string[] = [];
    const problems: string[] = [];
    let listName = '';
    for (const text of items) {
      const args: Record<string, unknown> = { text };
      if (single && parsed.quantity !== undefined) args.quantity = parsed.quantity;
      const res = await getDeps().callTool('add_item', args, ctx);
      const s = res.structuredContent;
      if (s?.added === true) {
        addedNames.push(String(s.name));
        listName = String(s.listName);
        added.push({ name: String(s.name), qty: Number(s.qty), unit: String(s.unit) });
      } else if (Array.isArray(s?.options) && s.options.length > 0) {
        const names = (s.options as Array<{ name?: unknown }>)
          .slice(0, 3)
          .map((o) => String(o.name));
        problems.push(
          `${single ? 'I found a few' : `For ${text}, I found a few`} - ${spokenJoin(names, 'or')}. ` +
            'Try saying the one you want.',
        );
      } else if (s?.added === false) {
        problems.push(`I couldn't find ${text} at ALDI.`);
      } else {
        const msg = res.content[0]?.text ?? "That didn't work.";
        problems.push(msg.length > 140 ? "That didn't work." : msg);
      }
    }
    log({ event: 'quick_add', keyId: rec.keyId, items: items.length, added: added.length });
    const spoken = [
      addedNames.length ? `Added ${spokenJoin(addedNames)} to ${listName}.` : '',
      ...problems,
    ]
      .filter(Boolean)
      .join(' ');
    return quick(200, { spoken, ...(added.length ? { added } : {}) });
  }

  async function quickList(req: PublicRequest): Promise<HttpResult> {
    const auth = await authenticate(req);
    if ('res' in auth) return auth.res;
    const hh = auth.rec.householdId;
    const { lists } = getDeps();
    const listId = await activeThisWeekId(lists, hh);
    if (!listId) return quick(200, { spoken: "There's no list for this week yet." });
    const items = (await lists.items(hh, listId)).filter((i) => !i.ticked);
    if (items.length === 0) return quick(200, { spoken: "You've got nothing left on your list." });
    const names = items.slice(0, MAX_LIST_NAMES).map((i) => i.product.name);
    const more = items.length - names.length;
    const count = `${items.length} ${items.length === 1 ? 'thing' : 'things'}`;
    return quick(200, {
      spoken: `You've got ${count} left: ${spokenJoin(names)}${more > 0 ? `, and ${more} more` : ''}.`,
    });
  }

  return {
    'POST /api/shortcut-keys': { auth: true, handler: createKey },
    'GET /api/shortcut-keys': { auth: true, handler: listKeys },
    'DELETE /api/shortcut-keys/{keyId}': { auth: true, handler: revokeKey },
    'POST /api/quick/add': { auth: false, handler: quickAdd },
    'GET /api/quick/list': { auth: false, handler: quickList },
  };
}

function parseJson(event: { body?: string | undefined; isBase64Encoded?: boolean }): unknown {
  const raw = event.body ?? '';
  const text = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  if (text.length > 2048) return fail.validation('Body is too large');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fail.validation('Body must be valid JSON');
  }
}
