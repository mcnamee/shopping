# Shopping list app (Trolley)

- Start here: docs/STATUS.md. Spec: docs/PRODUCT_SPEC.md. One stage per session.
- Team (.claude/agents): product-manager (opus), senior-engineer (sonnet; Opus only when the lead says so), software-engineer (sonnet), ux-designer (sonnet, only for genuinely new screen patterns), qa-tester (sonnet).
- Lean stage flow: PM writes criteria + UX notes in one pass -> build (backend + UI can be one engineer when small) -> QA report incl. release recommendation -> lead merges to main. PM re-engages only on a Fail or judgement call.
- Token rules: read only what's needed (grep DECISIONS by ID); targeted tests while building, full suite once at hand-off and once in QA; <= 3 screenshots; short agent replies; lead keeps chat updates to 1-2 lines.
- Never deploy from a session; GitHub Actions deploys on push to main.
- Australian English in UI copy.
