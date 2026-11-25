# Trolley API (Stages 2 to 5)

All routes are under `/api`, need the Cognito ID token (`Authorization: Bearer <id token>`, JWT authoriser) and are scoped to the token's household; ids from another household are 404. Never send a `householdId` (it is ignored). Types: `packages/core/src/api-types.ts`; rules: `packages/core/src/lists.ts`; server: `services/api/src/stage2.ts`; mock: `apps/web/src/api/mock-stage2.ts`; client calls: `apps/web/src/api/index.ts`.

Errors: `400 { code: 'VALIDATION', message, field? }`, `404 { code: 'NOT_FOUND' }`, `409 { code: 'CONFLICT', reason, message, current? }` with reason `STALE` (send the latest `version`; `current` is the latest row/template/summary), `LIST_ARCHIVED`, `NOT_ARCHIVED`, `LIMIT`, `UNDO_EXPIRED` (D-058), `429 { code: 'RATE_LIMITED', message }` (suggestions, D-071).

Ids: lists, templates and recipes are UUIDs. Items (list and template) are `<productId>~<unit>`, e.g. `000000000000398689~pack` (D-053); a unit change returns the new id. A list item can also be a free-text line, id `TEXT~<16 hex>` (D-103, see below).

## Templates
| Method and path | Body | Response |
|---|---|---|
| GET `/templates` | | `{ templates: TemplateSummary[] }` weekly first, then name; `preview` = first 3 names in aisle order |
| POST `/templates` | `{ name, type? }` (`weekly` default, `meal`, `regulars`: things bought now and then, reviewed per shop, never auto-added; suggestions treat it like `meal`) | 201 `Template`; 409 LIMIT at 50 |
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

### Free-text lines (Stage 5, D-103)
A `ListItem` with `kind: 'text'` (absent on product lines) is a free-text line: `product.name` is the text as written (trimmed, whitespace collapsed, <= 200 chars), `product.productId` equals the item id `TEXT~<hash>` (hash of that text, case-sensitive, so only exactly the same text merges), `product.groupId` is the chosen group (default `guessGroup(text)`, else `other`), `qty` 1, `unit` `each`, `note` e.g. "From Lamb curry", no image or brand. Shop grouping, ticking, auto-archive, the offline tick queue and the item DELETE work unchanged. Differences:
- Created only by `POST /recipes/{id}/to-list` (not by `/items` or `/items/bulk`, which reject `TEXT~` ids as unknown products). Templates never hold them (template item routes 404 a `TEXT~` id).
- `PATCH /lists/{listId}/items/{itemId}` on a text line takes `{ ticked? }` and/or `{ text?, groupId?, note?, version }` (`version` required for text/groupId/note; `qty`/`unit` are 400, and `text`/`groupId` are 400 on a product line). A new `text` re-keys the line (response has `replacedItemId`); if a line with exactly that text exists they merge (note joined D-046, unticked, response `item` is the surviving line).
- Archive writes no purchase row for them (they still count in `itemCount`/`tickedCount`); suggestions neither exclude nor use them; they are never resolved as a usual product.
- Chat/Siri: `get_current_list` prints `- "2 cups plain flour" - note "From Lamb curry"` (quoted, no quantity); `remove_item` matches their text; `/quick/list` reads the text out; `add_item` is unchanged.
- Undo (`/items/undo`): a created text line is deleted (version-checked); a merged one (`created: false`) is left as it is and reported ok (nothing to take back by quantity).

## Recipes (Stage 5)
Server: `services/api/src/recipes/`; rules, limits and the ingredient/method parsers: `packages/core/src/recipes.ts` (`parseIngredientLines`, `ingredientTexts`, `parseMethodBlocks`, `filterRecipes`), free-text and `guessGroup`: `text-lines.ts`, `ingredient-groups.ts`; mock: `apps/web/src/api/mock-stage5.ts`; client calls: `getRecipes ... addRecipeToList` in `apps/web/src/api/index.ts`, photo upload helper `uploadRecipePhoto` in `apps/web/src/api/recipePhotos.ts`. Decisions D-103 to D-107, D-111, D-112.

