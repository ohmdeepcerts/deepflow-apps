# tests

- `unit/` — pure business-rule tests (`@business`), no database needed. Populated first, in Phase 3, per `ARCHITECTURE_REDESIGN_PROPOSAL.md` Part 4.
- `integration/` — data-layer round-trip tests (`@data`) against a real database. Populated in Phase 2, ahead of the field-mapping unification it exists to protect.
- `e2e/` — Playwright, critical workflows end to end. The regression baseline captured in Phase 0, before any file moves, and re-run unchanged at the end of every subsequent phase.
