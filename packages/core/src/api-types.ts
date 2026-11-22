/** Response shapes shared between services/api and apps/web. */
import type {
  ListItem,
  ListStatus,
  ProductSnapshot,
  TemplateItem,
  TemplateType,
  UnitOverride,
} from './lists';
import type { UnitType } from './product';

export interface HealthResponse {
  status: 'ok';
}

export interface MeResponse {
  userId: string;
  email: string;
  householdId: string;
}

export type ErrorCode =
  | 'UNAUTHORISED'
  | 'NO_HOUSEHOLD'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface ErrorResponse {
  code: ErrorCode;
  message: string;
}

/** 400 VALIDATION: which field failed. */
export interface ValidationErrorResponse extends ErrorResponse {
  code: 'VALIDATION';
  field?: string;
}

// ---------------------------------------------------------------------------------------
// Products (Stage 1)

/** One search result / product card. */
export interface ProductSummary {
  /** ALDI SKU (digits) or `custom-<uuid>` for a household custom product. */
  sku: string;
  name: string;
  brand: string | null;
  /** Hotlinked store image (any https host), or null (custom products, missing image). */
  imageUrl: string | null;
  /** AUD cents; per kg for loose produce. Null for custom products. */
  price: number | null;
  /** e.g. "$1.70 per 1 L"; null when unknown. */
  unitPrice: string | null;
  /** e.g. "2 L", "500 g", "5 each", "per kg", "approx. 0.96 kg". Null when unknown. */
  packSize: string | null;
  /** Unit the quantity modal opens in: the household's override if any, else the default. */
  unitType: UnitType;
  /**
   * The product's own (inferred) unit, before household overrides (Stage 2). Present on
   * every API response; optional only for older fixtures.
   */
  defaultUnitType?: UnitType;
  /** Household group id (see DEFAULT_GROUPS). */
  groupId: string;
  /** True for household custom products. */
  custom: boolean;
}

/**
 * GET /api/products/search?q=&category=&cursor=&limit=
 * - q: free text (type-ahead; word-prefix matching, case/accent-insensitive).
 *   Optional when `category` is given (then: browse the group A to Z).
 * - category: group id filter (see GET /api/groups), e.g. "dairy-eggs".
 * - limit: 1-48, default 20.
 * - cursor: opaque `nextCursor` from the previous page.
 * Discontinued catalogue products are excluded. Household custom products are included.
 */
export interface ProductSearchResponse {
  items: ProductSummary[];
  /** Total matches across all pages (for "24 results" / "Dairy & Eggs, 86 products"). */
  total: number;
  /** Pass back as `cursor` for the next page; null when there are no more results. */
  nextCursor: string | null;
}

/** GET /api/products/{sku} */
export interface ProductDetailResponse extends ProductSummary {
  /** Catalogue product no longer seen in ALDI's range (kept for history). */
  discontinued: boolean;
}

/**
 * POST /api/products/custom. Duplicate names are allowed (the UI offers "Use existing").
 * 400 VALIDATION with `field` for: name (required, 1-80 chars), brand (<= 40), packSize
 * (<= 30), unitType (one of UNIT_TYPES), groupId (a group id).
 */
export interface CreateCustomProductRequest {
  name: string;
  /** Default "each". */
  unitType?: UnitType;
  /** Default "other". */
  groupId?: string;
  brand?: string;
  packSize?: string;
}

/** 201 Created: the new product (custom: true). */
export type CreateCustomProductResponse = ProductSummary;

export interface GroupSummary {
  id: string;
  name: string;
  /** Chip label. */
  shortName: string;
}

/** GET /api/groups: the household's groups in its aisle order (Settings > Aisle order). */
export interface GroupsResponse {
  groups: GroupSummary[];
}

// ---------------------------------------------------------------------------------------
// Stage 2: lists, templates, settings. Endpoint reference: docs/api.md.

/**
 * 409 CONFLICT. `reason`:
 * - STALE: the `version` sent is old (other phone changed it); `current` holds the latest.
 * - LIST_ARCHIVED: the list is archived (read-only).
 * - NOT_ARCHIVED: reopen (Undo) of a list that is already active.
 * - LIMIT: a count limit (A2) would be exceeded.
 * - UNDO_EXPIRED: reopen asked after the undo window.
 */
