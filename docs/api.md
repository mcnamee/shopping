# Trolley API (Stage 2)

All routes are under `/api`, need the Cognito ID token (`Authorization: Bearer <id token>`, JWT authoriser) and are scoped to the token's household; ids from another household are 404. Never send a `householdId` (it is ignored). Types: `packages/core/src/api-types.ts`; rules: `packages/core/src/lists.ts`; server: `services/api/src/stage2.ts`; mock: `apps/web/src/api/mock-stage2.ts`; client calls: `apps/web/src/api/index.ts`.

Errors: `400 { code: 'VALIDATION', message, field? }`, `404 { code: 'NOT_FOUND' }`, `409 { code: 'CONFLICT', reason, message, current? }` with reason `STALE` (send the latest `version`; `current` is the latest row/template/summary), `LIST_ARCHIVED`, `NOT_ARCHIVED`, `LIMIT`, `UNDO_EXPIRED` (D-058).

Ids: lists and templates are UUIDs. Items (list and template) are `<productId>~<unit>`, e.g. `000000000000398689~pack` (D-053); a unit change returns the new id.

## Templates
| Method and path | Body | Response |
|---|---|---|
| GET `/templates` | | `{ templates: TemplateSummary[] }` weekly first, then name; `preview` = first 3 names in aisle order |
| POST `/templates` | `{ name, type? }` (`weekly` default, `meal`) | 201 `Template`; 409 LIMIT at 50 |
| GET `/templates/{templateId}` | | `Template` (items in aisle order, then name) |
| PATCH `/templates/{templateId}` | `{ name?, type?, version }` (template version) | `Template`; 409 STALE |
| DELETE `/templates/{templateId}` | | 204 |
| POST `/templates/{templateId}/items` | `{ productId, qty, unit, note? }` | 201 new / 200 merged: `{ template, item, merged }`; 409 LIMIT at 100 items |
| PATCH `/templates/{templateId}/items/{itemId}` | `{ qty?, unit?, note?, version }` (item version) | `{ template, item, merged }`; 409 STALE |
| DELETE `/templates/{templateId}/items/{itemId}` | | `{ template }` (Undo = POST the item again) |

## Lists
| Method and path | Body | Response |
|---|---|---|
| GET `/lists` | | `{ lists: ListSummary[] }` active only, this week first, then newest |
| POST `/lists` | `{ name?, templateIds?, thisWeek? }` | 201 `{ list: ListDetail, combined }`. Name defaults to "Week of 23 Nov". `thisWeek` true flags it, false never, omitted flags it only if no active list is flagged. 409 LIMIT at 10 active lists |
| GET `/lists/{listId}` | | `ListDetail` (active or archived; items unsorted, group with `groupForShop`) |
| PATCH `/lists/{listId}` | `{ name?, version? (required with name), thisWeek? }` | `ListSummary`; 409 STALE / LIST_ARCHIVED |
| DELETE `/lists/{listId}` | | 204 (active only; items deleted too) |
| POST `/lists/{listId}/templates` | `{ templateIds }` | `{ list, added, combined, changes: LineChange[] }` (Undo: DELETE created rows, PATCH merged rows to `qty - addedQty`) |
| POST `/lists/{listId}/items` | `{ productId, qty, unit, note? }` | 201 new / 200 merged: `{ item, list, merged, addedQty }`; 409 LIMIT at 200 |
| POST `/this-week/items` | same | as above plus `listCreated`; creates and flags "Week of" when none is flagged (C2) |
| PATCH `/lists/{listId}/items/{itemId}` | `{ ticked? }` and/or `{ qty?, unit?, note?, version }` | `{ item, list, archived, replacedItemId? }`. `archived: true` = this tick completed the list (show Undo) |
| DELETE `/lists/{listId}/items/{itemId}?version=` | | `{ list }`; version optional (409 STALE if given and old) |
| POST `/lists/{listId}/finish` | | `{ list: ListDetail }` archived with unticked items as not bought |
| POST `/lists/{listId}/reopen` | | `{ list: ListDetail }` Undo an archive within 2 min (D-055); purchase rows removed |
| GET `/history?cursor=&limit=` | | `{ lists: ListSummary[], nextCursor }` archived, newest completed first; limit 1-50 (20) |

`ListSummary`: id, name, status, thisWeek, itemCount, tickedCount (archived: bought), createdAt, updatedAt, completedAt, finishedBy (`auto`/`finish`), version. `ListItem`: id, listId, product snapshot (productId, name, brand, imageUrl, packSize, groupId, unitType), qty, unit, note, ticked, tickedAt, version, createdAt, updatedAt, updatedBy.

## Settings
| Method and path | Body | Response |
|---|---|---|
| GET `/settings/aisle-order` | | `{ groups, isDefault, version }` (version 0 = never saved) |
| PUT `/settings/aisle-order` | `{ order: string[15], version? }` | same; 409 STALE when `version` is old |
| DELETE `/settings/aisle-order` | | same, reset to ALDI order |
| GET `/settings/unit-overrides` | | `{ overrides: UnitOverride[] }` by name |
| PUT `/settings/unit-overrides/{productId}` | `{ unit }` | `{ override }`; choosing the product's default unit removes it (`override: null`) |
| DELETE `/settings/unit-overrides/{productId}` | | 204, 404 if none |

`GET /groups` returns the household aisle order. `GET /products/search` and `GET /products/{sku}` return `unitType` with the household override applied and `defaultUnitType` (the product's own unit).

## Data (spec 5.1)
| Item | pk | sk |
|---|---|---|
| List | `HH#<hh>` | `LIST#<id>` (GSI2 `HH#<hh>#LISTS#<status>` / `<createdAt or completedAt>#<id>`) |
| List item | `HH#<hh>#LIST#<id>` | `ITEM#<productId>~<unit>` |
| Template | `HH#<hh>` | `TEMPLATE#<id>` (items embedded) |
| Settings | `HH#<hh>` | `SETTINGS` (aisleOrder, aisleVersion, unitOverrides map) |
| This week | `HH#<hh>` | `THISWEEK` (listId) |
| Purchase | `HH#<hh>` | `PURCHASE#<productId>#<YYYY-MM-DD>#<listId>#<unit>` |
