# Stage 3 QA report - suggestions (engine, Bedrock Nova Micro pass, bulk/undo, review sheet)

Date 2026-11-22, branch claude/elegant-ride-dzzdob. Criteria: `docs/stages/stage-3.md`; decisions D-061 to D-074.

## Gates (run once)
- lint + prettier, typecheck, build, `cdk synth`: pass.
- Unit/integration: core 182, api 147, web 283, infra 44, others 57: all pass.
- Playwright (390 px, 111 specs): 111 pass. Note: the default browser build (chromium-1255) is not installed in this sandbox; run with `PW_CHROMIUM_PATH` pointing at the installed 1243 headless shell. Environment only, not a product issue.
- `npm audit`: same 3 moderate dev-only advisories (glob/minimatch) as D-044; unchanged, still accepted.

## Criteria
| ID | Result | Evidence |
|---|---|---|
| A1-A6 engine, cold start, empty state | Pass | core tests; routes tests (cold start note, no AI call, empty state) |
| B1 model id from CDK context, IAM scoped | Pass | infra tests: invoke-only on the profile ARN plus foundation-model ARN gated by `bedrock:InferenceProfileArn`; no wildcards, no streaming, `none` grants nothing, only the API role |
| B2 compact prompt, no identifiers | Pass | ai.test (no ids, notes, list names, emails) |
| B3 injection / invented products | Pass | name passed as JSON string with `<`/`>` escaped (cannot close the block); invented and duplicate keys dropped; model cannot remove candidates |
| B4 qty 0.5x-2x, reason plain text <= 90 | Pass | ai.test |
| B5 fallback, 200 + `source:'rules'`, no product data in logs | Pass | routes tests: error, throttle, invalid JSON, timeout with abort; log asserted free of product names |
| B6 token caps | Pass | maxTokens 1000; 40 long-name candidates under budget (test) |
| C1/C2 read-only, isolation, 404/409 | Pass | other household list is 404 and its history unused; archived is 409 |
| C3 rate limit | Pass | 20/day then 429 with spec message; resets next day; racing phones: one wins; 404/409 cost nothing |
| C4 latency | Pass | timeout path < 1 s at 30 ms budget (same code path as 8 s); rules path fast on a year of data |
| Bulk add / undo (D4, D-072) | Pass | merge, per-item failures, LIMIT at 200, undo reverts; changed row returns CONFLICT and the other phone wins |
| D1-D8 review sheet, mock seams | Pass | suggestions.e2e (axe, tap targets, no h-scroll, add, undo, cancel), SuggestSheet unit tests |
| E1-E3 quality | Pass | all gates above; no fixed-cost resources added |
| F1-F2 | Deferred | [U] with real data |

## Defects
- D-1 (Low, copy only): partial-add toast reads "Added 10 of 12 - 2 couldn't be added. Try again", but the sheet has closed and the toast has no action, so "Try again" has nowhere to go. Repro: bulk add where an item fails (see SuggestSheet.test.tsx line ~212). Suggest "Added 10 of 12 - 2 couldn't be added. Open Suggest items to retry." or "Add them from search". Does not block release.
- No Critical/High/Medium defects found.

## Risks not provable in session
- Bedrock was only ever stubbed. The model id `apac.amazon.nova-micro-v1:0`, the Converse request shape and the IAM condition key `bedrock:InferenceProfileArn` are unverified against the real service (D-069..D-074). The failure mode is safe: the user silently gets rules results (`source: 'rules'`), so a wrong id or IAM would go unnoticed without the check below.
- Sandbox: Nova Micro availability/region routing for the account is unknown.

## Release recommendation
Ship (merge to main, let Actions deploy). All [S] criteria pass; one low copy nit.
[U] checklist after deploy:
- [ ] Confirm the AI is really used: the suggestions response `source` must be `'ai'` (browser devtools network tab, "Suggest items" on a list with 3+ archived shops). If it is `'rules'`, check CloudWatch for `suggestions_ai_fallback`; `reason: 'error', error: 'AccessDeniedException'` means the model id or the IAM condition key is wrong (D-069..D-074 were unverified). Fix via `SUGGEST_MODEL_ID`/`suggestModelId`.
- [ ] F1: after 3+ real shops, a new week's list gets weekly items plus a sensible periodic item with a believable reason, nothing already on the list.
- [ ] Add the suggestions, then Undo; quantities revert. Cold-start note and 429 message look right on the phone.
- [ ] F2: Cost Explorer shows Bedrock < $0.10 after the first month.
