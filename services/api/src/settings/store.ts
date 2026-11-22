/**
 * Household settings (HH#<hh> / SETTINGS, spec 5.1): aisle order (G1) and per-product unit
 * overrides (C5, G2). Each change is a single UpdateItem on its own attribute, so an aisle
 * reorder on one phone never overwrites a remembered unit from the other.
 */
import {
  DEFAULT_AISLE_ORDER,
  isUnitType,
  keys,
  LIMITS,
  normaliseAisleOrder,
  sortUnitOverrides,
  type UnitOverride,
  type UnitType,
} from '@trolley/core';
import { ConditionFailed, type Db, type DbItem } from '../db';
import { fail } from '../http';

export interface AisleOrderState {
  order: string[];
  /** 0 until the household first saves an order. */
  version: number;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function toOverride(productId: string, v: unknown): UnitOverride | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (!isUnitType(r.unit)) return null;
  return {
    productId,
    unit: r.unit,
    defaultUnit: isUnitType(r.defaultUnit) ? r.defaultUnit : r.unit,
    name: str(r.name) ?? productId,
    brand: str(r.brand),
    imageUrl: str(r.imageUrl),
    packSize: str(r.packSize),
    updatedAt: str(r.updatedAt) ?? '',
  };
}

export class SettingsStore {
  constructor(private readonly db: Db) {}

  private key(householdId: string) {
    return { pk: keys.householdPk(householdId), sk: keys.settingsSk };
  }

  private async row(householdId: string): Promise<DbItem> {
    return (await this.db.get(this.key(householdId))) ?? {};
  }

  async aisleOrder(householdId: string): Promise<AisleOrderState> {
    const row = await this.row(householdId);
    return {
      order: normaliseAisleOrder(Array.isArray(row.aisleOrder) ? row.aisleOrder : undefined),
      version: typeof row.aisleVersion === 'number' ? row.aisleVersion : 0,
    };
  }

  /** Save an order; with `version`, 409 STALE if the other phone saved since. */
  async setAisleOrder(
    householdId: string,
    order: string[] | null,
    version?: number,
  ): Promise<AisleOrderState> {
    const values: Record<string, unknown> = { ':zero': 0, ':one': 1, ':e': 'Settings' };
    let condition: string | undefined;
    if (version !== undefined) {
      if (version === 0) condition = 'attribute_not_exists(aisleVersion)';
      else {
        condition = 'aisleVersion = :v';
        values[':v'] = version;
      }
    }
    const set = 'SET entity = :e, aisleVersion = if_not_exists(aisleVersion, :zero) + :one';
    let expression: string;
    if (order) {
      values[':o'] = order;
      expression = `${set}, aisleOrder = :o`;
    } else {
      expression = `${set} REMOVE aisleOrder`;
    }
    try {
      const row = await this.db.update(this.key(householdId), expression, {
        ...(condition ? { condition } : {}),
        values,
      });
      return {
        order: normaliseAisleOrder(Array.isArray(row.aisleOrder) ? row.aisleOrder : undefined),
        version: row.aisleVersion as number,
      };
    } catch (err) {
      if (err instanceof ConditionFailed) {
        const current = await this.aisleOrder(householdId);
        return fail.conflict('STALE', 'Changed on another phone', current);
      }
      throw err;
    }
  }

  async unitOverrides(householdId: string): Promise<UnitOverride[]> {
    const row = await this.row(householdId);
    const map = (row.unitOverrides ?? {}) as Record<string, unknown>;
    return sortUnitOverrides(
      Object.entries(map).flatMap(([id, v]) => {
        const o = toOverride(id, v);
        return o ? [o] : [];
      }),
    );
  }

  /** productId -> unit, for search results and product detail. */
  async unitOverrideMap(householdId: string): Promise<Record<string, { unit: UnitType }>> {
    const out: Record<string, { unit: UnitType }> = {};
    for (const o of await this.unitOverrides(householdId)) out[o.productId] = { unit: o.unit };
    return out;
  }

  async setUnitOverride(householdId: string, override: UnitOverride): Promise<UnitOverride> {
    const { productId, ...value } = override;
    const names = { '#p': productId };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      // Adding a new product counts against the limit; replacing one does not.
      const existing = await this.row(householdId);
      const map = (existing.unitOverrides ?? {}) as Record<string, unknown>;
      if (!(productId in map) && Object.keys(map).length >= LIMITS.unitOverrides) {
        return fail.conflict(
          'LIMIT',
          `You can remember units for up to ${LIMITS.unitOverrides} products. Remove one in Settings first.`,
        );
      }
      try {
        await this.db.update(this.key(householdId), 'SET unitOverrides.#p = :o, entity = :e', {
          condition: 'attribute_exists(unitOverrides)',
          names,
          values: { ':o': value, ':e': 'Settings' },
        });
        return override;
      } catch (err) {
        if (!(err instanceof ConditionFailed)) throw err;
      }
      try {
        await this.db.update(this.key(householdId), 'SET unitOverrides = :m, entity = :e', {
          condition: 'attribute_not_exists(unitOverrides)',
          values: { ':m': { [productId]: value }, ':e': 'Settings' },
        });
        return override;
      } catch (err) {
        if (!(err instanceof ConditionFailed)) throw err;
      }
    }
    throw new Error('Could not save the unit override');
  }

  /** Remove; 404 when there is no override for the product. */
  async deleteUnitOverride(householdId: string, productId: string): Promise<void> {
    try {
      await this.db.update(this.key(householdId), 'REMOVE unitOverrides.#p', {
        condition: 'attribute_exists(unitOverrides.#p)',
        names: { '#p': productId },
      });
    } catch (err) {
      if (err instanceof ConditionFailed) return fail.notFound();
      throw err;
    }
  }
}

export const DEFAULT_ORDER_STATE: AisleOrderState = { order: [...DEFAULT_AISLE_ORDER], version: 0 };
