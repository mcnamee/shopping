/**
 * Stage 2 routes: templates, lists, history, "this week", household settings. All authed;
 * the household comes only from verified claims (A1) and every key is built from it, so
 * another household's ids simply are not found (404). Endpoint reference: docs/api.md.
 */
import {
  applyUnitOverride,
  canUndoArchive,
  defaultListName,
  groupsInOrder,
  isDefaultAisleOrder,
  isValidEntityId,
  isValidSku,
  mergeLines,
  parseAddItemRequest,
  parseAisleOrderRequest,
  parseCreateListRequest,
  parseCreateTemplateRequest,
  parseEditItemRequest,
  parseItemRef,
  parseTemplateIdsRequest,
  parseUnitOverrideRequest,
  parseUpdateListRequest,
  parseUpdateTemplateRequest,
  snapshotOf,
  sortActiveLists,
  sortTemplateItems,
  sortTemplates,
  templatePreview,
  type AddTemplatesToListResponse,
  type AisleOrderResponse,
  type CreateListResponse,
  type HistoryResponse,
  type LineInput,
  type ListArchiveResponse,
  type ListItemDeleteResponse,
  type ListItemMutationResponse,
  type ListItemUpdateResponse,
  type ListsResponse,
  type Parsed,
  type ProductSummary,
  type Template,
  type TemplateItemMutationResponse,
  type TemplatesResponse,
  type UnitOverrideResponse,
  type UnitOverridesResponse,
  type UnitType,
} from '@trolley/core';
import { fail, json, readJsonBody, type HttpResult } from './http';
import type { ListStore } from './lists/store';
import type { ProductResolver } from './products/resolver';
import type { AuthedRequest, RouteTable } from './router';
import type { SettingsStore } from './settings/store';
import type { TemplateRecord, TemplateStore } from './templates/store';
import { addToThisWeek } from './this-week';

export interface Stage2Deps {
  lists: ListStore;
  templates: TemplateStore;
  settings: SettingsStore;
  resolveProduct: ProductResolver;
  now: () => Date;
}

const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 50;

function unwrap<T>(p: Parsed<T>): T {
  if (!p.ok) return fail.validation(p.message, p.field);
  return p.value;
}

const param = (req: AuthedRequest, name: string) => req.event.pathParameters?.[name];

function entityId(req: AuthedRequest, name: string): string {
  const id = param(req, name);
  return isValidEntityId(id) ? id : fail.notFound();
}

/** Item id from the path (product~unit) and the unit it encodes; 404 if malformed. */
function lineRef(req: AuthedRequest): { id: string; unit: UnitType; text: boolean } {
  const id = param(req, 'itemId');
  const parsed = parseItemRef(id);
  return parsed && id ? { id, unit: parsed.unit, text: parsed.text } : fail.notFound();
}

function lineId(req: AuthedRequest): string {
  return lineRef(req).id;
}

