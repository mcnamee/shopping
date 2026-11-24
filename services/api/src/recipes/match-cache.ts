/**
 * Cached smart-match result per household + recipe (D-116): HH#<hh> / MATCHCACHE#<recipeId>,
 * keyed by a hash of the recipe's ingredients text, TTL 30 days. Also holds the user's
 * remembered per-line choices, which override the computed match when served.
 */
import { createHash } from 'node:crypto';
import { keys, type RecipeMatchRow } from '@trolley/core';
import type { Db, DbItem } from '../db';

export const MATCH_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A remembered choice: a productId, or this for "keep as text". */
export const TEXT_CHOICE = 'text';

export interface MatchCacheEntry {
  hash: string;
  rows: RecipeMatchRow[];
  ai: boolean;
  cachedAt: string;
  /** Recipe line text -> productId or "text". */
  choices: Record<string, string>;
}

export const ingredientsHash = (ingredients: string): string =>
  createHash('sha256').update(ingredients).digest('hex');

const keyOf = (hh: string, recipeId: string) => ({
  pk: keys.householdPk(hh),
  sk: keys.recipeMatchCacheSk(recipeId),
});

export class MatchCacheStore {
  constructor(private readonly db: Db) {}

  /** The entry if its hash matches and it is under 30 days old (TTL deletion is lazy). */
  async get(
    hh: string,
    recipeId: string,
    hash: string,
    nowMs: number,
  ): Promise<MatchCacheEntry | null> {
    const row = await this.db.get(keyOf(hh, recipeId));
    if (!row || row.hash !== hash || !Array.isArray(row.rows)) return null;
    const at = typeof row.cachedAt === 'string' ? Date.parse(row.cachedAt) : NaN;
    if (!Number.isFinite(at) || nowMs - at >= MATCH_CACHE_TTL_MS) return null;
    return {
      hash,
      rows: row.rows as RecipeMatchRow[],
      ai: row.ai === true,
      cachedAt: row.cachedAt as string,
      choices: toChoices(row.choices),
    };
  }

  /** Store a fresh result. Choices survive only while the hash is unchanged. */
  async put(
    hh: string,
    recipeId: string,
    hash: string,
    rows: RecipeMatchRow[],
    ai: boolean,
    nowMs: number,
  ): Promise<string> {
    const previous = await this.db.get(keyOf(hh, recipeId));
    const choices = previous?.hash === hash ? toChoices(previous.choices) : {};
    const cachedAt = new Date(nowMs).toISOString();
    await this.db.put({
      ...keyOf(hh, recipeId),
      entity: 'RecipeMatchCache',
      hash,
      rows,
      ai,
      cachedAt,
      choices,
      ttl: Math.floor((nowMs + MATCH_CACHE_TTL_MS) / 1000),
    } satisfies DbItem);
    return cachedAt;
  }

  /** Merge choices into a live entry. False when there is none (nothing to remember). */
  async saveChoices(
    hh: string,
    recipeId: string,
    hash: string,
    choices: Record<string, string>,
    nowMs: number,
  ): Promise<boolean> {
    const entry = await this.get(hh, recipeId, hash, nowMs);
    if (!entry) return false;
    await this.db.update(keyOf(hh, recipeId), 'SET choices = :c', {
      condition: 'attribute_exists(pk)',
      values: { ':c': { ...entry.choices, ...choices } },
    });
    return true;
  }

  async remove(hh: string, recipeId: string): Promise<void> {
    await this.db.delete(keyOf(hh, recipeId));
  }
}

function toChoices(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof v === 'object' && v !== null) {
    for (const [k, c] of Object.entries(v)) if (typeof c === 'string') out[k] = c;
  }
  return out;
}

/** Overlay remembered choices: a pick among the row's own products, or text. */
export function applyChoices(
  rows: RecipeMatchRow[],
  choices: Record<string, string>,
): RecipeMatchRow[] {
  return rows.map((row) => {
    const c = choices[row.line];
    if (c === undefined) return row;
    if (c === TEXT_CHOICE) {
      return row.match
        ? { ...row, match: null, alternatives: [row.match, ...row.alternatives].slice(0, 3) }
        : row;
    }
    const all = [row.match, ...row.alternatives].filter((p) => p !== null);
    const picked = all.find((p) => p.productId === c);
    if (!picked) return row;
    return { ...row, match: picked, alternatives: all.filter((p) => p !== picked).slice(0, 3) };
  });
}