| Method and path | Body | Response |
|---|---|---|
| GET `/recipes?q=&category=&favourite=true` | | `{ recipes: RecipeSummary[] }` A-Z by title; summaries only (id, title, categories, yield, totalTime, thumbUrl, favourite, sourceUrl, source, updatedAt). Filters: accent/case-insensitive title substring, exact category (case-insensitive), favourites; combined |
| POST `/recipes` | `RecipeInput` | 201 `Recipe`; 400 VALIDATION naming the field; 409 LIMIT at 500 |
| GET `/recipes/{recipeId}` | | `Recipe` |
| PUT `/recipes/{recipeId}` | `RecipeInput` + `version` | `Recipe`; 409 STALE (`current` = latest). Absent text fields become empty; absent `photoKey` keeps the photo, `null` removes it, a new key replaces it (old objects deleted); absent `favourite` keeps it |
| PATCH `/recipes/{recipeId}` | `{ favourite }` | `Recipe`. No version needed and it does not bump `version` |
| DELETE `/recipes/{recipeId}` | | 204; the photo objects are deleted too |
| POST `/recipes/photo-upload` | none | `{ photoKey, full: PresignedPost, thumb: PresignedPost, expiresIn: 300 }` |
| POST `/recipes/{recipeId}/to-list` | `{ lines: string[] (1-50), listId? }` | `{ list: ListDetail, results, added, failed, listId, listCreated }` |
| POST `/recipes/{recipeId}/match` | none (uses the saved ingredients); `?refresh=1` forces a recompute | `{ rows: RecipeMatchRow[], ai: boolean, cached?: boolean, cachedAt?: string }` |
| PUT `/recipes/{recipeId}/match/choices` | `{ choices: [{ line, choice }] }` (1-100; `choice` is a productId or `"text"`) | 204 |

`RecipeInput` (all text plain; limits in `RECIPE_LIMITS`): `title` (required, <= 120), `description` (<= 2,000), `categories` (<= 10, each <= 30, trimmed, case-insensitive dedupe), `yield`, `prepTime`, `cookTime`, `totalTime` (free text, each <= 30), `ingredients` (<= 200 non-blank lines, <= 10,000 chars; `#` line = heading), `instructions` (<= 20,000; paragraphs are steps, `#` line = heading), `notes` (<= 5,000), `nutrition` (<= 1,000), `sourceUrl` (`http(s)` only, <= 2,000, or ''), `favourite?`, `source?` (`{ app: 'mela', id }`, id 1-1000 chars; absent keeps it on PUT, `null` clears it; used by Mela import, D-113), `photoKey?`. `Recipe` adds `source` (or null), `id`, `photoUrl`, `thumbUrl` (same-origin `/media/recipes/<hh>/<uuid>[-thumb].jpg`, or null), `version`, `createdAt`, `updatedAt`. Bodies up to 96 KB are accepted on recipe routes (other routes: 16 KB).

Photos (D-105, D-111): resize in the browser to <= 1600 px JPEG and a 400 px JPEG thumb, `POST /recipes/photo-upload`, then for each of `full` and `thumb` send a `multipart/form-data` POST to `post.url` with every `post.fields` entry first and the file last (`uploadRecipePhoto(upload, fullBlob, thumbBlob)` does this; in the mock it stores a data URL instead). S3 enforces key, `Content-Type: image/jpeg`, size (3 MB full, 300 KB thumb) and 5 minutes; success is 204. Then save the recipe with `photoKey: upload.photoKey`. `photoKey` must be `recipes/<your household>/<uuid>.jpg` from an upload (else 400 on `photoKey`); the thumb is `<uuid>-thumb.jpg` next to it. A failed upload leaves nothing on the recipe. Abandoned uploads are orphans (B-026); the API does not HEAD the object when saving.

