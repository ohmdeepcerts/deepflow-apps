# 16 — UI Documentation: `packages/ui` and Shared UI Conventions

This document covers the one genuinely shared UI code in the monorepo — `packages/ui` — plus the UI conventions (design tokens, toast/modal/confirm patterns) that are *visually* consistent across `apps/office`, `apps/engineer`, and `apps/portal` but, with one exception, are **not** shared code today.

This document narrows the scope of the old [`docs/14_UI_Documentation.md`](../14_UI_Documentation.md), which catalogues each app's own component classes (`.kpi-tile`, `.job-card`, `.hero`, etc.) and is still the right place for that per-screen inventory. Treat one claim in it as superseded: its Section 5 states no `aria-*`/focus handling was found anywhere beyond the Command Palette — that's no longer true of the Office App's `openModal()`/`closeModal()` (Section 6 below), which now does real focus-trapping and `role="dialog"`/`aria-modal` management. Whether that predates or postdates the old doc wasn't checked; either way, the current source is what matters and is what's described here.

**Methodology:** every module described below was read in full from `packages/ui/*.js`. Every claim about *where* an export is used (or not used) came from grepping the real `apps/office/*.js`, `apps/engineer/*.js`, and `apps/portal/*.js` — not from `packages/ui/README.md`'s own commentary, which documents intent at extraction time, not current call-site behavior. Where the README's history (e.g. "toast/modal deliberately not extracted") was checked against current code, it still held. Where a sibling package's README (`packages/pdf/README.md`) did *not* hold against current code, that's called out explicitly in Section 3 — this is exactly the kind of stale-doc trap the methodology is meant to catch.

---

## 1. `packages/ui` — Module Inventory

Seven files total (`ls packages/ui/`), all plain ES modules, no build step of their own — consumed via the `@ui` Vite alias (`vite.config.js:35`, `resolve(__dirname, 'packages/ui')`), which resolves to `index.js` as the barrel:

| File | Exports (via `index.js`) | What it is |
|---|---|---|
| `index.js` | re-exports everything below | Barrel file. Also carries a code comment explaining why `toast()`/`modal()` are *not* here yet (see Section 6). |
| `escaping.js` | `escHtml`, `escAttr`, `escText` | HTML-escaping helpers. Section 2. |
| `network-canvas.js` | `initNetworkCanvas` | The animated "cyan network + gold star twinkle" `<canvas>` background used behind login/lock/PIN screens. |
| `invoice-template.js` | `buildMastheadHTML` (also exports `esc`, `money`, `seededRandom`, `networkField` internally, not re-exported through `index.js`) | Builds the one raster band of the invoice/statement PDF — the masthead. |
| `pdf-vector.js` | `renderInvoicePDF` | Renders the rest of the invoice PDF as real vector text/shapes via jsPDF + jsPDF-AutoTable. |
| `pat-template.js` | `renderPatCertificatePDF`, `buildPatCertificatePages`, `certVerifyCode` | Renders a PAT (Portable Appliance Test) certificate PDF — entirely screenshot-based, ported from a standalone legacy app. |
| `README.md` | — | Package-level rationale for what was and wasn't extracted (Phase 1/5 scope notes). |

`packages/ui` depends on nothing else in `/packages` (confirmed — no internal imports across any of the six `.js` files). It's depended on by all three apps.

