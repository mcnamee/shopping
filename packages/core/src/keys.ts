/**
 * DynamoDB single-table key builders (see docs/PRODUCT_SPEC.md section 5.1).
 * Every household-owned item lives under a partition derived from the household id,
 * so a query can never cross households as long as the id comes from verified claims.
 */
import { isValidHouseholdId } from './household';

function assertHousehold(householdId: string): void {
  if (!isValidHouseholdId(householdId)) {
    throw new Error('Invalid householdId');
  }
}

function assertSegment(name: string, value: string): void {
  if (value.length === 0 || value.includes('#')) {
    throw new Error(`Invalid key segment: ${name}`);
  }
}

export const keys = {
  householdPk(householdId: string): string {
    assertHousehold(householdId);
    return `HH#${householdId}`;
  },
  listItemPk(householdId: string, listId: string): string {
    assertHousehold(householdId);
    assertSegment('listId', listId);
    return `HH#${householdId}#LIST#${listId}`;
  },
  productPk(sku: string): string {
    assertSegment('sku', sku);
    return `PRODUCT#${sku}`;
  },
} as const;
