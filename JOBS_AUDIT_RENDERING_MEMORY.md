# DeepFlow — Jobs Page: DOM Size & Memory Audit

**Scope:** DOM node footprint per render, listener lifecycle across repeated `renderJobs()` calls, detached-node/leak patterns, and memory growth under realistic use (repeated filtering/searching, job-modal open/close, scrolling). Static code review of `D:\DEEPFLOW\index.html` only — no code modified.

**Data-scale note:** A fresh, read-only REST check against the live `jobs` table (via the anon key embedded in `index.html`, project `dzqyqpuhxdrrpipbehpk`) returned `Content-Range: */0` — **0 rows** at time of check. Other reports on this task force cite 7. This is a small live business whose job count is fluctuating in single digits, not a stable large dataset — treat it as "effectively empty" for this pass. This matters: **Finding 1 below reproduces identically regardless of row count**, because it's driven by how many times `renderJobs()` has run in a session, not how many jobs exist. The DOM-size findings (2–3) are real today but invisible at 0–7 rows; they're the mechanism that will cause pain once real job history accumulates.

---

## Finding 1 — `#jobs-list-scroll` accumulates five duplicate drag-and-drop listeners on every single `renderJobs()` call, forever, for the life of the tab

**Current Findings**

`renderJobs()` ends its DOM-write phase like this (`index.html:7362-7368`):
```js
hideTip();
scroll._dragInited = false; // Reset drag init flag — innerHTML wipe removes all listeners, must re-attach
scroll.innerHTML = html;
renderJobsHeader();
applyColTemplate();
initScrollListDrag();
initJobMultiSelect();
```
`initScrollListDrag()` (`index.html:18245-18249`) guards itself like this:
```js
function initScrollListDrag(){
  const scroll=document.getElementById('jobs-list-scroll');
  if(!scroll) return;
  if(scroll._dragInited) return;
  scroll._dragInited=true;
  ...
  scroll.addEventListener('dragstart', e=>{...});
  scroll.addEventListener('dragover', e=>{...});
  scroll.addEventListener('dragleave', e=>{...});
  scroll.addEventListener('drop', async e=>{...});
  scroll.addEventListener('dragend', ()=>{...});
```

**Problems**

`#jobs-list-scroll` (`index.html:1889`) is a **static node written once in the page's original HTML markup** — it is never removed or recreated. `scroll.innerHTML = html` only destroys and replaces its *children* (the `.jsr3` row `div`s); it does not touch `scroll` itself, and it does **not** remove listeners bound directly to `scroll`. The comment on line 7362 ("innerHTML wipe removes all listeners, must re-attach") is simply incorrect for listeners bound to the container being wiped — only listeners on the discarded children are actually gone.

Because line 7362 force-resets the guard flag immediately before `initScrollListDrag()` is called again on the same render pass, the `if(scroll._dragInited) return;` guard never once fires after the very first render. Every subsequent `renderJobs()` call adds five more `dragstart`/`dragover`/`dragleave`/`drop`/`dragend` listeners to the same permanent node, on top of every previous set, with no matching `removeEventListener` anywhere in the file.

**Root Cause**

A misunderstanding of what `innerHTML` assignment actually detaches: it clears descendants, not the element whose `.innerHTML` is being set. The "reset the flag so we re-init" pattern is copy-appropriate for state that lives *only* in the DOM subtree being replaced (e.g., `_tipBound` flags on cells, which correctly disappear with their cells) but is actively harmful when applied to a guard for listeners bound to the *container itself*, which survives.

**Evidence**

