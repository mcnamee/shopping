# Stage 4 QA - Chatbot (MCP) and OAuth shim

Date 2026-11-23, branch claude/elegant-ride-dzzdob. Method: full suite once plus a code review of oauth/, mcp/, infra and the Connect page against the security checklist. No product code changed, no tests added (existing coverage hits every checklist item).

## Suite
| Check | Result |
|---|---|
| lint (eslint + prettier) | Pass |
| typecheck (all workspaces) | Pass |
| unit tests: core 207, api 185, 70 (mock/other), web 301, infra 47 | Pass (web did not flake this run) |
| build, synth | Pass |
| `npm audit --omit=dev` | Pass (0 vulnerabilities) |
| e2e (iphone-13) | 122 pass, 2 fail on first run (D-1); both pass on isolated rerun (7/7 connect specs) |

## Criteria
| Id | Result | Notes |
|---|---|---|
| A1 transport, CloudFront routes | Pass | Stateless; `/mcp`, `/oauth/*`, `/.well-known/*` use the API behaviour (CachingDisabled, AllViewerExceptHostHeader, no function association); no distribution-level error rewrite to the SPA (CDK assertion + template read) |
| A2 hosting | Pass | Routes of the existing API Lambda (D-090), no new resources |
| A3 tools/annotations | Pass | Covered by mcp.test |
| B1 metadata | Pass | S256 only, auth method `none` plus secret methods (D-092) |
| B2 401 + WWW-Authenticate | Pass | `resource_metadata` points to path-suffixed URL; bare path also served (D-093) |
| B3 DCR | Pass | https or loopback only; `javascript:`/`data:`, fragments, userinfo, >5 URIs rejected; 20/h per IP + 200/h global; 24 h client TTL |
| B4 authorize | Pass | Unknown client / unmatched redirect -> HTML 400, never a redirect; `plain` rejected; resource checked; duplicate params rejected; errors only redirect to a registered URI |
| B5 consent | Pass | Household from JWT; request single use; state and iss echoed |
| B6 token | Pass | PKCE S256 constant-time, exact redirect, client binding, code single-use + 5 min expiry, replay revokes grant, refresh rotation + reuse revokes grant (transactional); hashed at rest; 256-bit |
| B7 revoke | Pass | Always 200, refresh revokes grant, access deletes token |
| B8 logging | Pass | Test asserts no token/code/verifier/state in logs |
| C1-C6 tools | Pass | Covered by tests (resolution, ambiguity, merge, remove-on-single-match) |
| C7 household isolation | Pass | Every tool tested for cross-household; connected-apps list and disconnect keyed by JWT household (oauth.test line 464); hostile product name returned verbatim |
| C8/C9 rate limit, errors | Pass | 61st call is a tool error; conditional counter row |
| D1-D3 Connect screen | Pass | clientName rendered as React text (no innerHTML in web src); server also strips markup; redirect URL is server-built from a registered URI |
| E1-E2 Connected apps | Pass | Mocked e2e covers empty, connect, disconnect |
| F1 full flow | Pass | oauth.test token flow + mcp tests |
| F2 audit | Pass | |
| F3-F6 | Deferred | [U], see below |

## Defects
| Id | Severity | Description |
|---|---|---|
| D-1 | Low (test flake) | `apps/web/e2e/connect.e2e.ts` "Allow..." and "Deny..." failed once under full-suite load, pass alone. `captureRedirect` returns `got` synchronously right after the click, so it races the route fulfilment. Fix: poll with `expect.poll` or await a promise. Not a product bug. The web unit-test flake did not recur, so it is unidentified. |
| D-2 | Low | `/oauth/authorize` and `/oauth/token` have no rate limit (only DCR does). Anyone with a client id can write pending-request rows (10 min TTL) at API Gateway's default throttle. Cost/abuse risk is small at 2 users; consider a per-IP counter later. |
| D-3 | Info | CORS is `*` on OAuth/metadata endpoints (no cookies, bearer only: acceptable) and absent on `/mcp` (fine for server-side connectors; browser-based inspectors would be blocked). |

## Known unverifieds (need a real deploy)
- API Gateway accepting `/.well-known/...` route keys: synth passes, runtime acceptance unverified.
- `X-Forwarded-For`: code takes the last entry not equal to the source IP, which is correct if CloudFront appends the viewer address (the policy forwards the header). If it were wrong, all registrations share one 20/h bucket; failure is safe (over-limiting), not bypassable by a spoofed header.

## Release recommendation
Ship. No blocking defects; security checklist passes on code review and tests. Merge, let Actions deploy, then run the [U] checks before relying on it.

[U] checklist
- [ ] `curl -i https://trolley.mcn.am/.well-known/oauth-protected-resource/mcp` returns JSON (not HTML); `curl -i -X POST https://trolley.mcn.am/mcp` returns 401 with `WWW-Authenticate`.
- [ ] Claude: Settings > Connectors > Add custom connector `https://trolley.mcn.am/mcp`, sign in, Allow. Say "add tissues to my shopping list"; check this week's list on the phone (F3).
- [ ] ChatGPT developer mode connector (OAuth): same prompt, "what's on my shopping list?", "remove tissues" (F4).
- [ ] An ambiguous item (e.g. "chips") makes the chatbot ask; nothing is added until you pick (F5).
- [ ] Settings > Connected apps lists both; Disconnect one, then its next request asks you to reconnect (F6).
