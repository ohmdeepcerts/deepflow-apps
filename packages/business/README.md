# @business

Domain rules: the `STATUS` enum and other constants, invoice numbering (landlord vs. agency series), auto-invoice eligibility, VAT/total calculation, status-transition rules, permission *rules* (as opposed to `@auth`'s checking primitives).

Deliberately separated from `@data`: `@data` knows field names, `@business` knows what "Draft" or "Urgent" *means*. That separation is what makes this package unit-testable with no live database — see Part 4 of `ARCHITECTURE_REDESIGN_PROPOSAL.md`.

**Depends on:** `@core`, `@data`.
**Depended on by:** apps.

Populated in Phase 3, with unit tests written first against the extracted functions — proving today's actual behaviour, not fixing it. This phase relocates logic; it does not change it.
