# Backlog

Small items deferred from signed-off stages. Highest priority first. Pull into a stage when it touches the same area.

| # | Priority | Item | Origin | Why deferred |
|---|---|---|---|---|
| B-001 | Medium | Splash shows "Try again" when session restore fails only because of the network (today it falls back to sign-in, so an offline cold start looks like being signed out). | Stage 0 engineer gap | Tokens are kept; signing in again works. Do with Stage 5 offline/shop mode, or earlier if users hit it in store. |
| B-002 | Low | Return to the deep-linked page after sign-in should include `/settings` (currently excluded, lands on Lists). | Stage 0 engineer gap | One extra tap; rare path. |
| B-003 | Low | Set-new-password: distinct message when the new password equals the temporary password (today a generic error). | Stage 0 engineer gap | Happens once per user, at first sign-in. |
| B-004 | Medium | Quantity modal: "Remember {unit} for this product" checkbox (household unit override, spec 3.2, docs/ux/quantity-modal.md section 4). Hidden in Stage 1; the pure quantity logic is already in `packages/core/src/quantity.ts`. | Stage 1 UI | Needs the Stage 2 household settings store to persist the override. Build with Stage 2 lists (see the TODO in `apps/web/src/search/QuantityModal.tsx`). |
