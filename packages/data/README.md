# @data

The `_TO_DB`/`_FROM_DB` camelCase↔snake_case field mapping and the per-table repository functions (`dGet`/`dAll`/`dPut`/`dDel`), plus Realtime subscription helpers.

This is the single most important package in the migration: today, three independently-maintained copies of this mapping are the documented root cause of real production bugs (Credit Notes; auto-invoice job-status sync — see `ARCHITECTURE_REDESIGN_PROPOSAL.md` §1.2). Once this package exists, a JS↔DB field name is declared exactly once, for all three apps.

**Depends on:** `@core`.
**Depended on by:** `@business`, apps.

Populated in Phase 2 — the highest blast-radius single change in the roadmap, done in isolation behind full data-layer integration tests.