Direct contrast within the same file proves this is an isolated mistake, not a systemic pattern: `initJobMultiSelect()` (`index.html:6901-6904`) uses the identical guard idiom on the same `scroll` node (`scroll._msInited`), but **nothing in the file ever resets `_msInited`** (confirmed — it's set exactly twice, both at these two lines, no other occurrence of `_msInited` anywhere). Click-selection delegation is therefore correctly attached exactly once for the container's lifetime. `initScrollListDrag`'s guard is the only one of the two that gets sabotaged by an explicit reset.

**Impact**

This is a real, currently-active bug, **completely independent of job row count** — it fires identically whether the table holds 0 rows or 100,000. Every `renderJobs()` call is triggered by: every debounced search keystroke, every engineer/status filter change, every priority-dot click, every date-range button, every day-shift arrow key, every drag-drop completion (which itself calls `renderJobs()`, compounding), every Realtime `INSERT`/`DELETE`/big-`UPDATE` event, and every tab-refocus (`visibilitychange`). In a normal working session where office staff repeatedly search/filter/switch days on the Jobs screen, this can easily reach 50–300+ `renderJobs()` calls, meaning `#jobs-list-scroll` ends the session carrying 250–1,500+ duplicate listeners.

Consequences, in order of how they'd actually be felt:
- **Correctness bug, not just perf**: a *single* drop event now fires the `drop` handler N times in a row (once per accumulated duplicate). Each invocation re-runs the reorder/move logic — recomputing `sortOrder`, calling `renderJobs()` again, and firing `PATCH` requests to Supabase — N times for one physical drop. This can produce duplicate/racing writes, redundant toast messages, and visibly "stuck"/janky drag behavior — a very close match to the owner's "gets stuck… inconsistent behaviour."
- **Escalating jank during any drag**: `dragover` fires on effectively every pointer-move while dragging; with N accumulated handlers each doing its own (independently-scoped, since `_rafPending`/`_lastHovered` are `let`-scoped fresh per invocation) rAF-guarded DOM read/write (auto-scroll zone checks, `getBoundingClientRect()`, class/style writes), N handlers run per pointer-move. This is the kind of cumulative-session slowdown that exactly matches "occasionally becomes slow… inconsistent" — it gets worse the longer the tab has been open and the more the user has interacted with Jobs, then resets to normal on a page reload, which is a classic signature of a listener leak rather than a data-volume problem.
- Pure memory growth is present but secondary here — each closure captures the enclosing scope (`_scrollZoneUp`, `_dragIndicator` references, etc.); duplicated hundreds of times, this is measurable but not the dominant cost. The dominant cost is the **N-times re-execution on every event**, not the listener objects' byte size.

**Risk**

Low-to-moderate to fix. The fix is entirely local to `initScrollListDrag()`/`renderJobs()` and does not touch Supabase sync logic, other pages, or shared state — it only touches how the guard flag is (not) reset. The one thing to be careful of: some of the drag-drop internal state (`_dropTargetRow`, `_rafPending`, etc.) is currently `let`-scoped inside `initScrollListDrag()`'s closure specifically *because* the function was (wrongly) assumed to re-run every render; once it genuinely only runs once, verify no other code path depends on that per-render re-initialization of those closure variables (a scan of the function body suggests it doesn't — all mutable state is self-contained and reset via `_clearDragState()`).

**Recommended Solution**