export function createStage2Routes(getDeps: () => Stage2Deps): RouteTable {
  const hhOf = (req: AuthedRequest) => req.household.householdId;

  async function product(hh: string, productId: string): Promise<ProductSummary> {
    const p = await getDeps().resolveProduct(hh, productId);
    return p ?? fail.validation('That product is not in the catalogue', 'productId');
  }

  /** Validate an add request and build its line with a server-side snapshot (D-047). */
  async function lineFromBody(req: AuthedRequest): Promise<LineInput> {
    const input = unwrap(parseAddItemRequest(readJsonBody(req.event)));
    const p = await product(hhOf(req), input.productId);
    return {
      product: snapshotOf({ ...p, unitType: p.defaultUnitType ?? p.unitType }),
      qty: input.qty,
      unit: input.unit,
      note: input.note,
    };
  }

  async function aisleOrder(hh: string): Promise<string[]> {
    return (await getDeps().settings.aisleOrder(hh)).order;
  }

  function templateView(t: TemplateRecord, order: string[]): Template {
    return {
      id: t.id,
      name: t.name,
      type: t.type,
      itemCount: t.items.length,
      version: t.version,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      items: sortTemplateItems(t.items, order),
    };
  }

  async function templateLines(hh: string, ids: string[]): Promise<LineInput[]> {
    const { templates } = getDeps();
    const loaded = await Promise.all(ids.map((id) => templates.get(hh, id)));
    if (loaded.some((t) => !t)) return fail.validation('Unknown template', 'templateIds');
    return (loaded as TemplateRecord[]).flatMap((t) =>
      t.items.map((i) => ({ product: i.product, qty: i.qty, unit: i.unit, note: i.note })),
    );
  }

  // ------------------------------------------------------------------ templates

  async function listTemplates(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const [all, order] = await Promise.all([getDeps().templates.list(hh), aisleOrder(hh)]);
    return json(200, {
      templates: sortTemplates(all).map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        itemCount: t.items.length,
        preview: templatePreview(t.items, order),
        version: t.version,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    } satisfies TemplatesResponse);
  }

  async function createTemplate(req: AuthedRequest): Promise<HttpResult> {
    const input = unwrap(parseCreateTemplateRequest(readJsonBody(req.event)));
    const t = await getDeps().templates.create(hhOf(req), input);
    return json(201, templateView(t, []));
  }

  async function getTemplate(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const [t, order] = await Promise.all([
      getDeps().templates.mustGet(hh, entityId(req, 'templateId')),
      aisleOrder(hh),
    ]);
    return json(200, templateView(t, order));
  }

  async function updateTemplate(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const id = entityId(req, 'templateId');
    const input = unwrap(parseUpdateTemplateRequest(readJsonBody(req.event)));
    const t = await getDeps().templates.update(hh, id, input);
    return json(200, templateView(t, await aisleOrder(hh)));
  }

  async function deleteTemplate(req: AuthedRequest): Promise<HttpResult> {
    await getDeps().templates.delete(hhOf(req), entityId(req, 'templateId'));
    return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
  }

  async function addTemplateItem(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const id = entityId(req, 'templateId');
    await getDeps().templates.mustGet(hh, id);
    const line = await lineFromBody(req);
    const { template, result } = await getDeps().templates.addItem(hh, id, line);
    return json(result.merged ? 200 : 201, {
      template: templateView(template, await aisleOrder(hh)),
      item: result.item,
      merged: result.merged,
    } satisfies TemplateItemMutationResponse);
  }

  async function editTemplateItem(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const id = entityId(req, 'templateId');
    const { id: itemId, unit: currentUnit, text } = lineRef(req);
    if (text) return fail.notFound(); // templates stay product-only (B-024)
    const edit = unwrap(
      parseEditItemRequest(readJsonBody(req.event), { allowTicked: false, currentUnit }),
    );
    const { template, result } = await getDeps().templates.editItem(
      hh,
      id,
      itemId,
      {
        ...(edit.qty !== undefined ? { qty: edit.qty } : {}),
        ...(edit.unit !== undefined ? { unit: edit.unit } : {}),
        ...(edit.note !== undefined ? { note: edit.note } : {}),
      },
      edit.version as number,
    );
    return json(200, {
      template: templateView(template, await aisleOrder(hh)),
      item: result.item,
      merged: result.merged,
    } satisfies TemplateItemMutationResponse);
  }

  async function deleteTemplateItem(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const { template } = await getDeps().templates.deleteItem(
      hh,
      entityId(req, 'templateId'),
      lineId(req),
    );
    return json(200, { template: templateView(template, await aisleOrder(hh)) });
  }

  // ------------------------------------------------------------------ lists

  async function listLists(req: AuthedRequest): Promise<HttpResult> {
    const lists = await getDeps().lists.activeSummaries(hhOf(req));
    return json(200, { lists: sortActiveLists(lists) } satisfies ListsResponse);
  }

  async function createList(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const { lists, now } = getDeps();
    const input = unwrap(parseCreateListRequest(readJsonBody(req.event)));
    const merged = mergeLines(await templateLines(hh, input.templateIds));
    const rec = await lists.create(hh, req.household.userId, {
      name: input.name ?? defaultListName(now()),
      lines: merged.lines,
      thisWeek: input.thisWeek,
    });
    return json(201, {
      list: await lists.detail(hh, rec.id),
      combined: merged.combined,
    } satisfies CreateListResponse);
  }

  async function getList(req: AuthedRequest): Promise<HttpResult> {
    return json(200, await getDeps().lists.detail(hhOf(req), entityId(req, 'listId')));
  }

  async function updateList(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const id = entityId(req, 'listId');
    const { lists } = getDeps();
    const input = unwrap(parseUpdateListRequest(readJsonBody(req.event)));
    await lists.mustGetActive(hh, id);
    if (input.name !== undefined) await lists.rename(hh, id, input.name, input.version as number);
    if (input.thisWeek === true) await lists.setThisWeek(hh, id);
    if (input.thisWeek === false) await lists.clearThisWeek(hh, id);
    return json(200, await lists.summaryOf(hh, id));
  }

  async function deleteList(req: AuthedRequest): Promise<HttpResult> {
    await getDeps().lists.deleteList(hhOf(req), entityId(req, 'listId'));
    return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
  }

  async function addTemplatesToList(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const id = entityId(req, 'listId');
    const { lists } = getDeps();
    const ids = unwrap(parseTemplateIdsRequest(readJsonBody(req.event)));
    await lists.mustGetActive(hh, id);
    const merged = mergeLines(await templateLines(hh, ids));
    const changes = await lists.addLines(hh, req.household.userId, id, merged.lines);
    return json(200, {
      list: await lists.detail(hh, id),
      added: merged.lines.length,
      combined: merged.combined + changes.filter((c) => !c.created).length,
      changes,
    } satisfies AddTemplatesToListResponse);
  }

  async function addListItem(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const id = entityId(req, 'listId');
    const { lists } = getDeps();
    await lists.mustGetActive(hh, id);
    const line = await lineFromBody(req);
    const { item, merged } = await lists.addItem(hh, req.household.userId, id, line);
    return json(merged ? 200 : 201, {
      item,
      list: await lists.summaryOf(hh, id),
      merged,
      addedQty: line.qty,
    } satisfies ListItemMutationResponse);
  }

  async function addThisWeekItem(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const deps = getDeps();
    const line = await lineFromBody(req);
    const { item, merged, listId, listCreated } = await addToThisWeek(
      deps,
      hh,
      req.household.userId,
      line,
    );
    return json(merged ? 200 : 201, {
      item,
      list: await deps.lists.summaryOf(hh, listId),
      merged,
      addedQty: line.qty,
      listCreated,
    } satisfies ListItemMutationResponse);
  }

  async function updateListItem(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const id = entityId(req, 'listId');
    const { id: itemId, unit: currentUnit, text } = lineRef(req);
    const { lists } = getDeps();
    const edit = unwrap(
      parseEditItemRequest(readJsonBody(req.event), {
        allowTicked: true,
        currentUnit,
        textLine: text,
      }),
    );
    const { item, replacedItemId } = await lists.updateItem(
      hh,
      req.household.userId,
      id,
      itemId,
      edit,
    );
    const items = await lists.items(hh, id);
    const archivedRec = edit.ticked === true ? await lists.archiveIfComplete(hh, id, items) : null;
    const [rec, tw] = await Promise.all([
      archivedRec ?? lists.mustGetRecord(hh, id),
      lists.thisWeekId(hh),
    ]);
    return json(200, {
      item: items.find((i) => i.id === item.id) ?? item,
      list: lists.summary(rec, items, tw),
      archived: archivedRec !== null,
      ...(replacedItemId ? { replacedItemId } : {}),
    } satisfies ListItemUpdateResponse);
  }

  async function deleteListItem(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const id = entityId(req, 'listId');
    const itemId = lineId(req);
    const raw = req.event.queryStringParameters?.version;
    let version: number | undefined;
    if (raw !== undefined) {
      version = Number(raw);
      if (!Number.isInteger(version) || version < 1) {
        return fail.validation('version must be a positive whole number', 'version');
      }
    }
    const { lists } = getDeps();
    await lists.deleteItem(hh, id, itemId, version);
    return json(200, { list: await lists.summaryOf(hh, id) } satisfies ListItemDeleteResponse);
  }

  async function finishList(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const id = entityId(req, 'listId');
    const { lists } = getDeps();
    await lists.finish(hh, id);
    return json(200, { list: await lists.detail(hh, id) } satisfies ListArchiveResponse);
  }

  async function reopenList(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const id = entityId(req, 'listId');
    const { lists, now } = getDeps();
    await lists.reopen(hh, id, (r) => canUndoArchive(r, now()));
    return json(200, { list: await lists.detail(hh, id) } satisfies ListArchiveResponse);
  }

  async function history(req: AuthedRequest): Promise<HttpResult> {
    const params = req.event.queryStringParameters ?? {};
    let limit = HISTORY_DEFAULT_LIMIT;
    if (params.limit !== undefined) {
      limit = Number(params.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_MAX_LIMIT) {
        return fail.validation(`limit must be 1-${HISTORY_MAX_LIMIT}`, 'limit');
      }
    }
    const page = await getDeps().lists.history(hhOf(req), params.cursor || undefined, limit);
    return json(200, page satisfies HistoryResponse);
  }

  // ------------------------------------------------------------------ settings

  async function aisleView(hh: string, state?: { order: string[]; version: number }) {
    const s = state ?? (await getDeps().settings.aisleOrder(hh));
    return {
      groups: groupsInOrder(s.order),
      isDefault: isDefaultAisleOrder(s.order),
      version: s.version,
    } satisfies AisleOrderResponse;
  }

  async function getAisleOrder(req: AuthedRequest): Promise<HttpResult> {
    return json(200, await aisleView(hhOf(req)));
  }

  async function putAisleOrder(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const input = unwrap(parseAisleOrderRequest(readJsonBody(req.event)));
    const state = await getDeps().settings.setAisleOrder(hh, input.order, input.version);
    return json(200, await aisleView(hh, state));
  }

  async function resetAisleOrder(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const state = await getDeps().settings.setAisleOrder(hh, null);
    return json(200, await aisleView(hh, state));
  }

  async function getUnitOverrides(req: AuthedRequest): Promise<HttpResult> {
    return json(200, {
      overrides: await getDeps().settings.unitOverrides(hhOf(req)),
    } satisfies UnitOverridesResponse);
  }

  async function putUnitOverride(req: AuthedRequest): Promise<HttpResult> {
    const hh = hhOf(req);
    const productId = param(req, 'productId');
    if (!isValidSku(productId)) return fail.notFound();
    const unit = unwrap(parseUnitOverrideRequest(readJsonBody(req.event)));
    const { settings, resolveProduct, now } = getDeps();
    const p = (await resolveProduct(hh, productId)) ?? fail.notFound();
    const defaultUnit = p.defaultUnitType ?? p.unitType;
    if (unit === defaultUnit) {
      // Remembering the product's own unit is the same as forgetting the override.
      try {
        await settings.deleteUnitOverride(hh, productId);
      } catch {
        // Nothing to remove.
      }
      return json(200, { override: null } satisfies UnitOverrideResponse);
    }
    const override = await settings.setUnitOverride(hh, {
      productId,
      unit,
      defaultUnit,
      name: p.name,
      brand: p.brand,
      imageUrl: p.imageUrl,
      packSize: p.packSize,
      updatedAt: now().toISOString(),
    });
    return json(200, { override } satisfies UnitOverrideResponse);
  }

  async function deleteUnitOverride(req: AuthedRequest): Promise<HttpResult> {
    const productId = param(req, 'productId');
    if (!isValidSku(productId)) return fail.notFound();
    await getDeps().settings.deleteUnitOverride(hhOf(req), productId);
    return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
  }

  const r = (handler: (req: AuthedRequest) => Promise<HttpResult>) => ({
    auth: true as const,
    handler,
  });

  return {
    'GET /api/templates': r(listTemplates),
    'POST /api/templates': r(createTemplate),
    'GET /api/templates/{templateId}': r(getTemplate),
    'PATCH /api/templates/{templateId}': r(updateTemplate),
    'DELETE /api/templates/{templateId}': r(deleteTemplate),
    'POST /api/templates/{templateId}/items': r(addTemplateItem),
    'PATCH /api/templates/{templateId}/items/{itemId}': r(editTemplateItem),
    'DELETE /api/templates/{templateId}/items/{itemId}': r(deleteTemplateItem),
    'GET /api/lists': r(listLists),
    'POST /api/lists': r(createList),
    'GET /api/lists/{listId}': r(getList),
    'PATCH /api/lists/{listId}': r(updateList),
    'DELETE /api/lists/{listId}': r(deleteList),
    'POST /api/lists/{listId}/templates': r(addTemplatesToList),
    'POST /api/lists/{listId}/items': r(addListItem),
    'PATCH /api/lists/{listId}/items/{itemId}': r(updateListItem),
    'DELETE /api/lists/{listId}/items/{itemId}': r(deleteListItem),
    'POST /api/lists/{listId}/finish': r(finishList),
    'POST /api/lists/{listId}/reopen': r(reopenList),
    'GET /api/history': r(history),
    'POST /api/this-week/items': r(addThisWeekItem),
    'GET /api/settings/aisle-order': r(getAisleOrder),
    'PUT /api/settings/aisle-order': r(putAisleOrder),
    'DELETE /api/settings/aisle-order': r(resetAisleOrder),
    'GET /api/settings/unit-overrides': r(getUnitOverrides),
    'PUT /api/settings/unit-overrides/{productId}': r(putUnitOverride),
    'DELETE /api/settings/unit-overrides/{productId}': r(deleteUnitOverride),
  };
}

/** Product summaries as the household sees them (unit overrides applied, C5). */
export function withOverrides<T extends ProductSummary>(
  items: T[],
  overrides: Readonly<Record<string, { unit: ProductSummary['unitType'] }>>,
): T[] {
  return items.map((p) => applyUnitOverride(p, overrides));
}
