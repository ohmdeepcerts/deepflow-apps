# @ui

Toast/modal primitives, `escHtml` (XSS-safe escaping — present in the Office App, currently undefined anywhere in the Employee App), design tokens, and date/currency/phone formatting.

Deliberately dependency-free — no imports from `@data` or `@business` — so it can be tested and reasoned about with zero database context. A toast notification does not need to know what an invoice is.

**Depends on:** nothing else in `/packages`.
**Depended on by:** apps.

Populated in Phase 1 — the lowest-risk, first real move in the migration.
