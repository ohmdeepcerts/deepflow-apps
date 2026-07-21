# @pdf

**Investigated for Phase 4, deliberately left unpopulated.** The Office App's `downloadInvPDFById()` and Client Portal's `downloadInvPDF()` both generate an invoice PDF via jsPDF, but comparing them directly found they're genuinely different documents, not duplicated logic: different accent colours, the Office App includes a logo/company-registration-number/website that Client Portal's never had, and dozens of small layout differences accumulated as each evolved separately. Merging them would be a real, visible design change to at least one app's PDF output — a product decision, not a safe "relocate, don't change" extraction (see `ARCHITECTURE_REDESIGN_PROPOSAL.md` Part 5 / Phase 4).

The one truly-identical piece (a 4-line `safeText` word-wrap helper) is too small on its own to justify a shared package, and depends on a jsPDF `doc` instance as a closure variable in both — extracting just that would add an indirection layer for near-zero benefit.

**Not currently planned for this package:** if the two invoice PDFs are ever deliberately redesigned to look the same (a design decision, not a refactor), that's when this package gets populated — not before.

**Also found while investigating this:** the Office App's PDF generator had four stray debug `console.log` calls dumping invoice internals on every download, and a similar block on every invoice save — removed as an unrelated small fix, not part of this extraction.