`to-list`: each line is trimmed and whitespace-collapsed (blank or > 200 chars is a VALIDATION result), becomes a free-text line (group `guessGroup`, note "From {recipe title}") and is added by the merge rule (D-046). Pass only ingredient lines (`ingredientTexts(recipe.ingredients)` minus unticked ones), in chunks of <= 50; reuse the first response's `listId` for later chunks so they land together. No `listId`: this week's list, created and flagged "Week of ..." when there is none (`listCreated: true`, D-048). `results` is one per request line in order, shaped as a bulk add (`productId` = the line's `TEXT~` id, `unit` `each`; `ok: false` codes `VALIDATION`, `LIMIT` "list is full" at 200 lines). Undo: POST the ok results' `change`s to `/lists/{listId}/items/undo`. 404 for another household's recipe or list, 409 LIST_ARCHIVED for an archived `listId`.

`match` (D-115): read-only; one row per ingredient line (headings skipped), in order: `{ line, name, match, alternatives (<= 3), pantry }`. `name` is the core ingredient name (`parseIngredient`, `packages/core/src/ingredients.ts`: quantities, units, prep notes, brands dropped, e.g. "olive oil"); `pantry` marks salt, pepper, water and the like ("Probably have", unticked by the client). `match` and each alternative are `{ productId, name, imageUrl, packSize, unit, qty, source: 'template' | 'history' | 'catalogue' }`; `match` is null when there is no confident product (the line stays free text; alternatives may still be offered). Resolution is D-099's order (templates, history, catalogue excluding notAtStore/removed; removed = soft-deleted `discontinued`, D-123) but a catalogue-only match needs every core word in the product name and a clear lead (`matchIngredientName`, `ingredient-match.ts`). Default amount: template/history qty and unit, else 1 of the product's unit (remembered unit if any); recipe amounts are never converted. `ai: true` when the optional Bedrock clean-up of unsure lines (same model/Lambda as suggestions, 6 s timeout, strict JSON, falls back to the rule parser) was used. 429 `RATE_LIMITED` after 60 runs per household per day (own counter, separate from suggestions); 404 for another household's recipe. The client adds product rows with `POST /lists/{id}/items/bulk` and text rows with `to-list`. Cache (D-116): the result is stored per household + recipe (`MATCHCACHE#<id>`, TTL 30 days) keyed by a SHA-256 of the ingredients text; a hit returns `cached: true` + `cachedAt`, runs no matcher or model and does not use the daily limit; editing the ingredients changes the hash (recompute); deleting the recipe deletes the item; `?refresh=1` recomputes and counts. `PUT .../match/choices` remembers the user's per-line picks in that item (keyed by line text; only the live cache item for the current ingredients, otherwise a no-op) and they override the computed `match` on later responses (a pick among the row's own products, or `"text"` = `match: null`); they survive a refresh and are dropped when the ingredients change.

## Meal plan (Stage 6)
Server: `services/api/src/plan/`; rules, limits and week helpers: `packages/core/src/meal-plan.ts`; mock: `apps/web/src/api/mock-stage6.ts`; client: `getPlan ... deletePlanEntry` in `apps/web/src/api/index.ts`. Decisions D-117 to D-121. Dates are `YYYY-MM-DD` (Canberra). Household-scoped; another household's entry is a 404.

| Method and path | Body | Response |
|---|---|---|
| GET `/plan?from=&to=` | | `{ entries: MealPlanEntry[] }` inclusive range (<= 63 days, else 400), ordered by date, then breakfast, lunch, dinner, untimed, then `order` |
| POST `/plan` | `{ date, meal?, kind: 'recipe'\|'text', recipeId? \| text, note?, order? }` | 201 entry; 400 VALIDATION naming the field (unknown recipe = `recipeId`); 409 LIMIT at 20 entries that day. `order` defaults to last in the day |
| PATCH `/plan/{date}/{entryId}` | `{ version, text?, note? }` (`text` on text entries only; blank note clears) | entry; 409 STALE (`current` = latest) |
| POST `/plan/{date}/{entryId}/move` | `{ version, date, meal, order? }` | entry (same id, `version` + 1); 409 STALE, or LIMIT when the target day is full |
| DELETE `/plan/{date}/{entryId}` | | 204; 404 when gone |

`MealPlanEntry`: `id, date, meal ('breakfast'|'lunch'|'dinner'|null), kind, recipeId?, text?, note?, order, version, createdAt, updatedAt`. Limits in `MEAL_PLAN_LIMITS` (text 100, note 200, 20 per day). Entries are not joined to recipes: look the recipe up in `GET /recipes`; a missing recipe means "Recipe deleted". Ingredients for a week use the existing `POST /recipes/{id}/match`, `/to-list` and bulk add per recipe.

## Suggestions (Stage 3)
Engine: `packages/core/src/suggestions.ts`; AI pass and routes: `services/api/src/suggestions/`; mock: `apps/web/src/api/mock-stage2.ts`; decisions D-061 to D-074.

| Method and path | Body | Response |
|---|---|---|
| POST `/lists/{listId}/suggestions` | none | `SuggestionsResponse`. List must be active (404 / 409 LIST_ARCHIVED); products already on it, any unit, ticked or not, are excluded. Read-only |
| POST `/suggestions` | none | same, nothing excluded (New list sheet before the list exists) |
| POST `/lists/{listId}/items/bulk` | `{ items: AddItemRequest[] }` (1-50) | 200 `{ list: ListDetail, results: BulkAddItemResult[], added, failed }`, one result per item in order |
| POST `/lists/{listId}/items/undo` | `{ changes: LineChange[] }` (1-50, the ok results' `change`) | 200 `{ list, results: [{ ok, itemId, code?, message? }], undone, failed }` |

`SuggestionsResponse`: `{ source: 'ai' | 'rules', coldStart, note: string | null, suggestions: Suggestion[] }` (at most 40, in display order). `note` is the cold-start text ("Suggestions get smarter after a few shops - for now these are from your weekly template.") when `coldStart`, else null. Empty `suggestions` = "Nothing to suggest yet". `source` is informational (the UI shows no error either way).

`Suggestion`: `{ productId, snapshot: ProductSnapshot, qty, unit, note, reason, fromTemplate, fromHistory }`. `qty` is valid for `unit` (D-052); `reason` is one line of plain text (<= 90 chars, render as text): "On your weekly template", "Usually every ~4 weeks, last bought 27 days ago", or "On your weekly template - usually every ~7 days, last bought 6 days ago". `fromTemplate` = "Weekly" badge.

Rate limit: 20 runs (either suggestions route) per household per Canberra day; the 21st is 429 `RATE_LIMITED` "You've used today's suggestions - try again tomorrow." 404/409 do not use a run. The AI pass is skipped on cold start and falls back to the rules result on any failure or after 8 s (HTTP 200, `source: 'rules'`).

Adding from the review sheet: send the ticked suggestions (with any edited qty/unit) as `items` to `/items/bulk`. Each result is `{ ok: true, productId, unit, change: LineChange }` or `{ ok: false, productId, unit, code: 'VALIDATION' | 'LIMIT' | 'CONFLICT', message }`; report "Added 10 of 12" when `failed > 0`. Merged rows (`change.created: false`) are unticked. Undo: POST the ok results' `change`s to `/items/undo`; rows the other phone changed since come back `ok: false, code: 'CONFLICT'` and are left alone.

## Settings
| Method and path | Body | Response |
|---|---|---|
| GET `/settings/aisle-order` | | `{ groups, isDefault, version }` (version 0 = never saved) |
| PUT `/settings/aisle-order` | `{ order: string[15], version? }` | same; 409 STALE when `version` is old |
| DELETE `/settings/aisle-order` | | same, reset to ALDI order |
| GET `/settings/unit-overrides` | | `{ overrides: UnitOverride[] }` by name |
| PUT `/settings/unit-overrides/{productId}` | `{ unit }` | `{ override }`; choosing the product's default unit removes it (`override: null`) |
| DELETE `/settings/unit-overrides/{productId}` | | 204, 404 if none |

`GET /groups` returns the household aisle order. `GET /products/search` and `GET /products/{sku}` return `unitType` with the household override applied and `defaultUnitType` (the product's own unit). A product removed from the catalogue (D-123, `discontinued: true`) is left out of search, matching, suggestions and adds (400), but `GET /products/{sku}` still returns it with `discontinued: true`.

## Chatbot connections (Stage 4)
Decisions D-082 to D-095; server: `services/api/src/oauth/routes.ts`, `services/api/src/mcp/`; rules: `packages/core/src/assistant.ts`; mock: `apps/web/src/api/mock-stage4.ts` (request ids `mock-claude`, `mock-chatgpt`, `mock-long`); user steps: `docs/CONNECT.md`.

SPA endpoints (Cognito ID token, like the rest of `/api`):

| Method and path | Body | Response |
|---|---|---|
| GET `/oauth/requests/{requestId}` | | `OAuthRequestDetails` `{ requestId, clientName, redirectHost, expiresAt }`; 404 = link invalid, expired or already used ("This connection link isn't valid") |
| POST `/oauth/consent` | `{ requestId, allow }` | `{ redirectUrl }`: send the browser there (`window.location.assign`) for Allow and Deny alike. 404 as above; 400 bad body |
| GET `/connected-apps` | | `{ apps: ConnectedApp[], mcpUrl }` newest first. `ConnectedApp`: `{ grantId, clientName, connectedBy, connectedAt, lastUsedAt \| null }` |
| DELETE `/connected-apps/{grantId}` | | 204; 404 if not this household's. The app's next MCP call is 401 |

`clientName` is self-declared by the app (cleaned of markup, <= 60 chars): render as text. The `/connect?request=<id>` page is where `/oauth/authorize` sends the browser.

Public endpoints (not under `/api`; same origin via CloudFront, no Cognito):

| Method and path | Notes |
|---|---|
| GET `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp` | RFC 9728: `resource` = `https://<domain>/mcp`, `authorization_servers` = origin |
| GET `/.well-known/oauth-authorization-server` | RFC 8414: issuer = origin; S256 only; `authorization_code`, `refresh_token`; auth methods `none` (default), `client_secret_basic`, `client_secret_post` |
| POST `/oauth/register` | RFC 7591 JSON. `redirect_uris` 1-5, https or http loopback, no fragment. 201 `{ client_id, ... }` (+ `client_secret` only if a secret method was asked for). 20/hour per address; never-authorised clients expire after 24 h |
| GET `/oauth/authorize` | `response_type=code`, `client_id`, `redirect_uri` (exact), `code_challenge` + `code_challenge_method=S256`, optional `state`, `scope`, `resource` (must be the `/mcp` URL). Bad client/redirect: 400 HTML page. Other errors: 302 to the client with `error`. Valid: 302 to `/connect?request=<id>` (10 min) |
| POST `/oauth/token` | Form. `authorization_code` (`code`, `code_verifier`, `redirect_uri`, `client_id`) or `refresh_token` (rotates; reuse revokes the grant). Access 1 h, refresh 30 d, opaque, stored hashed. Code 5 min, single use; a replay revokes its grant |
| POST `/oauth/revoke` | RFC 7009, always 200. A refresh token revokes its whole grant; an access token just itself |
| POST `/mcp` | MCP Streamable HTTP, stateless JSON (GET/DELETE 405). Bearer access token or 401 `WWW-Authenticate: Bearer resource_metadata="https://<domain>/.well-known/oauth-protected-resource/mcp"` |

MCP tools (all on the token's household, this week's list only): `add_item { text, quantity?, unit?, note? (<= 100), productId? }` -> usual product (D-086/D-094, templates first per D-099: weekly, regulars, meal, using the template item's qty/unit/note unless given; then history, remembered unit, catalogue) added via the this-week path, or `structuredContent.options` (<= 5) and nothing added; `get_current_list {}`; `remove_item { text }` (single match only); `search_products { query }` (<= 10, bought first). 60 tool calls/min per grant, then a tool error.

## Siri & Shortcuts (personal access keys)
Decisions D-096 to D-098; server: `services/api/src/shortcuts/`; mock: `apps/web/src/api/mock-stage4.ts`; user steps: `docs/CONNECT.md` ("Siri").

SPA endpoints (Cognito ID token):

| Method and path | Body | Response |
|---|---|---|
| POST `/shortcut-keys` | `{ name }` (1-40 chars) | 201 `{ key, shortcutKey }`. `key` is `trl_` + 43 base64url chars (256-bit), returned **once**. 409 `LIMIT` at 5 keys per household; 400 bad name |
| GET `/shortcut-keys` | | `{ keys: ShortcutKey[], max }` newest first. `ShortcutKey`: `{ keyId, name, createdBy, createdAt, lastUsedAt \| null }` (last used written at most every 15 min) |
| DELETE `/shortcut-keys/{keyId}` | | 204; 404 if not this household's. The key's next call is 401 |

Public endpoints (no Cognito authoriser; the Lambda checks `Authorization: Bearer trl_...`). Every response is `{ spoken, added? }` for Siri to read; a key can only do these two things:

| Method and path | Notes |
|---|---|
| POST `/quick/add` | Body JSON `{ text, quantity? }`, a JSON string or plain text. "and", commas and "&" split items (max 8). Same resolution as MCP `add_item` (D-086/D-094/D-099): templates (spoken as "(from your Weekly template)"), history, remembered unit, clear catalogue match (not `notAtStore`), else nothing added and "I found a few - A, B or C. Try saying the one you want." No match: "I couldn't find X at ALDI." Success: "Added A and B to Week of 23 Nov." with `added: [{ name, qty, unit }]`. Empty body: 400 "I didn't catch what to add." |
| GET `/quick/list` | "You've got 12 things left: milk, eggs, ..." (unticked only, 20 names then "and N more") |

401 `{ spoken: "That Trolley key isn't valid any more." }` for a missing, malformed, unknown or revoked key. 429 (30 calls per key per minute, `Retry-After: 60`) `{ spoken: "That's a lot at once..." }`.

## Data (spec 5.1)
| Item | pk | sk |
|---|---|---|
| List | `HH#<hh>` | `LIST#<id>` (GSI2 `HH#<hh>#LISTS#<status>` / `<createdAt or completedAt>#<id>`) |
| List item | `HH#<hh>#LIST#<id>` | `ITEM#<productId>~<unit>` |
| Template | `HH#<hh>` | `TEMPLATE#<id>` (items embedded) |
| Settings | `HH#<hh>` | `SETTINGS` (aisleOrder, aisleVersion, unitOverrides map) |
| This week | `HH#<hh>` | `THISWEEK` (listId) |
| Purchase | `HH#<hh>` | `PURCHASE#<productId>#<YYYY-MM-DD>#<listId>#<unit>` |
| Suggestion runs | `HH#<hh>` | `SUGGESTRUNS#<YYYY-MM-DD>` (runs, `ttl`; D-071) |
| Connected app (grant) | `HH#<hh>` | `OAUTHGRANT#<grantId>` (D-090) |
| OAuth client | `OAUTHCLIENT#<clientId>` | `CLIENT` (`ttl` until first authorised) |
| Pending request / code / token | `OAUTHREQ#<id>` / `OAUTHCODE#<sha256>` / `OAUTHTOKEN#<sha256>` | `REQUEST` / `CODE` / `TOKEN` (`ttl`) |
| OAuth rate counter | `OAUTHRL#<REG\|MCP>#<key>` | `<window>` (`ttl`) |
