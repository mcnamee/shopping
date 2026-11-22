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
  /** Sort key of a catalogue product item (pk = productPk). */
  productSk: 'META',
  /** Custom product: pk = householdPk, sk = customProductSk. */
  customProductSk(sku: string): string {
    assertSegment('sku', sku);
    return `PRODUCT#${sku}`;
  },
  /** GSI1 partition holding every catalogue product (one Query loads the catalogue). */
  catalogueGsi1Pk: 'CATALOGUE#PRODUCT',
  catalogueGsi1Sk(groupId: string, sku: string): string {
    assertSegment('groupId', groupId);
    assertSegment('sku', sku);
    return `${groupId}#${sku}`;
  },
  // ----- Stage 2 (spec 5.1, D-050, D-053 to D-056). pk = householdPk unless noted.
  /** List row. */
  listSk(listId: string): string {
    assertSegment('listId', listId);
    return `LIST#${listId}`;
  },
  /** List item row: pk = listItemPk(hh, listId). itemId = lineIdFor(productId, unit). */
  listItemSk(itemId: string): string {
    assertSegment('itemId', itemId);
    return `ITEM#${itemId}`;
  },
  listItemSkPrefix: 'ITEM#',
  listSkPrefix: 'LIST#',
  /** Template row (items embedded). */
  templateSk(templateId: string): string {
    assertSegment('templateId', templateId);
    return `TEMPLATE#${templateId}`;
  },
  templateSkPrefix: 'TEMPLATE#',
  /** Household settings: aisle order, unit overrides. */
  settingsSk: 'SETTINGS',
  /** Pointer to the "this week" list (D-056): one item, so flagging is one atomic write. */
  thisWeekSk: 'THISWEEK',
  purchaseSkPrefix: 'PURCHASE#',
  /** Daily suggestion-run counter (D-066): one row per household-local day, TTL'd. */
  suggestRunsSk(day: string): string {
    assertSegment('day', day);
    return `SUGGESTRUNS#${day}`;
  },
  /** GSI2 partition of a household's lists by status (D-057). */
  listsGsi2Pk(householdId: string, status: 'active' | 'archived'): string {
    assertHousehold(householdId);
    return `HH#${householdId}#LISTS#${status}`;
  },
  /** GSI2 sort key: createdAt (active) or completedAt (archived), then id. */
  listsGsi2Sk(at: string, listId: string): string {
    assertSegment('listId', listId);
    return `${at}#${listId}`;
  },
  /** Scrape run records: pk = scrapeRunPk, sk = ISO start time. */
  scrapeRunPk: 'SCRAPE#RUN',
} as const;

/** Partition-key prefixes the scraper may write (IAM dynamodb:LeadingKeys, see infra). */
export const SCRAPER_WRITABLE_PK_PREFIXES = ['PRODUCT#', 'SCRAPE#'] as const;
