import {
  groupForShop,
  type AddItemRequest,
  type BulkAddItemResult,
  type LineChange,
  type ListItem,
  type ShopSection,
  type Suggestion,
} from '@trolley/core';

export interface SuggestionSection {
  group: ShopSection<ListItem>['group'];
  items: { index: number; suggestion: Suggestion }[];
}

/**
 * Group suggestions by the household aisle order (same groups as shop mode). Rows keep the
 * order the server sent within a group. Empty groups are dropped.
 */
export function groupSuggestions(
  suggestions: readonly Suggestion[],
  aisleOrder: readonly string[],
): SuggestionSection[] {
  const lines = suggestions.map(
    (s, index) =>
      ({
        id: String(index),
        product: s.snapshot,
        qty: s.qty,
        unit: s.unit,
        note: s.note,
        ticked: false,
      }) as unknown as ListItem,
  );
  return groupForShop(lines, aisleOrder).map((section) => ({
    group: section.group,
    items: section.items
      .map((l) => Number(l.id))
      .sort((a, b) => a - b)
      .map((index) => ({ index, suggestion: suggestions[index] as Suggestion })),
  }));
}

export const countItems = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

export function toBulkItems(
  picks: readonly { suggestion: Suggestion; qty: number }[],
): AddItemRequest[] {
  return picks.map(({ suggestion: s, qty }) => ({
    productId: s.productId,
    qty,
    unit: s.unit,
    ...(s.note ? { note: s.note } : {}),
  }));
}

export interface BulkSummary {
  changes: LineChange[];
  /** Ids of every row touched, for the highlight. */
  itemIds: string[];
  combined: number;
  limitHit: boolean;
}

export function summariseBulk(results: readonly BulkAddItemResult[]): BulkSummary {
  const changes: LineChange[] = [];
  let limitHit = false;
  for (const r of results) {
    if (r.ok) changes.push(r.change);
    else if (r.code === 'LIMIT') limitHit = true;
  }
  return {
    changes,
    itemIds: changes.map((c) => c.itemId),
    combined: changes.filter((c) => !c.created).length,
    limitHit,
  };
}

/** Toast copy after a bulk add: "Added 12 items (2 combined)" or "Added 10 of 12 - 2 couldn't be added. Try again". */
export function addedMessage(total: number, added: number, combined: number): string {
  if (added < total)
    return `Added ${added} of ${total} - ${total - added} couldn't be added. Try again`;
  return `Added ${countItems(added)}${combined > 0 ? ` (${combined} combined)` : ''}`;
}