**`initNetworkCanvas` is not used by all three apps**, despite the shared visual language: `apps/office/main.js` and `apps/portal/hero-canvas.js` both import it; `apps/engineer` does not — it keeps its own, separate "electrical circuit" canvas (`apps/engineer/main.js:3-17`, a grid-snapped node network with jitter, drawn directly against a canvas with id `elec-bg`, not via `@ui`). This is by design (`network-canvas.js`'s own header comment says so explicitly), not an oversight.

---

## 2. HTML-Escaping Helpers

### 2.1 API shape

All three are plain string-in, string-out functions taking one arg and coercing `null`/`undefined` to `''`:

```js
escHtml(s)   // & < > " '  →  all five entity-escaped. The canonical, general-purpose escaper.
escAttr(s)   // = escHtml. A separate export name kept for call-site clarity in attribute contexts, not a different implementation.
escText(s)   // & < >  only — narrower, ported from the Client Portal's original `e()`.
```

(`packages/ui/escaping.js:14-32`.)

### 2.2 Where they're actually imported

Every app imports from `@ui`, but under different local names — worth knowing when grepping the apps yourself:

| App | Import line | Local aliases used |
|---|---|---|
| `apps/office/*.js` (10 files: `main.js`, `certs.js`, `directory.js`, `audit.js`, `backup-diagnostics.js`, `maps.js`, `statements.js`, `expenses.js`, `engineer-reports.js`) | `import { escHtml, escAttr } from '@ui'` (subset per file) | Used under their real names, `escHtml`/`escAttr`. |
| `apps/engineer/main.js` | `import { escHtml } from '@ui'` | Real name — but only imported/used, never `escAttr`/`escText`. |
| `apps/portal/*.js` (`main.js`, `certs.js`, `properties.js`, `request-wizard.js`, `invoice-pdf.js`) | `import { escText as e, escAttr as ea } from '@ui'` | Aliased to the single/double-letter names (`e`, `ea`) the Portal used pre-extraction — a deliberate zero-diff migration per `escaping.js`'s own header comment. |

Usage volume is uneven: `escHtml(` appears **124** times in `apps/office/main.js` and only **17** times in `apps/engineer/main.js`; `e(`/`ea(` appear **44** times in `apps/portal/main.js`. That gap is partly explained by `main.js` file size, but not entirely — Section 2.3 shows it's also a real coverage gap.

### 2.3 Where interpolation happens WITHOUT escaping — verified against current source

A prior session ran an XSS-focused sweep (`git log --oneline | grep -i xss` → commit `044af4f`, *"Phase 2 High: fix nav() permission-check ordering + XSS breakout sites"*, 25 Jul 2026). That commit fixed two confirmed attribute-context breakouts in the Portal (`properties.js` search box, an invoice-preview `data-id`) and two `onclick="fn('${name}')"` handler breakouts in the Office App (`timesheets.js`, `main.js`'s WhatsApp panel). It did **not** claim to be a full sweep of every interpolation site, and re-grepping the current codebase confirms the picture today is still mixed:

**Directory contrast, within one file** — `apps/office/directory.js` imports `escHtml` and uses it exactly once, for job-search results (`directory.js:423-424`). Everywhere else in the same file, the equivalent free-text fields go into `innerHTML` template literals unescaped:
```
directory.js:133   <div class="card-name">${p.name}</div>
directory.js:142   ${p.notes?`<div ...>${p.notes}</div>`:''}
directory.js:181   <div class="card-name">${a.name}</div>
directory.js:191   ${a.notes?`<div ...>${a.notes}</div>'}
directory.js:243   onclick="...document.getElementById('...').value='${agency.id}';..."> 🏢 ${agency.name}
directory.js:374   <div ...>${eng.name}</div>
```
`p.name`/`p.notes`/`a.name`/`a.notes` are Directory (`persons`/`agencies`) fields, editable via ordinary office-staff forms — free text, not system-generated.

**Same pattern, within `certs.js`** — the Property-Cert-Dashboard rows escape consistently (`certs.js:1094-1186`: `escHtml(c.address||'—')`, `escHtml(c.type)`, `escHtml(c.landlord)`), but the Certificates-tab dashboard rows three hundred lines later render the same `c.address` field raw:
```
certs.js:1287   <div class="cdash-row-addr">${c.address}</div>
certs.js:1312   <div class="cdash-row-addr">${c.address}</div>
certs.js:1334   <div class="cdash-row-addr">${c.address}</div>
```

**`toast()` itself is inconsistent across apps** — see Section 6.2: Office's `toast()` builds `innerHTML` from the raw `msg` argument with no escaping; Portal's escapes via `e(msg)`; Engineer's uses `textContent` (safe by construction, not by an escaping call). Office's `toast()` is fed interpolated Directory data at real call sites, e.g. `toast(`Landlord auto-filled: ${p.name}`,'success')` (`main.js:4641`) and `toast(`✅ ${u.name} is now ${newRole}`,'success')` (`main.js:8928`) — both pass an unescaped name straight into an `innerHTML` sink.

**Also unescaped, sampled across both non-Portal apps** (not exhaustive — `apps/office/main.js` alone has roughly 100 `${x.name}`/`${x.notes}`/`${x.address}`/`${x.desc}` interpolations; this is a representative cross-section, not a full list): `main.js:927,2585,4160,4170,7461,7472,7957,8095,8112,12833,12986,13214` (person/agency/engineer/trade names, invoice item descriptions, attachment names); `engineer/main.js:1192,1570` (attachment/user names); `engineer/guide.js:78` (`${a.desc}`); `engineer/requests.js:24` (`${r.notes}`); `credit-notes.js:65` and `main.js:7472` (both: invoice line-item `${it.desc}` inside an `oninput="invItems[${i}].desc=..."` attribute *and* as the input's `value`).

**Portal is the more consistently escaped app** — its 44 `e(`/`ea(` call sites in `main.js` and comparable density in `certs.js`/`properties.js`/`invoice-pdf.js`/`request-wizard.js` cover most of the equivalent name/notes/address fields the Portal renders. It is not perfect (that's what the `044af4f` fixes were), but the pattern is "escape by default, occasional miss" rather than Office/Engineer's "escape at the sensitive spots, raw everywhere else."

None of the above was fixed as part of writing this document — it's reported as observed, current fact for whoever owns the next security pass, per this repo's stored risk-tolerance note: concrete file:line evidence, not an abstract "you should audit this."

---

## 3. Invoice PDF Template — Vector-Based

`packages/ui/invoice-template.js` (masthead) + `packages/ui/pdf-vector.js` (`renderInvoicePDF`, everything else).

**Vector, not screenshot** — confirmed by reading `pdf-vector.js` in full. The document body (Ordered By / Site of Works columns, the item table, the total band, the payment-reference box, the footer) is drawn with jsPDF's native text/shape API (`doc.text()`, `doc.line()`, `doc.roundedRect()`, `doc.setFillColor()`) and jsPDF-AutoTable (`doc.autoTable(...)`) for the item table's own pagination (`pdf-vector.js:153-179`). That text is real, selectable, searchable PDF text — not an embedded image of text.

**One deliberate exception:** the masthead band (company name/logo, invoice number, status pill, issued/due dates) is still rendered as a raster image — built as off-screen HTML/CSS by `buildMastheadHTML()` and captured with `html2canvas` (`pdf-vector.js:90-109`), because it needs a real CSS gradient and the particle-scatter visual (`networkField()` in `invoice-template.js`, an SVG version of the same "cyan network + gold star" visual as `network-canvas.js`, but deterministically seeded from the invoice's own `id`/`number` via a seeded mulberry32 PRNG — same invoice regenerates pixel-identical, a different invoice doesn't). Compression is tuned in-code: JPEG quality 0.75 at 2.0x scale, chosen (per the file's own comment) because scale 2.5/quality 0.88 measured ~110KB for that one image alone, versus ~54KB at the current settings "with no visible quality loss."

**Why this split exists at all**, per the file's header comment: a full-page `html2canvas` screenshot of the whole invoice used to run 500KB+ per PDF; the vector-body-plus-small-raster-masthead split keeps it under 50KB, comparable to Zoho/QuickBooks.

**This template is shared across two apps, not app-specific** — both `apps/office/main.js:7224` and `apps/portal/invoice-pdf.js:153` call the exact same `renderInvoicePDF(doc, html2canvas, {inv, S, totals, vatRate})`. `apps/office/statements.js:297` additionally reuses `buildMastheadHTML()` directly (not the full `renderInvoicePDF`) for the Statements PDF's header band.

**A stale sibling doc, worth flagging:** `packages/pdf/README.md` (a different, still-empty placeholder package, `@pdf` alias) documents a Phase 4 decision to deliberately *not* unify the Office and Portal invoice PDFs, on the grounds that "comparing them directly found they're genuinely different documents, not duplicated logic." That was true when written. It no longer is: the later "Rebuild invoice PDF as vector text + small raster masthead" work (commit `0afe0cd`) *did* end up unifying both apps' invoice PDF onto one shared `renderInvoicePDF`, just inside `packages/ui` rather than the still-unpopulated `packages/pdf`. `packages/pdf/README.md` was not updated to reflect this — a real example of exactly the "don't trust old docs, verify current state" trap this document's own methodology is built around.

---

## 4. PAT Certificate PDF Template — Screenshot-Based (Deliberate Exception)

`packages/ui/pat-template.js` — `renderPatCertificatePDF`, `buildPatCertificatePages`, `certVerifyCode`. Office-only: imported solely by `apps/office/certs.js:18`; neither Engineer nor Portal import it.

**Screenshot-based, not vector** — the opposite architecture from Section 3, and the file's own header comment says so explicitly: *"ported near-verbatim from the standalone PAT-TEST app (ohmdeepcerts/PAT-TEST) so the printed certificate is unchanged: real HTML/CSS pages captured with html2canvas and assembled into a PDF with jsPDF, one page-image per `.a4` page — NOT drawn as vector text like `packages/ui/pdf-vector.js`."* Each certificate page is built as full HTML/CSS off-screen (`buildPatCertificatePages()`, using the `CSS` template string at `pat-template.js:49-69`), then captured page-by-page with `html2canvas` and added as a full-page PNG image per page (`renderPatCertificatePDF()`, `pat-template.js:182-213`).

This is called out as a **deliberate exception** to the app's usual vector-PDF approach, not an inconsistency: matching the legacy PAT-TEST app's exact pixel output was the actual requirement, and screenshotting the same CSS was judged the only reliable way to guarantee that rather than re-matching it by eye in jsPDF's vector API.

**A minor doc/code drift worth noting**, found by reading closely: the function's own JSDoc (`pat-template.js:172-181`) says html2canvas runs at *"scale 4, matching the source app"*, but the actual call three lines into the function body uses `scale: 2.5` (`pat-template.js:205`), with an inline comment right above it explaining the change — scale 4 "makes each page a huge raster image... fine for a single certificate, but a real multi-appliance multi-page one balloons past a megabyte for no visible gain over 2.5x." The inline comment is accurate and current; the higher-level JSDoc a few lines above it wasn't updated to match. Cosmetic, not a functional bug.

**Pagination math matters here in a way it doesn't for the invoice PDF:** `wrapTxt()` (`pat-template.js:18-29`) word-wraps appliance descriptions at a fixed 17-character width specifically because the source app's own row-height/pagination logic counts wrapped lines to decide what fits on a page — the wrap width has to match exactly or pages would paginate differently than PAT-TEST's.

**`certVerifyCode()`** embeds a deterministic hash of a cert's key facts (`certNum`, address, issue date, appliance count, fail count) into the PDF's `keywords` metadata field, ported verbatim from PAT-TEST's own `shortHash`/`certVerifyCode` algorithm — so a certificate migrated in from the legacy app keeps a verification code any of its old exported PDFs would already carry.

---

## 5. Design Tokens / Theme System — Not Actually Shared

There is no shared token file or shared theme package. Each app's `index.html` defines its own `:root` CSS custom properties inline, in its own `<style>` block. The token *names* overlap heavily by convention (`--acc`, `--txt3`, `--s2`, `--bg`, `--border` recur across two of the three apps) — but the values, the full token set, and the light/dark *mechanism* are all independently maintained, confirmed by reading all three `index.html` files directly:

| | Office (`apps/office/index.html`) | Engineer (`apps/engineer/index.html`) | Portal (`apps/portal/index.html`) |
|---|---|---|---|
| Token vocabulary | `--acc`, `--txt`/`--txt2`/`--txt3`, `--s1`-`--s4`, `--bg`, `--border`/`--border2`/`--border3`, `--fh`/`--fm` (heading/mono fonts), `--r`/`--r2`/`--r3` (radii), `--sh`/`--sh2` | Same family: `--acc`/`--acc2`, `--txt`/`--txt2`/`--txt3`, `--s1`-`--s4`, `--bg`, `--border`/`--border2` | **Different vocabulary entirely**: `--accent`/`--accent-light`/`--accent-dark`, `--text`/`--text-secondary`/`--text-tertiary`, `--surface`/`--surface-elevated`, `--danger`/`--warning`/`--success` (semantic names, not Office/Engineer's `--red`/`--yellow`/`--green`) |
| Default mode | Light (`body`/`body.theme-light`) | **Dark** (bare `:root`; light is the override) | Light, with an OS-driven dark override |
| Light/dark mechanism | `body.theme-light` / `body.theme-dark` classes | `[data-theme="light"]` attribute selector on `<html>` (dark is the unattributed default) | THREE layered mechanisms in one file: `@media (prefers-color-scheme: dark)`, a separate `html.dark{...}` class block, both present simultaneously |
| Toggle function | `toggleTheme()`/`setTheme()`/`applyTheme()`, `apps/office/main.js:12734-12797` | `toggleTheme()`/`_applyTheme()`, `apps/engineer/main.js:498-509` | `toggleTheme()`/`initTheme()`, `apps/portal/main.js:694-709` |
| Persistence key | `localStorage['df_theme']` | `localStorage['df_eng_theme']` | `localStorage['portal-theme']` |
| Extra behavior | Also supports a scheduled auto light/dark switch by time of day (`S.themeLightStart`/`S.themeLightEnd` settings, `main.js:8088-8090`) | None found beyond the manual toggle | Falls back to `matchMedia('(prefers-color-scheme:dark)')` only when no explicit `localStorage` preference is set yet (`main.js:695-697`) |

**Net effect:** three independent implementations of the same idea, sharing a family resemblance in naming (Office and Engineer) or none at all (Portal), each with its own storage key, its own toggle mechanism (class vs. attribute), and its own default. Nothing in `packages/ui` or elsewhere unifies this — consistent with `packages/ui/README.md`'s own statement that theming/CSS were out of scope for what's been extracted so far.

`--txt3` in both Office's light and dark themes carries a live accessibility-fix comment worth preserving here: it was changed from a lower-contrast value specifically to clear WCAG AA's 4.5:1 text-contrast threshold (`apps/office/index.html:85,115`) — a real, dated fix, not decorative.

---

## 6. Common UI Patterns — Toast, Modal, Confirm

None of these are exported from `packages/ui`. `packages/ui/index.js` says why, in its own comment: *"toast()/modal() are deliberately NOT extracted yet: each app's version is coupled to that app's own DOM structure and CSS... Forcing them into this package now... would risk silently changing visible behavior."* Confirmed still true — three independent implementations exist today, described below.

### 6.1 `toast()`

| App | Signature | Sink | Escaping |
|---|---|---|---|
| Office | `toast(msg, type='info', dur=3500)` (`main.js:967-980`) | `innerHTML` (icon span + message span) | **None** — raw `msg` interpolated directly. Dedupes identical in-flight messages by comparing a `dataset.msg` attribute before re-showing. |
| Engineer | `toast(msg, type='')` (`main.js:1732-1736`) | `textContent` | Safe by construction (not an explicit escape call — `textContent` never parses HTML). |
| Portal | `toast(msg)` (`main.js:1232-1237`) | `innerHTML` (Lucide icon + message) | `e(msg)` — escaped via the shared `escText` alias. |

All three auto-dismiss on a timer and target a single DOM element/container per page (`#toasts` in Office, `#toast` in Engineer/Portal) rather than a stacking queue.

### 6.2 Modals — `openModal`/`closeModal`

Only **Office** has a generic, reusable pair (`main.js:1042-1059`, exported): it manages real accessibility state — sets `role="dialog"`/`aria-modal="true"` if not already present, captures and restores focus (`_modalTriggerEl`) across open/close, and computes the modal's focusable elements to autofocus the first one on open (`_getFocusable()`, `main.js:1037-1039`). This is newer, more complete behavior than the old `docs/14_UI_Documentation.md` describes (see this document's intro).

**Engineer** exports a `closeModal(id)` (`main.js:1719-1722`) but no corresponding `openModal` — modals are opened by direct `classList.add('open')` calls at each call site (e.g. `main.js:1037,1469`). No focus management.

**Portal** has neither function. Overlays are opened/closed by ad hoc, screen-specific pairs instead — `openLb`/`closeLb` for the photo lightbox (`main.js:1221-1228`), plus direct `classList.add('show')`/`remove('show')` calls for the search overlay, help modal, and contact overlay (`main.js:712-765,1181-1206`). Portal's overlays use the `show` class; Office/Engineer's use `open` — not even the CSS hook name is shared.

### 6.3 Confirmation dialogs — `confirm2()`

**Only `apps/office/main.js` has this** (`confirm2(title, msg, onOk, onCancel, opts={})`, `main.js:987-1024`). It's a 3-button custom dialog (OK / Cancel / an optional third "alt" action, e.g. "Open Invoice"), built on top of `openModal`/`closeModal`, with an Escape-key safety mechanism (`_confirm2CancelFn`) specifically to prevent a Promise-based caller from hanging forever if the user dismisses via Escape instead of clicking a button — the code comment calls this out as a fix for a real "Promise deadlock," not speculative hardening. `msg` gets a specific, narrow HTML allowance: `<strong>`/`<br>` tags are preserved (converted to newlines and back) while every other tag is stripped via a `.replace(/<[^>]+>/g,'')` pass (`main.js:992`) — i.e. Office deliberately permits a tiny, fixed whitelist of formatting through `confirm2`, unlike the raw pass-through in `toast()`.

**Engineer and Portal have no equivalent.** Engineer falls back to the browser's native `confirm()` for at least one destructive action (sign-out, `main.js:677`); Portal — being read-mostly and client-facing — was not found to need a destructive-action confirmation pattern at all in the files read.

---

## See also

- [`docs/architecture/05-database.md`](../architecture/05-database.md) — schema reference this document's format follows.
- [`docs/14_UI_Documentation.md`](../14_UI_Documentation.md) — per-app component/CSS-class inventory (still current except the accessibility claim corrected in this document's intro).
- `packages/ui/README.md` — the package's own extraction-rationale notes (Phase 1/5 scope).
- `packages/pdf/README.md` — a related but stale doc; see Section 3's callout.
- `ARCHITECTURE_REDESIGN_PROPOSAL.md` — the Phase 1/4/5 extraction plan `packages/ui`'s own comments repeatedly cite.
