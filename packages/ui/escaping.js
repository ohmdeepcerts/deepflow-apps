// HTML-escaping helpers. `escHtml` is the canonical, shared implementation —
// confirmed byte-for-byte identical between index.html and engineer.html
// before this extraction. client-portal.html independently implemented two
// narrower functions (`e` for text-node contexts, `ea` for attribute
// contexts); `escAttr` below is confirmed to produce identical output to its
// `ea` (same five characters escaped, only the .replace() call order
// differs, which cannot change the result since none of the replacement
// strings introduce characters a later step would re-match). `escText` is
// kept separate — client-portal's narrower `e` only escapes &, <, > — rather
// than silently widening it to `escHtml`, so this extraction changes nothing
// observable, per the Phase 1 zero-risk rule in
// ARCHITECTURE_REDESIGN_PROPOSAL.md.

export function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Alias — attribute-context escaping is identical output to escHtml (see
// module doc above). Kept as a distinctly-named export so client-portal's
// call sites can migrate without renaming their intent away.
export const escAttr = escHtml;

// client-portal's narrower text-node escaping — deliberately not merged
// into escHtml (see module doc above).
export function escText(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
