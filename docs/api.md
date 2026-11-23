# Trolley API (Stages 2 to 4)

All routes are under `/api`, need the Cognito ID token (`Authorization: Bearer <id token>`, JWT authoriser) and are scoped to the token's household; ids from another household are 404. Never send a `householdId` (it is ignored). Types: `packages/core/src/api-types.ts`; rules: `packages/core/src/lists.ts`; server: `services/api/src/stage2.ts`; mock: `apps/web/src/api/mock-stage2.ts`; client calls: `apps/web/src/api/index.ts`.

Errors: `400 { code: 'VALIDATION', message, field? }`, `404 { code: 'NOT_FOUND' }`, `409 { code: 'CONFLICT', reason, message, current? }` with reason `STALE` (send the latest `version`; `current` is the latest row/template/summary), `LIST_ARCHIVED`, `NOT_ARCHIVED`, `LIMIT`, `UNDO_EXPIRED` (D-058), `429 { code: 'RATE_LIMITED', message }` (suggestions, D-071).

Ids: lists and templates are UUIDs. Items (list and template) are `<productId>~<unit>`, e.g. `000000000000398689~pack` (D-053); a unit change returns the new id.

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

`GET /groups` returns the household aisle order. `GET /products/search` and `GET /products/{sku}` return `unitType` with the household override applied and `defaultUnitType` (the product's own unit).

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
