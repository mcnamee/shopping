/**
 * Suggestions data access: the household's purchase rows (D-050/D-054, D-067: one Query on
 * `PURCHASE#` under `HH#<hh>`) and the daily run counter (D-066, D-071).
 */
import { isUnitType, keys, type PurchaseInput } from '@trolley/core';
import { ConditionFailed, type Db } from '../db';

/** Runs per household per household-local day (D-066). */
export const SUGGEST_DAILY_LIMIT = 20;
/** Recipe match runs per household per local day (D-115). */
export const RECIPE_MATCH_DAILY_LIMIT = 60;
/** Counter rows expire (DynamoDB TTL) a couple of days after their day. */
const COUNTER_TTL_SECONDS = 3 * 24 * 60 * 60;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export class SuggestionStore {
  constructor(private readonly db: Db) {}

  /** All purchase rows of the household (strongly consistent, paginated). */
  async purchases(hh: string): Promise<PurchaseInput[]> {
    const rows = await this.db.queryAll(keys.householdPk(hh), keys.purchaseSkPrefix);
    const out: PurchaseInput[] = [];
    for (const r of rows) {
      const productId = str(r.productId);
      const listId = str(r.listId);
      const date = str(r.date);
      if (!productId || !listId || !date || typeof r.qty !== 'number' || !isUnitType(r.unit)) {
        continue;
      }
      out.push({
        productId,
        name: str(r.name) ?? productId,
        groupId: str(r.groupId) ?? 'other',
        qty: r.qty,
        unit: r.unit,
        listId,
        date,
      });
    }
    return out;
  }

  /**
   * Count one run for the household's local `day` ("YYYY-MM-DD"). Returns false (and
   * counts nothing) when the day's limit is already used. One conditional UpdateItem, so
   * two phones racing for the last run cannot both get it.
   */
  async consumeRun(hh: string, day: string, nowMs: number): Promise<boolean> {
    return this.consume(keys.suggestRunsSk(day), 'SuggestRuns', SUGGEST_DAILY_LIMIT, hh, nowMs);
  }

  /** Same counter for recipe matching (D-115): its own row and limit. */
  async consumeMatchRun(hh: string, day: string, nowMs: number): Promise<boolean> {
    return this.consume(
      keys.recipeMatchRunsSk(day),
      'RecipeMatchRuns',
      RECIPE_MATCH_DAILY_LIMIT,
      hh,
      nowMs,
    );
  }

  private async consume(
    sk: string,
    entity: string,
    max: number,
    hh: string,
    nowMs: number,
  ): Promise<boolean> {
    try {
      await this.db.update(
        { pk: keys.householdPk(hh), sk },
        'SET runs = if_not_exists(runs, :zero) + :one, #ttl = :ttl, entity = :entity',
        {
          condition: 'attribute_not_exists(runs) OR runs < :max',
          names: { '#ttl': 'ttl' },
          values: {
            ':zero': 0,
            ':one': 1,
            ':max': max,
            ':ttl': Math.floor(nowMs / 1000) + COUNTER_TTL_SECONDS,
            ':entity': entity,
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
