/** Tolerant DynamoDB item -> domain readers for lines (template items, list items). */
import { isUnitType, type Line, type ListItem, type ProductSnapshot } from '@trolley/core';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function toSnapshot(v: unknown): ProductSnapshot | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const productId = str(r.productId);
  const name = str(r.name);
  if (!productId || !name) return null;
  return {
    productId,
    name,
    brand: str(r.brand),
    imageUrl: str(r.imageUrl),
    packSize: str(r.packSize),
    groupId: str(r.groupId) ?? 'other',
    unitType: isUnitType(r.unitType) ? r.unitType : 'each',
  };
}

export function toLine(v: unknown): Line | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const id = str(r.id);
  const product = toSnapshot(r.product);
  const qty = num(r.qty);
  if (!id || !product || qty === null || !isUnitType(r.unit)) return null;
  return {
    id,
    product,
    qty,
    unit: r.unit,
    note: str(r.note),
    version: num(r.version) ?? 1,
    createdAt: str(r.createdAt) ?? '',
    updatedAt: str(r.updatedAt) ?? '',
  };
}

export function toListItem(v: unknown): ListItem | null {
  const line = toLine(v);
  if (!line) return null;
  const r = v as Record<string, unknown>;
  return {
    ...line,
    listId: str(r.listId) ?? '',
    ticked: r.ticked === true,
    tickedAt: str(r.tickedAt),
    updatedBy: str(r.updatedBy) ?? '',
  };
}

/** Plain line fields for storage (no DynamoDB keys). */
export function lineFields(line: Line): Record<string, unknown> {
  return {
    id: line.id,
    product: line.product,
    qty: line.qty,
    unit: line.unit,
    note: line.note,
    version: line.version,
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
  };
}
