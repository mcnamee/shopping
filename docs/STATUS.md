# Status / handoff (2026-11-22)

## Where things are
- **Stage 0**: signed off, live.
- **Stage 1** (catalogue, scraper, search UI): **signed off** (D-043, `docs/stages/stage-1-qa.md` section 6). Live in production; user signed in; catalogue seeded by the GitHub runner scrape.
- Monthly scrape runs from GitHub (`scrape-fallback.yml`, needs `SCRAPE_FALLBACK_ENABLED=true`); AWS schedule and alarm are opt-in, default off, because ALDI blocks AWS IPs (D-042).

## Open user items
- [U] checklist in `docs/stages/stage-1-qa.md` section 6 (images on phones, search speed, `SCRAPE_FALLBACK_ENABLED=true`, first monthly run after 1 Dec).
- `trolley.mcn.am` CNAME not resolving yet - user's DNS provider side (`trolley` -> CloudFront domain).
- Low priority: orphaned RETAIN'd resources (user pool, table, bucket) from the first failed deploy may exist; check the console and delete if unused.

## Next: Stage 2 (templates + lists)
- Acceptance criteria written: `docs/stages/stage-2.md` (D-046 to D-051). Next: UX spec, then build.
- Stage 2 needs household-settings work: the per-product unit override (B-004, "Remember unit" in the quantity modal) and the household aisle/group order (group editing replaces the fixed `GET /api/groups` defaults).
- Replace the Stage 1 "lists arrive in Stage 2" toast and "Templates arrive in Stage 2" message (D-026).
- Re-check `npm audit` at stage start (D-044).

## Housekeeping
- Actions warn Node 20 is deprecated for actions/checkout@v4, setup-node@v4, configure-aws-credentials@v4 - bump to current majors.
- Backlog: `docs/BACKLOG.md` (B-001..B-005).