export interface ConflictErrorResponse extends ErrorResponse {
  code: 'CONFLICT';
  reason: 'STALE' | 'LIST_ARCHIVED' | 'NOT_ARCHIVED' | 'LIMIT' | 'UNDO_EXPIRED';
  current?: unknown;
}

/** Request body for adding to a list or template (POST .../items). */
export interface AddItemRequest {
  productId: string;
  qty: number;
  unit: UnitType;
  note?: string | null;
}

/** PATCH .../items/{itemId}. `version` required when qty/unit/note change. */
export interface EditItemRequest {
  qty?: number;
  unit?: UnitType;
  note?: string | null;
  /** Lists only. */
  ticked?: boolean;
  version?: number;
}

// ---- Templates

export interface TemplateSummary {
  id: string;
  name: string;
  type: TemplateType;
  itemCount: number;
  /** First 3 item names in aisle order. */
  preview: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Template extends Omit<TemplateSummary, 'preview'> {
  /** Sorted by household aisle order, then name. */
  items: TemplateItem[];
}

/** GET /api/templates (weekly first, then by name). */
export interface TemplatesResponse {
  templates: TemplateSummary[];
}

export interface CreateTemplateRequest {
  name: string;
  /** Default weekly. */
  type?: TemplateType;
}

export interface UpdateTemplateRequest {
  name?: string;
  type?: TemplateType;
  version: number;
}

/** POST /api/templates/{id}/items (200 merged, 201 new row). */
export interface TemplateItemMutationResponse {
  template: Template;
  item: TemplateItem;
  /** True when it summed into an existing row (D-046). */
  merged: boolean;
}

// ---- Lists

export interface ListSummary {
  id: string;
  name: string;
  status: ListStatus;
  /** The household's "this week" list (D-048). Always false when archived. */
  thisWeek: boolean;
  /** Item rows on the list, and how many are ticked (archived: bought). */
  itemCount: number;
  tickedCount: number;
  createdAt: string;
  updatedAt: string;
  /** Set when archived. */
  completedAt: string | null;
  /** How it was archived: last tick ("auto") or "Finish shop". */
  finishedBy: 'auto' | 'finish' | null;
  /** List row version (rename, archive, reopen). Items have their own. */
  version: number;
}

export interface ListDetail extends ListSummary {
  /** Unsorted; group with groupForShop(items, aisleOrder). */
  items: ListItem[];
}

/** GET /api/lists: active lists, "this week" first then newest. */
export interface ListsResponse {
  lists: ListSummary[];
}

/** GET /api/history?cursor=&limit= : archived lists, newest completed first. */
export interface HistoryResponse {
  lists: ListSummary[];
  nextCursor: string | null;
}

export interface CreateListRequest {
  /** Default "Week of <Monday>". */
  name?: string;
  /** Start from these templates, merged by D-046. */
  templateIds?: string[];
  /** See CreateListInput.thisWeek. */
  thisWeek?: boolean;
}

/** One line touched by a bulk add, so the client can undo it. */
export interface LineChange {
  itemId: string;
  /** True: a new row (undo = DELETE); false: merged (undo = PATCH qty - addedQty). */
  created: boolean;
  addedQty: number;
  /** Item version after the change (for the undo PATCH/DELETE). */
  version: number;
}

/** POST /api/lists (201). */
export interface CreateListResponse {
  list: ListDetail;
  /** Lines folded together when merging templates (for "(4 combined)"). */
  combined: number;
}

export interface UpdateListRequest {
  name?: string;
  /** Required with name. */
  version?: number;
  thisWeek?: boolean;
}

/** POST /api/lists/{id}/templates. */
export interface AddTemplatesToListRequest {
  templateIds: string[];
}

export interface AddTemplatesToListResponse {
  list: ListDetail;
  /** Template lines processed (after merging the templates together). */
  added: number;
  /** Lines that summed into an existing row or another template's line. */
  combined: number;
  changes: LineChange[];
}

/** POST /api/lists/{id}/items and POST /api/this-week/items (200 merged, 201 new row). */
export interface ListItemMutationResponse {
  item: ListItem;
  list: ListSummary;
  merged: boolean;
  /** Quantity this request added (for Undo of a merge: PATCH qty = item.qty - addedQty). */
  addedQty: number;
  /** POST /api/this-week/items only: a new "Week of" list was created (C2). */
  listCreated?: boolean;
}

/** PATCH /api/lists/{id}/items/{itemId}. */
export interface ListItemUpdateResponse {
  /** The row after the change. A unit change re-keys the row: use item.id from here. */
  item: ListItem;
  list: ListSummary;
  /** This change archived the list (last item ticked, F1). Show the Undo toast. */
  archived: boolean;
  /** id of the row that was replaced when a unit change re-keyed it. */
  replacedItemId?: string;
}

/** DELETE /api/lists/{id}/items/{itemId}. */
export interface ListItemDeleteResponse {
  list: ListSummary;
}

/** POST /api/lists/{id}/finish and /reopen. */
export interface ListArchiveResponse {
  list: ListDetail;
}

// ---- Settings

/** GET /api/settings/aisle-order, PUT, DELETE (reset). */
export interface AisleOrderResponse {
  groups: GroupSummary[];
  isDefault: boolean;
  /** Pass back on PUT to detect the other phone's change (409 STALE). */
  version: number;
}

export interface AisleOrderRequest {
  /** All 15 group ids in the new order. */
  order: string[];
  version?: number;
}

/** GET /api/settings/unit-overrides (by name). */
export interface UnitOverridesResponse {
  overrides: UnitOverride[];
}

/** PUT /api/settings/unit-overrides/{productId}. Same as the default unit removes it. */
export interface UnitOverrideRequest {
  unit: UnitType;
}

export interface UnitOverrideResponse {
  /** Null when the override was removed (unit equals the product default). */
  override: UnitOverride | null;
}

// ---------------------------------------------------------------------------------------
// Stage 3: suggestions (docs/api.md, docs/stages/stage-3.md, D-061 to D-073)

/** How the order and reasons were produced: the AI pass, or the deterministic rules alone. */
export type SuggestionSource = 'ai' | 'rules';

export interface Suggestion {
  productId: string;
  /** Product as it would be added (D-047): name, brand, image, pack size, group, unit type. */
  snapshot: ProductSnapshot;
  /** Pre-filled quantity, valid for `unit` (D-052). */
  qty: number;
  unit: UnitType;
  /** Template note, if the item comes from a weekly template. */
  note: string | null;
  /** One line, plain text, <= 90 chars (render as text, never as HTML). */
  reason: string;
  /** On a weekly template ("Weekly" badge). */
  fromTemplate: boolean;
  /** Due from purchase history. Both can be true. */
  fromHistory: boolean;
}

/**
 * POST /api/lists/{listId}/suggestions (excludes products already on the list) and
 * POST /api/suggestions (no list, nothing excluded). Read-only. 429 RATE_LIMITED after
 * 20 runs per household per day.
 */
export interface SuggestionsResponse {
  source: SuggestionSource;
  /** Fewer than 3 archived lists: weekly template items only. */
  coldStart: boolean;
  /** Cold-start note to show above the list (null otherwise). */
  note: string | null;
  /** In display order, at most 40. Empty: "Nothing to suggest yet". */
  suggestions: Suggestion[];
}

/** POST /api/lists/{listId}/items/bulk: 1-50 items, each added by the merge rule (D-046). */
export interface BulkAddItemsRequest {
  items: AddItemRequest[];
}

export type BulkAddItemResult =
  | {
      ok: true;
      productId: string;
      unit: UnitType;
      /** For Undo: created -> DELETE ?version=; merged -> PATCH qty = item.qty - addedQty. */
      change: LineChange;
    }
  | {
      ok: false;
      productId: string;
      unit: UnitType;
      /** VALIDATION (bad qty, unknown product, over the unit max), LIMIT (list full), CONFLICT. */
      code: 'VALIDATION' | 'LIMIT' | 'CONFLICT';
      message: string;
    };

export interface BulkAddItemsResponse {
  /** The list after the adds. */
  list: ListDetail;
  /** One per request item, in request order. */
  results: BulkAddItemResult[];
  /** Count of ok results. */
  added: number;
  failed: number;
}

/** POST /api/lists/{listId}/items/undo: the `change`s of a bulk add (or add templates). */
export interface BulkUndoRequest {
  changes: LineChange[];
}

export type BulkUndoResult =
  | { ok: true; itemId: string }
  | {
      ok: false;
      itemId: string;
      /** CONFLICT: the row changed since the add (other phone); it is left as it is. */
      code: 'VALIDATION' | 'LIMIT' | 'CONFLICT';
      message: string;
    };

export interface BulkUndoResponse {
  list: ListDetail;
  results: BulkUndoResult[];
  undone: number;
  failed: number;
}
