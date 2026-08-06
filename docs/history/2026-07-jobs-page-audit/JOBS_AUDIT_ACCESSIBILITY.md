# Jobs Page Accessibility Audit — DeepFlow

**Scope:** `renderJobs()` (D:\DEEPFLOW\index.html:7110) and the job detail/edit modal `#mo-job` (D:\DEEPFLOW\index.html:4087)
**Method:** Static code read-through (no live DOM/AT testing tooling available in this environment) — findings are traced directly from markup/CSS/JS.

---

## Finding 1 — Job rows are `<div onclick>`, not real buttons/links: keyboard users cannot open a job by clicking the row

**Current Findings**
`D:\DEEPFLOW\index.html:7268`
```html
html += `<div class="jsr3" ${...} data-id="${j.id}" onclick="openJobModal('${j.id}')" oncontextmenu="showJobCtxMenu(event,'${j.id}','${j.jobNum||''}');return false;" style="cursor:pointer;position:relative">
```
The row has no `tabindex`, no `role="button"`, and no `keydown` handler anywhere in the codebase (confirmed via grep for `key==='Enter'`/`key===' '` near this markup — none exists tied to `.jsr3`).

**Problems**
The primary way a mouse user opens a job (clicking anywhere on the row) is completely unavailable to a keyboard-only user. The `<div>` is never in the natural Tab order and even if a user could somehow focus it, Enter/Space would do nothing since there's no keydown listener.

**Root Cause**
The row was built as a `<div>` styled with `cursor:pointer` and an `onclick` attribute — a common pattern in this codebase for "the whole element is clickable" — without adding the ARIA semantics (`role="button" tabindex="0"`) and keyboard handling that native interactive elements provide automatically.

**Evidence**
Grep for `onclick=` across the whole file returns 619 hits; within the ~260-line row-rendering block of `renderJobs()` (7220-7351) alone there are 9 `onclick` attributes on non-button/non-link elements (the row itself, the drag handle, the selection checkbox, three `onclick="event.stopPropagation()"` cell wrappers, the two inline quick-edit spans, and the "Add job for [date]" div at line 7356). Only the status `<select>` and the four action icons at the end of the row (`✎`, `⧉`, `📱`, and the conditional `◎` invoice button, lines 7344-7349) are real, natively focusable `<button>`/`<select>` elements.

**Impact**
A keyboard-only user browsing the Jobs list cannot open a job to view or edit it by "clicking" the row the way a mouse user does. They must instead discover and Tab all the way to the small `✎ Edit` icon-button buried at the end of each row (past a status `<select>`), which is the *only* keyboard path into the modal — there is no visual cue that this specific icon (out of 2-4 packed together) is the row's primary action. For a dense list of many rows per day, this makes browsing/opening jobs by keyboard extremely slow and non-obvious (WCAG 2.1.1 Keyboard is only partially met via a hidden workaround, not by design).

**Risk**
Low-to-moderate. Converting the outer `<div class="jsr3" onclick=...>` to `<button>` is not viable (it contains other interactive children — select, buttons — which is invalid HTML inside a `<button>`). The safer fix is additive (role/tabindex/keydown) rather than restructuring, so it shouldn't disturb the drag-and-drop (`initScrollListDrag`), multi-select (`initJobMultiSelect`), or context-menu (`showJobCtxMenu`) logic that all key off `.jsr3[data-id]` — but a keydown handler must be carefully scoped to not fire when the event originates from the `<select>`/buttons/quick-edit spans already inside the row (mirroring the existing `e.target.closest('button')||e.target.closest('select')||...` guard used in `initJobMultiSelect`, line 6909).

**Recommended Solution**
Add `role="button" tabindex="0"` to the `.jsr3` row and a `keydown` handler (in `initJobMultiSelect` or a new listener) that calls `openJobModal(id)` on `Enter`/`Space`, guarded the same way the existing click handler already guards against clicks on nested interactive children (line 6909). Also add `aria-label` summarizing the row (e.g. address + status) since the row itself has no single accessible name.

**Files affected**
D:\DEEPFLOW\index.html (renderJobs function, ~lines 7268, 6901-6937)

**Estimated difficulty**
Small-medium — one attribute addition plus one new guarded keydown handler; needs careful testing against existing drag/multi-select/context-menu interactions.

**Estimated performance gain**
N/A — usability/compliance fix. (Not a case where switching to a native `<button>` element is possible/relevant here, since the row hosts multiple nested interactive children.)

---

## Finding 2 — Job priority is conveyed by color alone; the text/icon label was silently disabled

**Current Findings**
`D:\DEEPFLOW\index.html:7226` and `:7279`
```js
const prtyPill='';  // set by priority dot toolbar (dropdown removed)
...
${prtyPill?`<span style="font-size:11px">${prtyPill}</span>`:''}
```
The row's only priority signal is the background tint + left border color set by `rowPriClass` (line 7266), driven by CSS at `D:\DEEPFLOW\index.html:1393-1400`:
```css
.jsr3.jsr-emg{background:rgba(230,95,0,.22);border-left:4px solid #e65f00}
.jsr3.jsr-urg{background:rgba(140,60,220,.20);border-left:4px solid #8c3cdc}
.jsr3.jsr-cert{background:rgba(20,170,70,.20);border-left:4px solid #14aa46}
.jsr3.jsr-repair{background:rgba(180,45,45,.24);border-left:4px solid #b42d2d}
.jsr3.jsr-normal{background:rgba(60,120,230,.16);border-left:4px solid #3c78e6}
.jsr3.jsr-low{background:#f0f0f0;border-left:4px solid var(--border2)}
```
The `JOB_COLS` column definition (`D:\DEEPFLOW\index.html:17905-17919`) confirms there is no "Priority" column at all in the visible table — `jobnum, address, desc, access, time, eng, price, referrer, sel(status), actions` — priority is not represented as text anywhere in the row.

**Problems**
`prtyPill` is hard-coded to an empty string, so the `<span>` that would have rendered a priority icon/text never appears (dead code, per the comment "dropdown removed"). Six distinct priority states (Emergency, Urgent, Certificate, Repair, Normal, Low) are distinguishable **only** by row background tint and a 4px left border hue.

**Root Cause**
A prior refactor moved priority filtering to the toolbar's color-dot picker (`.pri-dots-bar`, lines 1823-1830) and apparently removed the in-row priority pill/label without providing any replacement text indicator, leaving `prtyPill` wired up but permanently empty.

**Evidence**
`prtyPill` is set once (line 7226) and read once (line 7279); it is never reassigned, so the conditional always evaluates falsy. This is a direct WCAG 1.4.1 (Use of Color) violation: priority is "the only visual means of conveying information."

**Impact**
- Colorblind users (e.g., protanopia/deuteranopia, ~8% of men) cannot reliably distinguish Emergency (orange-red #e65f00) from Repair (dark red #b42d2d) from Urgent (purple #8c3cdc) by hue alone, especially at a 4px border width and low-alpha background tint.
- Screen reader users get **zero** indication of a job's priority when browsing the list — the stripe/tint has no text equivalent anywhere in the DOM.
- Even fully sighted users on a low-quality/grayscale display, or anyone quickly scanning a long list, loses this signal.

**Risk**
Low. This is purely additive — reinstating a small text/icon pill using data already computed in the row loop (`j.priority`, `isEmg`, `isUrg`, etc. are already destructured at lines 7260-7266). No restructuring of existing DOM/handlers required.

**Recommended Solution**
Populate `prtyPill` with a short text/icon label (e.g. `🚨 Emergency`, `🔥 Urgent`) reusing the existing `isEmg/isUrg/isCert/isRepair/isLow` booleans, and render it in the job# cell as originally intended (the markup slot at line 7279 already exists and just needs real content). At minimum, add `aria-label`/`title` to the row conveying priority as text even if a compact icon-only pill is preferred visually.

**Files affected**
D:\DEEPFLOW\index.html:7226, 7266, 7279 (renderJobs); CSS at 1393-1400

**Estimated difficulty**
Small — the plumbing already exists; only content needs to be added.

**Estimated performance gain**
N/A — usability/compliance fix.

---

## Finding 3 — Row selection checkbox and inline quick-edit fields are unlabeled, non-focusable `<div>`/`<span>` elements

**Current Findings**
Selection checkbox, `D:\DEEPFLOW\index.html:7270`:
```html
<div class="jsr-sel-check" onclick="event.stopPropagation();toggleSelRow('${j.id}',this)" style="...cursor:pointer;opacity:${isSelected?1:0};transition:opacity .15s">
```
Inline quick-edit time, `D:\DEEPFLOW\index.html:7312-7313`:
```html
<div class="jsr3-cell jsr3-cell-time" data-col="time" onclick="event.stopPropagation()" title="Click to edit time slot">
  <span onclick="quickEditTime('${j.id}','${escHtml(j.timeSlot||'')}',this)" style="cursor:text;min-width:40px;display:inline-block">${escHtml(j.timeSlot)||'—'}</span>
</div>
```
Inline quick-edit price, `D:\DEEPFLOW\index.html:7320-7321`, identical pattern calling `quickEditPrice`.

`quickEditTime`/`quickEditPrice` (`D:\DEEPFLOW\index.html:6796-6816`) both use the browser's native `prompt()` dialog to capture the new value.

**Problems**
1. The selection checkbox is a plain `<div>` with `onclick`, no `role="checkbox"`, no `tabindex`, no `aria-checked`, and — critically — its default CSS opacity is `0` (only becomes visible on `:hover` or when `.jsr-selected`, per line 1433 `.jsr3:hover .jsr-sel-check,.jsr3.jsr-selected .jsr-sel-check{opacity:1!important}`). There is no `:focus` rule making it visible, so even if it were made focusable it would still be invisible to a sighted keyboard user tabbing through.
2. The time-slot and price "quick edit" targets are `<span onclick>` elements styled with `cursor:text` to *look* like an editable field, but they are not inputs, have no `tabindex`, and no keyboard handler.

**Root Cause**
Same "div/span styled to look clickable" pattern as Finding 1, applied to what are effectively a checkbox control and two inline-edit affordances, without the semantics/focusability real form controls provide.

**Evidence**
Neither element appears in the tabindex grep results (only 3 unrelated `tabindex="-1"`/`"0"` uses exist in the whole file, none near these). `quickEditTime`/`quickEditPrice` are only ever invoked from these `onclick` attributes.

**Impact**
A keyboard-only user cannot select a row for bulk actions (no way to reach or activate the checkbox), and cannot quickly edit a job's time slot or price inline — they're forced to open the full edit modal instead, which is a functional (not just cosmetic) loss of a feature mouse users have.

**Risk**
Low-medium. The checkbox fix is additive. Converting the quick-edit spans to keyboard-operable elements is slightly riskier since they currently rely on `prompt()` (a blocking, inherently accessible native dialog) — adding `tabindex`+keydown to trigger the same `prompt()` call is low-risk and doesn't touch the underlying save logic (`_sb(...)` PATCH calls in `quickEditTime`/`quickEditPrice`).

**Recommended Solution**
- Selection checkbox: add `role="checkbox" tabindex="0" aria-checked="${isSelected}"`, a keydown handler for Space/Enter calling `toggleSelRow`, and change the opacity rule to also trigger on `:focus`/`:focus-visible`.
- Quick-edit spans: add `tabindex="0"` and a keydown handler (Enter/Space) invoking the same `quickEditTime`/`quickEditPrice` functions already wired to `onclick`.

**Files affected**
D:\DEEPFLOW\index.html:7270 (checkbox), 7312-7313 and 7320-7321 (quick edit), 6796-6816 (handler functions), CSS line 1433

**Estimated difficulty**
Small for each — additive attributes and a thin keydown wrapper reusing existing functions.

**Estimated performance gain**
N/A — usability/compliance fix.

---

## Finding 4 — Drag-to-reorder has no keyboard equivalent

**Current Findings**
`D:\DEEPFLOW\index.html:7269`
```html
<div class="jsr-drag-handle" title="Drag to reorder" draggable="true" onclick="event.stopPropagation()">⠿</div>
```
Drag logic lives in `initScrollListDrag()` (`D:\DEEPFLOW\index.html:18245` onward), driven entirely by `dragstart`/`dragover`/`drop` events.

**Problems**
Reordering jobs within a day (which sets `_sortOrder`, per the sort comment at lines 7170-7178) is only possible via HTML5 drag-and-drop with a mouse/touch pointer. The handle itself explicitly stops the row's own click/keyboard path (`event.stopPropagation()`) and is not focusable.

**Root Cause**
Native drag-and-drop (`draggable="true"`) was used without an alternative interaction path (e.g., "Move up"/"Move down" buttons or arrow-key reordering when the handle has focus).

**Evidence**
No keydown handler references `_sortOrder`, no ArrowUp/ArrowDown handling exists near the drag code (confirmed by the `key==='Tab'` grep — the only Tab-related key handling in the whole file is unrelated, for an autocomplete dropdown at line 10135).

**Impact**
A keyboard-only dispatcher/office user cannot manually reprioritize the order jobs appear within a day (e.g., to match an engineer's actual driving route) — a real workflow capability that's entirely mouse-gated.

**Risk**
Low — this would be an additive keyboard alternative (e.g. arrow keys while handle is focused, or add "Move up"/"Move down" `<button>`s), not a restructuring of the existing drag logic.

**Recommended Solution**
Make the drag handle `tabindex="0"` with `role="button" aria-label="Reorder job"`, and add a keydown handler for Arrow Up/Down that calls the same reorder-persistence code path the drag-drop handler uses (look at what `initScrollListDrag`'s `drop` handler ultimately writes to `_sortOrder`/Supabase and reuse it).

**Files affected**
D:\DEEPFLOW\index.html:7269, 18245+ (initScrollListDrag)

**Estimated difficulty**
Medium — requires extracting/reusing the persistence logic currently embedded in the drag-drop event handlers.

**Estimated performance gain**
N/A — usability/compliance fix.

---

## Finding 5 — Modal open/close does not manage focus at all; no focus trap; background content remains tabbable behind the overlay

**Current Findings**
`D:\DEEPFLOW\index.html:5914-5915`
```js
function openModal(id){document.getElementById(id).classList.add('open')}
function closeModal(id){document.getElementById(id).classList.remove('open')}
```
`openJobModal()` (`D:\DEEPFLOW\index.html:9490-9603`) calls `openModal('mo-job')` (lines 9581, 9601) but never calls `.focus()` on any element inside the modal. `closeModal('mo-job')` (e.g. line 4276, 9925) never restores focus to the element that opened it (no stored reference to the triggering row/button anywhere in `openJobModal`).

By contrast, other parts of the codebase clearly know how to do this correctly — e.g. `openCmd()` at `D:\DEEPFLOW\index.html:17322` explicitly does `document.getElementById('cmd-input').focus()` right after `openModal(...)` — showing the pattern exists but wasn't applied to `mo-job`.

No focus trap exists anywhere in the file (grep for `key==='Tab'`, `trapFocus`, `inert` returns nothing relevant to any modal).

**Problems**
1. **On open:** focus stays wherever it was (typically on the row/button that was just activated, or on `document.body` if opened programmatically), rather than moving into the modal (e.g. to the first field, `#jf-addr`, line 4120). A screen reader user gets no announcement that a dialog just opened over the page.
2. **On close:** focus is not returned anywhere — it's simply wherever it happened to be, which for a screen-reader/keyboard user is disorienting after ~20 form fields were just visible.
3. **No focus trap:** the overlay (`.overlay`, CSS line 309-313) is a `position:fixed` layer with a semi-transparent, blurred backdrop — but the actual page content behind it is untouched in the DOM (no `inert`, no `aria-hidden="true"`, no `display:none`). Because `#sidebar` (`D:\DEEPFLOW\index.html:1621`) appears **earlier** in the DOM than `#mo-job` (`D:\DEEPFLOW\index.html:4087`), pressing **Shift+Tab** from the very first modal field (`#jf-addr`) moves focus backward into the Jobs page toolbar/list and the sidebar nav — all of which are visually obscured under the modal's dark blurred backdrop (`z-index:1000`). The user's focus becomes effectively invisible while they keep tabbing through hidden background controls.

**Root Cause**
`openModal`/`closeModal` are minimal, generic `classList` togglers shared by every modal in the app (there's no per-modal focus-management wrapper), and the overlay pattern relies purely on visual stacking (`z-index`/backdrop-filter) rather than removing background content from the accessibility tree/tab order.

**Evidence**
`.overlay{display:none;position:fixed;inset:0;background:rgba(10,22,40,.6);z-index:1000;...backdrop-filter:blur(10px)...}` (line 309) — confirms the backdrop is purely a visual effect layered on top; DOM order (sidebar line 1621 < mo-job line 4087) confirms Shift+Tab escape is real, not hypothetical.

**Impact**
- A keyboard-only user opening a job for editing has no indication (visually or via screen reader) that a modal appeared, beyond visual observation.
- A keyboard user can Tab (Shift+Tab specifically) straight out of the "New/Edit Job" form into background page elements they cannot see (they're under the blurred overlay), potentially triggering unrelated actions (e.g., accidentally activating a sidebar nav link or another job row's edit button) while believing they're still inside the modal — a serious disorientation and potential data-loss risk if they've partially filled the form.
- Screen reader users navigating by landmarks/headings after closing the modal land wherever focus last happened to be (often `<body>`), forcing them to re-locate their place in a 20+ row list from scratch.

**Risk**
Medium. Adding focus-on-open / focus-restore-on-close to `openModal`/`closeModal` is low-risk since those functions are simple and centralized (a fix here would improve every modal in the app, not just `mo-job`, which is good but also means it should be tested broadly, not just on Jobs). Adding a genuine focus trap (Tab-cycling keydown handler scoped to `.overlay.open`) is a bit more involved because it must correctly identify focusable descendants that update dynamically (the job modal's photo panel, cert chips, and dropdowns are populated asynchronously after open).

**Recommended Solution**
- In `openModal(id)`: store `document.activeElement` in a variable/data attribute before opening; after adding the `open` class, move focus to the modal's first focusable field (or the modal container itself with `tabindex="-1"` + a heading focus, then let Tab proceed naturally).
- In `closeModal(id)`: restore focus to the previously stored trigger element (fall back to a sensible default like the search box if that element no longer exists, e.g. after a row was deleted).
- Add `role="dialog" aria-modal="true" aria-labelledby="mo-job-title"` to `#mo-job` (currently absent — see Finding 6).
- Add a scoped `keydown` (Tab) handler active only while `.overlay.open` exists, cycling focus between the first and last focusable descendants of the open overlay.

**Files affected**
D:\DEEPFLOW\index.html:5914-5915 (openModal/closeModal — shared by all modals), 9490-9603 (openJobModal), 4087 (mo-job overlay), 4276/9925/11778 (closeModal('mo-job') call sites)

**Estimated difficulty**
Medium — touches a shared utility used by every modal in the app, so requires regression-testing across all overlays, not just Jobs.

**Estimated performance gain**
N/A — usability/compliance fix.

---

## Finding 6 — Modal has no ARIA dialog semantics; icon-only buttons rely on `title`/emoji glyph only, not `aria-label`

**Current Findings**
`D:\DEEPFLOW\index.html:4087-4089`
```html
<div class="overlay" id="mo-job">
<div class="modal" style="max-width:1120px;padding:24px 28px 24px;position:relative">
  <div class="modal-title" id="mo-job-title">📋 New Job</div>
```
No `role`, `aria-modal`, or `aria-labelledby` anywhere on the overlay/modal. Action buttons in the row, e.g. `D:\DEEPFLOW\index.html:7347-7349`:
```html
<button class="jsr-btn" title="Edit" onclick="openJobModal('${j.id}')">✎</button>
<button class="jsr-btn" title="Copy to next day" onclick="copyJobToNextDay('${j.id}')">⧉</button>
<button class="jsr-btn" title="WhatsApp" onclick="waSingleJobById('${j.id}')">📱</button>
```
No `aria-label` on any of these; a grep of the entire file for `aria-label`/`role="dialog"`/`aria-modal` returns zero relevant hits (the only "role" matches in the file are the app's user-permission `role` field, e.g. Admin/Manager — unrelated to ARIA).

**Problems**
The dialog isn't announced as a dialog by assistive technology (no `role="dialog"`/`aria-modal="true"`), and it has no programmatic association with its visible title (`aria-labelledby="mo-job-title"` is absent). The icon-only action buttons have a text node (the emoji glyph itself, e.g. "✎") as their accessible name by default, with `title` only supplementing it — emoji glyphs are inconsistently/poorly announced by different screen readers (e.g. "pencil" vs. no description at all), and `title` tooltips are not reliably exposed to touch/keyboard users the way `aria-label` is.

**Root Cause**
The whole app (not just Jobs) has zero ARIA usage — this is a systemic pattern, not a one-off oversight in the Jobs page.

**Evidence**
Full-file grep for `role=`, `aria-label`, `aria-modal`, `aria-hidden`, `role="dialog"` returns no ARIA-role matches (all "role" hits are the unrelated user-permission field).

**Impact**
Screen reader users get no "dialog opened" announcement, no reliable title readout when the modal appears, and ambiguous or missing labels on every icon-only action button in the list (Edit/Copy/WhatsApp/Create-invoice), forcing them to guess what a bare glyph does.

**Risk**
Low. Purely additive attributes (`role`, `aria-modal`, `aria-labelledby`, `aria-label`) — no markup restructuring, no risk to existing `onclick` logic.

**Recommended Solution**
Add `role="dialog" aria-modal="true" aria-labelledby="mo-job-title"` to `#mo-job`. Add explicit `aria-label="Edit job"`, `aria-label="Copy to next day"`, `aria-label="Send WhatsApp"`, `aria-label="Create invoice"` to the four action buttons (redundant with, but more reliable than, the existing `title`).

**Files affected**
D:\DEEPFLOW\index.html:4087-4089 (modal), 7344-7349 (action buttons)

**Estimated difficulty**
Small — attribute-only change.

**Estimated performance gain**
N/A — usability/compliance fix.

---

## Finding 7 — Status `<select>` per row has no accessible label distinguishing which job it belongs to

**Current Findings**
`D:\DEEPFLOW\index.html:7194`
```js
const statusSel = (jid,s) => `<select class="jsr-sel" onchange="quickStatus('${jid}',this.value)" onclick="event.stopPropagation()">${['Pending','In Progress','Completed','Invoiced','Cannot Access','Cancelled'].map(st=>`<option ${s===st?'selected':''}>${st}</option>`).join('')}</select>`;
```
used at `D:\DEEPFLOW\index.html:7334`. No `aria-label`, no associated `<label>`.

**Problems**
Every row in the list renders an identical, unlabeled `<select>`. Its current value is announced (e.g. "Pending, combo box"), which is good — status *is* conveyed as text here, unlike priority (Finding 2) — but a screen reader user tabbing through a long list of these hears "Pending, combo box… In Progress, combo box…" with no indication of which job/address each one belongs to.

**Root Cause**
The dropdown was generated generically for compactness without a per-row accessible name.

**Evidence**
`statusSel` takes only `jid` and `s` (current status) as parameters — no address/job-number text is threaded through to build a label.

**Impact**
A screen reader user cannot efficiently tell which job's status they're about to change without first navigating back to read the address cell (itself a non-labeled `<div>`), increasing the chance of changing the wrong job's status.

**Risk**
Low — additive `aria-label` built from data already available in the row loop (`j.address`, `j.jobNum`).

**Recommended Solution**
Add `aria-label="Status for job ${escHtml(j.jobNum||j.address||'')}"` to the generated `<select>` in `statusSel`.

**Files affected**
D:\DEEPFLOW\index.html:7194, 7334

**Estimated difficulty**
Trivial — one template string edit.

**Estimated performance gain**
N/A — usability/compliance fix.

---

## Finding 8 — Priority filter dots in the toolbar are unlabeled, non-keyboard-operable color swatches

**Current Findings**
`D:\DEEPFLOW\index.html:1823-1830`
```html
<div class="pri-dots" id="pri-dots-bar">
  <div class="pri-dot pri-dot-cert" title="Certificate" onclick="handlePriDotClick('Certificate')" data-pri="Certificate"></div>
  <div class="pri-dot pri-dot-repair" title="Repair" onclick="handlePriDotClick('Repair')" data-pri="Repair"></div>
  <div class="pri-dot pri-dot-urg" title="Urgent" onclick="handlePriDotClick('Urgent')" data-pri="Urgent"></div>
  <div class="pri-dot pri-dot-emg" title="Emergency" onclick="handlePriDotClick('Emergency')" data-pri="Emergency"></div>
  <div class="pri-dot pri-dot-norm" title="Normal" onclick="handlePriDotClick('Normal')" data-pri="Normal"></div>
  <button class="btn btn-ghost btn-sm" onclick="setPriFilter('')" ...>✕</button>
</div>
```
CSS, `D:\DEEPFLOW\index.html:1413-1420`:
```css
.pri-dot{width:16px;height:16px;border-radius:50%;cursor:pointer;...}
.pri-dot-cert{background:#22c55e}
.pri-dot-repair{background:#e05252}
.pri-dot-urg{background:#a855f7}
.pri-dot-emg{background:#f97316}
.pri-dot-norm{background:#4f8fff}
```

**Problems**
Five filter toggles are plain `<div>`s with `onclick` — not focusable, not keyboard-activatable (same anti-pattern as Finding 1), distinguished from each other **only by hue** (green/red/purple/orange/blue circles of identical size and shape, `title` text only visible on mouse hover). The one adjacent real `<button>` ("✕" clear filter) highlights the inconsistency — the developer clearly had `<button>` available and chose `<div>` for the colored dots specifically.

**Root Cause**
Same div+onclick shortcut pattern used throughout the codebase for "small clickable UI chrome," compounded here by color being the *only* differentiator between five otherwise-identical circles.

**Evidence**
`.pri-dot-repair{background:#e05252}` (a red) vs `.pri-dot-emg{background:#f97316}` (an orange) — for a user with protanopia/deuteranopia these two are one of the harder color pairs to distinguish reliably at small size (16px).

**Impact**
Keyboard-only users cannot filter the Jobs list by priority at all via this control. Colorblind users must rely on hover tooltips (which also don't work via keyboard) to distinguish which dot is which.

**Risk**
Low — additive fix, five small elements, no dependency on other rendering logic beyond `handlePriDotClick`.

**Recommended Solution**
Convert each `.pri-dot` to a real `<button aria-label="Filter: Certificate">` (etc.), retaining the visual circle via CSS on the button. Optionally add a distinguishing icon/letter inside each dot for colorblind users in addition to hue.

**Files affected**
D:\DEEPFLOW\index.html:1823-1830 (markup), 1413-1420 (CSS)

**Estimated difficulty**
Small.

**Estimated performance gain**
N/A — usability/compliance fix. (Minor tangential note: five real `<button>` elements here would be no more expensive than the current five `<div>`s with manual click handlers — not a meaningful perf difference either way at this scale.)

---

## Finding 9 — `--txt3` gray fails WCAG AA contrast and is used pervasively for real (non-decorative) text

**Current Findings**
Variable definition, `D:\DEEPFLOW\index.html:84` (light theme, the default): `--txt3:#94a3b8;` against a background of `--s1`/`--s2`/`--bg` which are all near-white (`#ffffff` / `#f4f6f9`, lines 74-78).

Representative live usages in the Jobs list:
- `D:\DEEPFLOW\index.html:1339` — `.jsg-hd-count{font-size:10px;color:var(--txt3);...}` (the "N jobs · N done" count under every date header)
- `D:\DEEPFLOW\index.html:1370` — `.jsr-btn{...color:var(--txt3)...}` (default/unhovered color of every icon-only action button — Edit/Copy/WhatsApp/Invoice)
- `D:\DEEPFLOW\index.html:7286` — `<em style="color:var(--txt3);font-size:10px;...">No address</em>`
- `D:\DEEPFLOW\index.html:7296` / `7330` — `<span style="color:var(--txt3);font-size:10px">—</span>` (empty-cell placeholders for Access/Referrer)
- `D:\DEEPFLOW\index.html:1421` — `.pri-dot-txt{font-size:9px;color:var(--txt3);...}`

**Problems**
`#94a3b8` on a white/near-white background computes to a contrast ratio of **≈2.56:1**. WCAG AA requires 4.5:1 for normal-size text (all the usages above are 9-10px, well under the 18px/14px-bold "large text" threshold that would allow 3:1). This fails AA by a wide margin.

**Root Cause**
`--txt3` was clearly chosen as a "muted/tertiary" gray for de-emphasis, but it's being applied to text that carries real information (job counts, empty-state placeholders, and — critically — the *default* color of every icon action button before hover), not purely decorative chrome.

**Evidence**
Contrast math (WCAG relative-luminance formula): `#94a3b8` → relative luminance ≈0.360; white (`#ffffff`) → luminance 1.0 → ratio = (1.0+0.05)/(0.360+0.05) ≈ **2.56:1** (needs 4.5:1 for normal text). This is a visually risky combination flagged directly from the CSS variable values, not from a live contrast-checker tool.

**Impact**
Low-vision users (and anyone in bright ambient light, e.g. a van/site office with a laptop) will struggle to read job counts under date headers, "No address"/"—" placeholders, and — most importantly — will have difficulty even *seeing* the Edit/Copy/WhatsApp icon buttons before hovering, since `.jsr-btn`'s resting color is this same low-contrast gray (it only becomes readable on `:hover`, which a keyboard/touch user may never trigger).

**Risk**
Low — this is a CSS variable/value change, not a markup restructuring, so it carries no risk to rendering logic or event handlers. The main risk is purely visual: darkening `--txt3` slightly changes the app's overall "muted" aesthetic in many other non-Jobs places too (this variable is used file-wide), so a global change should be visually reviewed, not just Jobs-page-tested.

**Recommended Solution**
Darken `--txt3` for light theme to something like `#64748b` or `#5b6b80` (verify ≥4.5:1 against `#ffffff`/`#f4f6f9`) or, for the specific case of `.jsr-btn`'s resting state (an interactive control, not static text — WCAG 1.4.11 Non-text Contrast requires only 3:1 for UI components/icons, which `#94a3b8` also fails at 2.56:1), bump it to at least a 3:1-compliant tone.

**Files affected**
D:\DEEPFLOW\index.html:84 (and :114 for dark theme, which should be independently checked), plus all consumers listed above

**Estimated difficulty**
Small (variable value change) but requires visual QA across the whole app since `--txt3` is a shared global token.

**Estimated performance gain**
N/A — usability/compliance fix.

---

## Finding 10 (minor/latent) — Cert-type and status "chip" colors would also fail contrast if reactivated

**Current Findings**
`D:\DEEPFLOW\index.html:1361` — `.jsr-chip-cert{background:rgba(20,184,166,.12);color:#14b8a6}` (teal-on-near-white ≈**2.2:1**, computed from the RGBA values), and similarly `.jsr-chip-pend`, `.jsr-chip-time`, `.jsr-chip-done`, `.jsr-chip-inv`, `.jsr-chip-emg`, `.jsr-chip-urg` (lines 1359-1366), all following the same "saturated color at ~12-15% background alpha, same saturated color at full opacity for text" pattern.

**Problems**
These chip styles are defined in CSS and their construction code still exists in `renderJobs()` (`certPills` at line 7225, `statusCls`/`statusLabel` at lines 7227-7228) but — verified via grep — **none of these three variables (`certPills`, `statusCls`, `statusLabel`) are actually inserted into the row's HTML template anywhere in the current code.** They are dead/unused variables computed every render and then discarded.

**Root Cause**
Leftover code from a previous row design (a "3-line job row" comment at line 1386 suggests the layout was simplified at some point, and status/cert chips were dropped from the row but their JS/CSS were never cleaned up).

**Evidence**
`certPills` appears exactly once, at its own declaration (line 7225) — never read again. Same for `statusCls`/`statusLabel` (declared 7227-7228, never read in `renderJobs`, though `statusLabel` name is reused unrelatedly elsewhere in the file for portal requests, lines 15662/15705).

**Impact**
Currently none (dead code isn't rendered, so no user is affected today). Flagging this because if a future engineer "reactivates" these chips (the code being present makes that a tempting quick change), they would reintroduce a ~2.2:1 contrast failure identical in spirit to Finding 9.

**Risk**
N/A currently (not live). If reactivated without also fixing the color values, same low risk profile as Finding 9 (CSS-only).

**Recommended Solution**
No action required for current behavior. If/when this dead code is revived, fix the chip text colors to ≥4.5:1 against their tinted backgrounds at the same time (e.g. darken each chip's text color, not just adjust background alpha).

**Files affected**
D:\DEEPFLOW\index.html:1358-1366 (CSS), 7225, 7227-7228 (dead JS in renderJobs)

**Estimated difficulty**
N/A (informational — dead code, not a live defect)

**Estimated performance gain**
N/A — informational note, not a live user-facing issue today.

---

## Summary of tab-order / positive-`tabindex` check (per brief)

No positive (`tabindex > 0`) values exist anywhere in the file (confirmed via grep — the only `tabindex` usages are `tabindex="-1"` on a password-visibility toggle and an autofill dropdown item, and one `tabindex="0"` on an unrelated command-palette item). So the classic "positive tabindex breaks natural order" anti-pattern is **not** present. However, the tab order is still effectively broken in a different way: because almost every visually-interactive element in a job row is a non-focusable `<div>`/`<span>` (Findings 1, 3, 4, 8), the *only* stops a keyboard user actually lands on per row are the status `<select>` and 2-4 trailing icon buttons — meaning focus silently "skips" the address, description, access, time, and price cells entirely, jumping from one row's status dropdown straight to the next row's status dropdown. This isn't a reordering problem (DOM order is preserved) but an *omission* problem — most of the row's visible reading order has no focusable representation at all.

---

## Priority ranking for remediation

1. **Finding 5** (focus management / no focus trap) — highest risk: keyboard users can tab into invisible background content while a form is open.
2. **Finding 1** (row not keyboard-operable) — blocks the core "open a job" workflow for keyboard users.
3. **Finding 2** (priority = color only) — clear WCAG 1.4.1 failure with real screen-reader/colorblind impact, and a cheap fix since the code path already exists.
4. **Finding 9** (`--txt3` contrast) — affects legibility app-wide, cheap CSS-only fix.
5. **Findings 3, 4, 6, 7, 8** — meaningful but narrower-scope gaps (bulk-select, inline quick-edit, drag reorder, ARIA labeling, priority filter dots).
6. **Finding 10** — informational only (dead code), no user impact today.
