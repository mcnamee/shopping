# Status / handoff (2026-11-23)

## Where things are
- **Stage 0**: signed off, live.
- **Stage 1** (catalogue, scraper, search UI): signed off (D-043), live.
- **Stage 2** (templates + lists + shop mode): **signed off** (D-060, `docs/stages/stage-2-qa.md` section 5). Being merged to main and deployed by GitHub Actions (new GSI2 ships with it). Paused here before Stage 3 at the user's request.
- Monthly scrape runs from GitHub (`scrape-fallback.yml`, needs `SCRAPE_FALLBACK_ENABLED=true`); AWS schedule and alarm are opt-in, default off, because ALDI blocks AWS IPs (D-042).

## Open user items
- **Stage 2 [U] first real shop** (K1/K2): checklist in `docs/stages/stage-2-qa.md` section 5 - set aisle order for Casey, build the list in under 5 min, both phones ticking the same list, archive + Undo, list in History.
- Stage 1 [U] checklist in `docs/stages/stage-1-qa.md` section 6 (images on phones, search speed, `SCRAPE_FALLBACK_ENABLED=true`, first monthly run after 1 Dec).
- Done by user (23 Nov): `trolley.mcn.am` CNAME live; store re-scrape run (populates `notAtStore`, D-080).
- Orphaned RETAIN'd resources from the first failed deploy: tidy-up script given to the user to run (their call).

## Stage 3 (AI suggestions) - in progress
- PM acceptance criteria written: `docs/stages/stage-3.md` (decisions D-061 to D-068). Next: UX spec for the review sheet, then build, QA, PM sign-off.
- Model: Amazon Nova Micro on Bedrock via the APAC cross-region inference profile, id in CDK context (D-061); no Anthropic use-case form needed. Deterministic engine works without AI (D-062).
- Inputs: Stage 2 purchase rows (`PURCHASE#`, D-054) and weekly templates.
- Re-check `npm audit` at stage start (D-044).
- Feed in anything the user notes from the first real shop.

## Housekeeping
- Actions warn Node 20 is deprecated for actions/checkout@v4, setup-node@v4, configure-aws-credentials@v4 - bump to current majors.
- Backlog: `docs/BACKLOG.md` (B-001..B-013).


## Stage 3 shipped (merged to main; verify AI source after deploy - see stage-3-qa.md [U])
- Stage 3 done so far (branch only, NOT on main): PM criteria (docs/stages/stage-3.md), UX (docs/ux/suggestions.md), backend + suggestion engine + Bedrock Nova Micro (`apac.amazon.nova-micro-v1:0`, configurable via SUGGEST_MODEL_ID; unverified id/IAM condition - wrong = silent rules fallback, check logs for `suggestions_ai_fallback`).
- Stopped: software-engineer building the suggestions review UI (any partial commits listed above this note in git log). Next: finish UI per the backend handoff in docs/api.md + D-069..D-074 -> QA -> PM sign-off -> merge to main.
- Production = Stage 2 (main 7ef192e).

## Stage 4 (Chatbot / MCP) - in progress
- PM criteria + UX notes: `docs/stages/stage-4.md` (D-082 to D-089; backlog B-014..B-017). Next: build (senior engineer owns OAuth shim) -> QA -> merge.
- Remote MCP at `https://trolley.mcn.am/mcp`, own OAuth 2.1 shim (DCR + PKCE) in Lambda, consent at SPA `/connect`, Settings > Connected apps.
- [U] after deploy: connect from Claude (custom connector) and ChatGPT (developer mode), "add tissues to my shopping list".

## Stage 4 shipped (main 6d5c7ae, deploy green 23 Nov). Awaiting user [U]: connect Claude/ChatGPT per docs/CONNECT.md. Fix applied: single API-wide Lambda permission (policy size limit).

## Stage 5 (Recipes) - criteria written (24 Nov)
- PM criteria + UX notes: `docs/stages/stage-5.md` (D-103 to D-110; backlog B-019..B-026 incl. Mela import and meal planner). Next: build (senior engineer: S3/CloudFront photos + free-text line model; UI can be one engineer) -> QA -> merge.
- New infra: private photo bucket + CloudFront `/media/*` behaviour. 5-tab nav (Recipes between Search and Templates).
