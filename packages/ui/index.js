export { escHtml, escAttr, escText } from './escaping.js';

// toast()/modal() are deliberately NOT extracted yet: each app's version is
// coupled to that app's own DOM structure and CSS (a shared toast container
// element, specific classnames) which differ per app today. Forcing them
// into this package now, before that DOM/CSS is also unified, would risk
// silently changing visible behavior — exactly what Phase 1 must not do.
// Revisit once each app is fully wired through Vite and its markup can be
// compared directly.

