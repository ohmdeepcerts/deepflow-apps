# @ui

**Currently populated:** `escHtml`/`escAttr`/`escText` — XSS-safe HTML escaping. Confirmed (by reading all three apps' implementations directly) that index.html and engineer.html had byte-identical `escHtml` functions, and client-portal.html had two independently-written but output-equivalent narrower functions (`e`/`ea`) — see `escaping.js` for the full reasoning. Extracting these was genuinely zero-risk.

**Deliberately not yet populated:** `toast`/`modal` primitives and date/currency formatting. Toast and modal are coupled to each app's own DOM structure and CSS today, which differ per app — unifying them safely requires that DOM/CSS to be compared side by side first, which is later work, not a Phase 1 zero-risk move. Currency/date formatting is inlined at ~55+ call sites in the Office App alone rather than duplicated as a clean function — extracting it is valuable but is a Phase 5-scale change (many call sites), not a Phase 1 one.

**Depends on:** nothing else in `/packages`.
**Depended on by:** apps.