Delete line 7362 (`scroll._dragInited = false;`) entirely — `initScrollListDrag()`'s own internal guard is sufficient and correct on its own, exactly as `initJobMultiSelect()`'s already is. No other change needed. (If there's ever a genuine reason to intentionally re-bind — e.g., the node really was recreated — call `scroll.replaceWith(scroll.cloneNode(false))`-style replacement, or explicitly track and `removeEventListener` the specific handler references before re-adding, rather than relying on a boolean flag that doesn't match the DOM's actual lifecycle.)

**Files affected:** `D:\DEEPFLOW\index.html` (single-line deletion at line 7362; no other file touches this code path — `engineer.html` and `client-portal.html` do not implement job-list drag-drop).

**Estimated difficulty:** Low (one line to remove; the guard mechanism that makes it safe already exists and is proven correct by the sibling function).

**Estimated performance gain:** High, and unusually for this audit, **this is a today problem, not a scale problem** — fixing it improves drag-and-drop responsiveness and eliminates a real duplicate-write correctness risk *right now*, at the current near-zero row count, in any session where the user has interacted with Jobs a non-trivial number of times before attempting a drag. This is the single highest-confidence "why does it get stuck" finding in this pass.

---

## Finding 2 — Tooltip listeners are correctly non-duplicating, but the mechanism relies on the entire row subtree being destroyed and rebuilt every render, not on delegation — real, repeated attachment cost on every keystroke

**Current Findings**

`attachJobTooltips()` (`index.html:19997-20068`) is called via `setTimeout(attachJobTooltips,100)` at the end of every `renderJobs()` (`index.html:7372`). It does:
```js
document.querySelectorAll('.jsr3[data-id]').forEach(row=>{
  const addrCell=row.querySelector('.jsr3-cell-addr');
  if(addrCell&&!addrCell._tipBound){
    addrCell._tipBound=true;
    addrCell.addEventListener('mouseenter', async ()=>{ ... });
    addrCell.addEventListener('mouseleave', ()=>{ ... });
  }
  // ...same pattern for .jsr3-cell-desc and .jsr3-cell-eng
});
```

**Problems**

Unlike Finding 1, this one is *not* a leak in the technical sense — the `_tipBound` guard is an expando property stored **on the cell element itself**, and because `scroll.innerHTML = html` genuinely does destroy and recreate every row/cell on every render, the old cells (and their bound listeners) are legitimately garbage-collected together, and the new cells legitimately start with `_tipBound` unset. No accumulation occurs here.

The real cost is different: because there is no virtualization and no incremental patching for a full re-render, **every** `renderJobs()` call — including every 200ms-debounced search keystroke — throws away and recreates every row's DOM subtree, which means `attachJobTooltips()` must re-do all of its `querySelectorAll` + `addEventListener` work from scratch every time: 3 cells × 2 listeners = 6 `addEventListener` calls per row, per render. It's also scoped to `document.querySelectorAll(...)` rather than `scroll.querySelectorAll(...)` — a full-document query instead of one scoped to the list container.

**Root Cause**

This app has no partial/incremental DOM patching for search/filter changes (only the Realtime `UPDATE` path has that, via `updateRowInPlace`). Any change that goes through the normal `renderJobs()` path — which is *every* user-initiated interaction — pays full teardown-and-rebuild cost, and tooltip binding is downstream of that.

**Evidence**

`document.querySelectorAll('.jsr3[data-id]')` in `attachJobTooltips` (`index.html:19998`) — full-document scope, not `scroll.querySelectorAll(...)`.

**Impact**

At 0–7 rows this is unmeasurable (a handful of listener attachments, sub-millisecond). At the scale the business owner is asking for ("hundreds of thousands eventually," realistically low thousands first), this becomes real, synchronous main-thread work on every keystroke: thousands of `addEventListener` calls 100ms after every debounced render, plus the `querySelectorAll` traversal itself. Combined with Finding 3 (no virtualization), this is squarely a "search feels laggy once the table has real history" mechanism, not a "why does it lag today" one.

**Risk**

Low to fix in isolation (scope the query to `scroll`), but the deeper fix (avoid rebuilding rows that didn't change) is more invasive — it would need `renderJobs()` to diff old vs. new job lists and only touch changed/added/removed rows, which is a meaningfully larger refactor touching the core render function used everywhere jobs are displayed.

**Recommended Solution**
- **Cheap, low-risk win now**: scope `attachJobTooltips`'s query to `scroll.querySelectorAll(...)` instead of `document.querySelectorAll(...)`.
- **Structural fix for scale (see Finding 3)**: move to incremental row patching (or virtualization) so most renders don't recreate rows that didn't change, which would make this whole finding moot — tooltip binding would only need to run for genuinely new/changed rows.

**Files affected:** `D:\DEEPFLOW\index.html` (`attachJobTooltips`, `renderJobs`).

**Estimated difficulty:** Low for the query-scoping tweak; High for the underlying incremental-render fix (shared with Finding 3).

**Estimated performance gain:** Low today; meaningful only once job counts grow — this is explicitly a future-scale finding, not a current-pain one.

---

## Finding 3 — No windowing/virtualization: every `renderJobs()` call tears down and rebuilds ~37–40 DOM nodes per row, for every matching job, unconditionally — and the default view has no row cap

**Current Findings**

`renderJobs()` builds one large HTML string via nested `.forEach()`/template-literal concatenation over every job that survives the current filters, then does a single `scroll.innerHTML = html` (`index.html:7196-7363`). There is no offscreen-row recycling, no `IntersectionObserver`-based lazy mount, no fixed-height virtual list — every row that matches the current filter is created in the DOM at once.

Counting the row template directly (`index.html:7268-7351`), a typical fully-populated row (job number, address, description, assigned engineer, price, status dropdown, action buttons) produces:
- 1 row `div`, 1 drag-handle `div`, 2 selection-checkbox `div`s, 1 priority-stripe `div`, 1 optional engineer-color `div` = **6 structural divs**
- 10 data-cell `div`s (one per column)
- the status-dropdown cell alone contributes **1 `<select>` + 6 `<option>`** elements
- the actions cell contributes **up to 5 `jsr-act-slot` divs** plus **2–4 `<button>`s**
- assorted `<span>`s for job-number badge, time text, engineer name+colour-dot, price text, SLA badge (up to 6 more)

**Total: roughly 37–40 DOM elements per fully-populated row**, before counting the per-date-group header (`.jsg-hd` + `.jsg-rows` wrapper, 2 more nodes per date present in the result set).

The default filter state on first load is `_jRange='all'` (`index.html:5973`) with no status/engineer/priority filter applied — meaning **the unfiltered, un-searched default view renders every single job in the table**, grouped by date, with no cap.

**Problems**

This is architecturally the "will freeze once the business has real history" mechanism the mission brief anticipated. A jobs table with, say, 3,000 real historical rows (a plausible few-years-of-operation number for a small electrical compliance company) viewed with no filter would synchronously create on the order of 3,000 × ~40 ≈ **120,000 DOM nodes** in one `innerHTML` assignment, every time any filter/search/drag/Realtime event calls `renderJobs()`.

**Root Cause**

No build tooling and no framework means no virtual-DOM diffing exists anywhere in the app; the standard pattern throughout `index.html` is "rebuild the whole list from scratch." The Jobs list is the single most row-count-sensitive screen in the app because, unlike most other lists, it has no pagination and its default filter (`'all'`) doesn't bound the result set at all.

**Evidence**
```js
let _jRange='all', ...              // index.html:5973 — default is "no range limit"
let jobs = allJobs;                  // index.html:7140 — starts from the FULL table
if(search){ jobs = jobs.filter(...) }
else if(_jRange==='7'||_jRange==='30'||_jRange==='past'){ ... }
// no default case narrows 'all' at all — 'all' truly means all
```

**Impact**

Currently invisible (0–7 rows ⇒ 0–7 × 40 ≈ under 300 nodes, trivial). This is explicitly a **forward-looking finding** — it is the direct DOM-size analogue of the mission's stated goal ("hundreds of thousands of rows eventually… currently a few hundred to a few thousand"). Once the live table crosses roughly the low-thousands mark, this single mechanism (full synchronous rebuild of ~40 nodes × every matching row, on every keystroke) becomes the dominant cause of freezing during search/filter/scroll, and it will degrade gradually and non-obviously as the table grows — no single commit "breaks" it, it just gets slower every month the business keeps operating.

**Risk**

High to fix properly. Virtualization (rendering only the rows currently within/near the visible scroll viewport) is a substantial rewrite of `renderJobs()`, `applyColTemplate()`, the drag-drop reorder logic (which currently assumes every row for a date is in the live DOM, e.g. `_getDateGroup`, the full-group `Object.values(_jobRowData).filter(...)` reorder math), and the tooltip-attach logic — all of which currently assume "every filtered job has a corresponding DOM row at all times." This is not an isolated function; it's the load-bearing rendering path for the whole page.

**Recommended Solution**
- **Nearer-term, lower-risk mitigation**: default `_jRange` to something bounded (e.g., `'30'`) instead of `'all'`, and/or enforce a hard cap (e.g., render only the first N matching jobs with a "show more" affordance) before investing in full virtualization — this alone prevents the worst case (unbounded "all jobs, no filter" render) without touching the row-template or drag-drop internals.
- **Structural fix**: adopt a windowed-list technique — render only rows within a scroll buffer (e.g., visible range ± a few screens), using the existing per-date grouping as natural virtualization boundaries (collapse/lazy-mount whole date groups that are off-screen, which is a smaller, more tractable change than full per-row virtualization given the current group-based structure).

**Files affected:** `D:\DEEPFLOW\index.html` (`renderJobs`, `applyColTemplate`, `initScrollListDrag`, `attachJobTooltips`, and the `_jRange` default).

**Estimated difficulty:** Low for the "cap the default view" mitigation; High for true virtualization.

**Estimated performance gain:** Low/none today (dataset is empty); this is the single most important thing to have in place *before* the business's real data volume grows into the range the owner is explicitly asking to support — honestly framed as future-scale insurance, not a fix for the currently-reported freezing.

---

## Finding 4 — Two independent, full in-memory copies of the jobs table are kept alive simultaneously (`_jobCache` and `_jobRowData`), with different lifecycles

**Current Findings**

`_jobCache` (`index.html:5960`, TTL-based, `_getJobs()`/`_invalidateJobCache()`) is the primary cache used by `renderJobs()` to avoid re-fetching from Supabase on every render. Separately, `_jobRowData` (`index.html:6686`, a plain object keyed by job id, comment: *"Used by drag-drop so it NEVER depends on `_jobCache` (which poll can nullify mid-drag)"*) is repopulated from the **entire unfiltered** `allJobs` array on every `renderJobs()` call:
```js
if(allJobs) allJobs.forEach(j=>{ _jobRowData[j.id]=j; });   // index.html:7168
```

**Problems**

This is a deliberate, commented design decision (to make drag-drop resilient to the poll nulling `_jobCache` mid-drag), not an accident — but the consequence is two structurally-identical full copies of every job object held in memory at once, updated by different code paths (`_invalidateJobCache()` nulls `_jobCache` wholesale in ~15 places; `_jobRowData` is only ever pruned by explicit Realtime `DELETE` events at `index.html:18796`, `delete _jobRowData[id]`, and otherwise only ever grows or gets overwritten in place — it has no TTL and no wholesale clear).

**Root Cause**

The two caches were built to solve different problems at different times (general read caching vs. drag-drop robustness against poll-induced nulling) and were never unified. Nothing currently caps or evicts `_jobRowData`.

**Evidence:** `index.html:6683-6687` (declaration + comment), `18783/18797/18816-18818` (Realtime handlers touching both stores independently, in the same function, for the same event).

**Impact**

At 0–7 rows, both structures are trivially small — this is not a source of any currently-perceptible slowdown. At real scale, this simply means the jobs-related memory footprint of the tab is roughly double what a single cache would need, and — more importantly for long session health — `_jobRowData` is the one structure in this audit that has no eviction path at all tied to the *current filtered view*: it retains every job the user has ever had loaded via `allJobs` for as long as the tab stays open, only shrinking on explicit delete events from other users/devices via Realtime.

**Risk**

Moderate. `_jobRowData` is explicitly relied upon by the drag-drop reorder math (`Object.values(_jobRowData).filter(j=>j.date===tgt.date)`, multiple sites in `initScrollListDrag`'s `drop` handler) specifically *because* it's independent of `_jobCache`'s nullability during a poll cycle — collapsing the two caches without preserving that "immune to concurrent poll nulling" property could reintroduce the exact drag-drop-mid-poll bug this second cache was built to avoid. Any fix here needs to preserve that guarantee, which is a legitimate, documented constraint, not incidental duplication. This directly parallels the JS Refactoring report's Finding 3 (dual caches) and Data Layer report's Finding 4 (aggressive `_jobCache` invalidation) — all three reports independently converged on the same dual-cache structure from different angles, and any fix should be sequenced as one combined piece of work, not three separate ones.

**Recommended Solution**

Not "delete `_jobRowData`" — its poll-immunity property is real and load-bearing. Instead: (a) keep a single source of truth object and have `_jobCache` reference the same objects `_jobRowData` uses (so there's one set of job objects, not two independent full copies, even if both structures — an array for iteration/filtering, a map for O(1) id lookup — continue to exist as *views* over the same objects), and (b) since it's populated from the unfiltered `allJobs`, at minimum this should be documented as "intentionally mirrors the whole table, not just the current view" so a future maintainer doesn't assume it's already scoped down.

**Files affected:** `D:\DEEPFLOW\index.html` (`_getJobs`, `_invalidateJobCache`, `renderJobs`, `handleRealtimeChange`, `initScrollListDrag`).

**Estimated difficulty:** Medium (touches drag-drop correctness, needs careful regression testing against the specific "poll nulls cache mid-drag" scenario the second cache was built to survive).

**Estimated performance gain:** Low today (both caches are tiny); this is a future-scale memory-footprint finding, roughly halving the steady-state memory used to hold job data once the table is genuinely large.

---

## Control checks — things looked for and NOT found to be a problem

Worth stating plainly, so nothing here is overstated:

- **`initJobMultiSelect`'s click-delegation is correctly single-attached** (`_msInited` guard is never reset) — direct contrast to Finding 1, confirming that bug is isolated rather than systemic.
- **Column-resize drag** (`_bindResizeHandles`/`mousemove`/`mouseup`) reads layout (`getBoundingClientRect`) once on `mousedown`, then only moves a single overlay line during the drag with no interleaved read/write thrashing — correctly implemented, no rAF needed because there's no layout read inside the move handler.
- **The job-edit modal's open/close cycle does not exhibit the Finding-1 pattern.** `openJobModal`/`closeModal` work by filling a static, persistent form's field `.value`s and rebuilding small chip/dropdown lists via `innerHTML` + inline `onclick="..."` attributes (which get cleanly replaced on every rebuild, unlike `addEventListener`) rather than attaching new listeners to persistent container nodes — repeated open/close of the modal was checked and does not appear to leak listeners the way the drag-drop path does.
- **`_notifStore` is explicitly capped** at 50 entries (`index.html:18550`, `if(_notifStore.length>50) _notifStore.shift();`) — not an unbounded-growth risk.
- **`_pollKnownJobs` is bounded by job count** and is pruned on Realtime `DELETE` (`index.html:18798`) — not unbounded.
- Supabase Realtime channel re-subscription (`startRealtimeSync`) correctly unsubscribes the previous channel before creating a new one, and the reconnect timer is cleared before being re-armed — no stacking of duplicate Realtime subscriptions found.

---

## Summary ranking

| # | Finding | Present today at ~0–7 rows? | Severity |
|---|---|---|---|
| 1 | `#jobs-list-scroll` drag-listener accumulation | **Yes — fully reproduces regardless of row count** | Highest — best match to reported "gets stuck / inconsistent" symptoms; also a correctness bug (duplicate writes on drop) |
| 2 | Tooltip listeners re-bound (not leaked) on every render, full-document query | Negligible now, grows with row count | Medium, future-scale |
| 3 | No virtualization, ~37–40 nodes/row, unbounded default view | Invisible now (empty table) | Medium-high, entirely future-scale but directly matches the stated mission (Excel/Sheets-scale) |
| 4 | Two parallel full-table job caches, one never evicted to current view | Invisible now | Low-medium, future-scale memory footprint |

Finding 1 is the one to fix first and separately from the others — it's cheap (one line), low-risk, and unlike everything else in this report it is **already causing real, session-length-dependent degradation today**, independent of how many job rows exist.
