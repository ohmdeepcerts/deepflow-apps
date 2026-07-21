# Jobs Page UX & Automation Audit — DeepFlow

**Scope:** Interaction design, bulk actions, keyboard workflow, and automation/sync behavior of the Jobs page in D:\DEEPFLOW\index.html
**Method:** Static code read-through of interaction handlers, bulk-action functions, and autosave/sync logic.

---

## What already works well (baseline, before the findings below)

Before listing gaps, it's worth recording what's already solid so the eventual implementation plan doesn't inadvertently regress it: search/filter is fast and correctly in-memory (confirmed independently by the Data Layer report's Finding 3); `bulkSetPriority` is a genuinely well-built bulk action using proper batched requests; the Realtime-driven row-update path (where it actually fires) preserves scroll position correctly, unlike every other save/nav path in the page; and the overall date-grouped layout is a sensible, purpose-built structure for how this business actually works (not a generic table bolted on).

---

## Finding 1 — Duplicate/broken context menus

**Current Findings**
Right-clicking a job row can trigger two separate context menus firing at once, rather than one coherent menu. This overlaps directly with the QA report's BUG-1 (a `deleteJob()` call from one of these menus references an undefined function) and BUG-2 (both menus fire without `stopPropagation`, so they open simultaneously/conflict).

**Problems**
Users seeing two overlapping context menus, one of which contains a broken delete action, is a confusing and unpolished interaction that undermines trust in the interface, independent of the underlying JS bug.

**Root Cause**
Likely two separate context-menu implementations were added at different times (perhaps one for the row generally and one for a specific sub-element) without either one checking whether the other had already claimed the event.

**Evidence**
Direct reading of the `oncontextmenu` handlers attached to job rows and any nested elements shows more than one handler capable of firing for the same right-click, with no `event.stopPropagation()`/`preventDefault()` coordination between them.

**Impact**
Confusing double-menu UI, plus a broken delete path reachable from it (see QA BUG-1) — a real, user-facing defect, not just a rough edge.

**Risk**
Low-medium — fixing requires identifying and consolidating to a single context-menu implementation, which should be coordinated with the QA report's BUG-1/BUG-2 fixes rather than treated as a separate, redundant fix.

**Recommended Solution**
Consolidate to one context-menu implementation per row, with proper event handling so only one menu can be active at a time. Fix in the same pass as QA BUG-1 (undefined `deleteJob()`) and BUG-9 (modal-delete skipping the audit trail), since all three touch the same delete-from-context-menu interaction.

**Files affected**
D:\DEEPFLOW\index.html (row context-menu handlers, showJobCtxMenu)

**Estimated difficulty**
Small-medium.

**Estimated performance gain**
N/A — correctness/polish fix.

---

## Finding 2 — Multi-select is effectively invisible, with no select-all

**Current Findings**
The row selection checkbox (also flagged in the Accessibility report's Finding 3) is visually hidden by default (opacity 0, only appearing on hover or when already selected), and there is no "select all" control anywhere in the Jobs page toolbar.

**Problems**
A user who doesn't already know multi-select exists has essentially no visual cue to discover it, and even a user who does know about it has no fast way to select every currently-visible/filtered job at once — they must hover and click each row's checkbox individually.

**Root Cause**
The checkbox's hover-only visibility was presumably a deliberate declutter choice for the default (unselected) view, but no compensating affordance (a persistent "select" mode toggle, or a header select-all checkbox) was added.

**Evidence**
CSS confirms the checkbox's default opacity is 0, only becoming visible via `:hover`/`.jsr-selected` (matching the Accessibility report's Finding 3 evidence); no select-all control exists in the toolbar markup.

**Impact**
Bulk actions (already limited in scope — see Finding 3, 4 below) are hard to discover and slow to use even when they exist, since building any multi-job selection requires individually hovering and clicking many rows.

**Risk**
Low — additive UI (a visible toggle/select-all checkbox) without touching the underlying selection-state logic (`toggleSelRow` etc.), which can stay as-is.

**Recommended Solution**
Add a persistent (not hover-only) visual affordance for selection — e.g. a small always-visible checkbox, or an explicit "Select" mode toggle in the toolbar — plus a header/toolbar "select all visible" checkbox that operates against the currently filtered/visible row set.

**Files affected**
D:\DEEPFLOW\index.html (row selection markup/CSS, Jobs page toolbar)

**Estimated difficulty**
Small.

**Estimated performance gain**
N/A — usability fix.

---

## Finding 3 — No bulk status-change function exists

**Current Findings**
Bulk actions currently cover priority (`bulkSetPriority`) and deletion (`bulkDeleteJobs`, though orphaned — see Finding 4), but there is no equivalent bulk function for changing multiple selected jobs' status at once.

**Problems**
A very common real-world workflow — e.g. marking a batch of jobs from a completed day as "Completed" together — has no bulk path and must be done one row at a time via the per-row status dropdown.

**Root Cause**
Bulk actions appear to have been added one at a time as specific needs arose (priority, delete), and bulk status-change simply hasn't been built yet.

**Evidence**
No `bulkSetStatus`-equivalent function exists anywhere in the file; grep for bulk-prefixed functions returns only priority and delete variants.

**Impact**
Meaningful daily-workflow friction for office staff processing multiple jobs at the end of a day/route, forcing repetitive one-at-a-time status changes.

**Risk**
Low — can be modeled directly on the already-working `bulkSetPriority` pattern (per the Data Layer report's Finding 6, which specifically cites `bulkSetPriority` as the correct batching template).

**Recommended Solution**
Add a `bulkSetStatus()` function mirroring `bulkSetPriority`'s structure and batching approach, exposed via the same bulk-action toolbar once selection is made more discoverable (Finding 2). Should incorporate whatever status-lock/`STATUS_FLOW` enforcement is eventually added per the QA report's BUG-4, so bulk changes can't bypass status-transition rules that single-job changes will eventually respect.

**Files affected**
D:\DEEPFLOW\index.html (new bulkSetStatus function, alongside bulkSetPriority)

**Estimated difficulty**
Small-medium, using bulkSetPriority as a direct template.

**Estimated performance gain**
N/A — new feature, not a performance change; secondary efficiency benefit consistent with Data Layer Finding 6.

---

## Finding 4 — `bulkDeleteJobs()` is fully built but never wired to any button — orphaned

**Current Findings**
A complete `bulkDeleteJobs()` function exists in the codebase, but no button, menu item, or other UI control anywhere in the Jobs page actually calls it.

**Problems**
Working code with no way to reach it from the UI — a wasted feature, and confusing for future maintainers who might assume (reasonably) that bulk delete is already live because the function exists.

**Root Cause**
Likely built as part of a bulk-actions feature push, but the corresponding UI wiring (a "Delete selected" button) was either removed later or never finished.

**Evidence**
`bulkDeleteJobs` is defined but grep for its name shows no `onclick`/event-handler reference anywhere else in the file.

**Impact**
None today (unreachable code has no live effect), but represents a missed, already-paid-for feature and should be treated as effectively free to ship once wired up.

**Risk**
Low-medium — wiring up a bulk-delete action needs a confirmation step (given deletion is inherently risky, especially combined with the QA report's BUG-9 finding that the modal-delete path already skips the audit trail) — the bulk path must not repeat that mistake at greater scale (deleting many jobs at once without logging).

**Recommended Solution**
Wire `bulkDeleteJobs()` to a "Delete selected" button (available once selection is made discoverable per Finding 2), with a confirmation dialog and — critically — verify it correctly writes to the audit trail for every deleted job (cross-reference QA BUG-9 before shipping this).

**Files affected**
D:\DEEPFLOW\index.html (bulkDeleteJobs function, Jobs page toolbar)

**Estimated difficulty**
Small, contingent on first verifying/fixing the audit-trail gap from QA BUG-9.

**Estimated performance gain**
N/A — feature-completion fix.

---

## Finding 5 — Bulk actions fail silently per-item; `bulkSetPriority` has a "phantom success" UI bug

**Current Findings**
When a bulk action (e.g. `bulkSetPriority`) processes multiple jobs and one or more individual updates fail (e.g. a network blip or a permission error on one specific job), the failure isn't surfaced to the user — the UI reports success even though not every selected job was actually updated.

**Problems**
A user can believe a bulk action fully succeeded when it partially failed, with no indication of which items (if any) didn't go through — a silent-data-inconsistency risk.

**Root Cause**
The batched `Promise.all` (or equivalent) call's error handling likely reports overall completion without checking individual results for partial failures, or swallows individual rejections.

**Evidence**
Direct reading of `bulkSetPriority`'s completion/success-notification logic shows it fires unconditionally after the batch settles, without inspecting per-item results for failures.

**Impact**
A dispatcher who bulk-updates priority on 10 jobs, where 1 silently fails due to a transient issue, will believe all 10 succeeded and may not discover the discrepancy until that specific job's incorrect priority causes a real scheduling problem later.

**Risk**
Low — this is additive error-handling/reporting, not a change to the underlying batching logic itself.

**Recommended Solution**
Use `Promise.allSettled()` instead of (or in addition to) `Promise.all()`, inspect individual results, and surface a clear partial-failure message (e.g. "8 of 10 updated — 2 failed, click to retry") rather than a blanket success toast. Apply the same pattern to the new `bulkSetStatus()` (Finding 3) and the newly-wired `bulkDeleteJobs()` (Finding 4) from the start, rather than repeating this gap in new bulk actions.

**Files affected**
D:\DEEPFLOW\index.html (bulkSetPriority and other bulk-action functions)

**Estimated difficulty**
Small.

**Estimated performance gain**
N/A — correctness/reliability fix.

---

## Finding 6 — No keyboard grid navigation; four uncoordinated/overlapping keydown listeners

**Current Findings**
The Jobs page has no arrow-key/grid-style keyboard navigation between rows or cells (the kind of navigation a spreadsheet-like experience, explicitly the CTO brief's stated bar, would require), and separately, four distinct `keydown` event listeners exist in the broader page without clear coordination about which should handle a given key combination in a given context.

**Problems**
1. No keyboard-driven way to move between rows/cells at all, which is a fundamental gap against the CTO brief's explicit "feel like Excel/Google Sheets" goal — those tools are built around exactly this kind of navigation.
2. Multiple independent keydown listeners increase the risk of conflicting behavior (e.g. two listeners both trying to handle the same key in different contexts) and make it harder to reason about keyboard behavior holistically.

**Root Cause**
Keyboard handling was likely added piecemeal for specific individual features (e.g. a command palette, an autocomplete dropdown) rather than designed as a single coordinated keyboard-interaction layer for the page.

**Evidence**
Grep for `addEventListener('keydown'` (and inline `onkeydown`) across the Jobs-page-relevant code shows four separate registrations with different, non-overlapping-by-design scopes, but no central dispatcher coordinating them.

**Impact**
This is the single largest gap between the current Jobs page and the CTO brief's explicit "must feel like Excel/Google Sheets" final goal — spreadsheet-grade tools are defined substantially by their keyboard navigation model, which doesn't exist here at all today.

**Risk**
Medium-high — building real grid keyboard navigation (arrow keys to move focus between cells/rows, Enter to open/edit, Escape to cancel, Tab behavior that makes sense in a grid context) is a substantial interaction-design and implementation effort, and must be built to coexist with the four existing listeners rather than replacing them blindly (some may serve legitimate, unrelated purposes like the command palette).

**Recommended Solution**
Design a single coordinated keyboard-interaction layer for the Jobs grid specifically (arrow-key cell/row navigation, Enter/Space to activate, Escape to cancel/close), scoped so it doesn't conflict with the existing four listeners' legitimate purposes. This is a natural pairing with the Accessibility report's Findings 1/3/4 (rows/checkbox/drag-handle not keyboard-operable) — building real grid navigation would resolve several accessibility findings and the CTO brief's spreadsheet-feel goal in the same effort, rather than as separate initiatives.

**Files affected**
D:\DEEPFLOW\index.html (Jobs page row/cell rendering, new coordinated keydown handler, existing four keydown listeners for conflict review)

**Estimated difficulty**
Large — genuinely the most substantial single UX undertaking identified across this report.

**Estimated performance gain**
N/A directly — but this is the most direct lever on the CTO brief's subjective "feels like Excel/Sheets" bar, arguably as important as the raw-speed findings from other reports for meeting the stated final goal.

---

## Finding 7 — Time/Price "inline edit" is actually a blocking native `prompt()`, not a real inline editor

**Current Findings**
`quickEditTime()`/`quickEditPrice()` (also referenced in the Accessibility report's Finding 3) use the browser's native, synchronous `prompt()` dialog to capture a new value, rather than an actual inline `<input>` field.

**Problems**
Native `prompt()` blocks the entire page/tab while open, looks jarringly inconsistent with the rest of the app's styled UI, can't be styled at all, and doesn't behave like a real spreadsheet cell edit (no in-place typing, no Tab-to-next-cell, no Escape-to-cancel-without-a-dialog).

**Root Cause**
`prompt()` is the fastest way to grab a single text value from a user without building a real inline-edit UI, and was likely used as a quick implementation shortcut for this specific feature.

**Evidence**
Direct reading of `quickEditTime`/`quickEditPrice` (D:\DEEPFLOW\index.html:6796-6816, per the Accessibility report's evidence) confirms both call `prompt(...)` directly.

**Impact**
Directly undermines the CTO brief's "feel like Excel/Google Sheets" goal — a real spreadsheet never interrupts the user with a blocking native dialog for a single-cell edit. Also a UX inconsistency (this is the only editing interaction in the whole page that looks like this).

**Risk**
Low-medium — replacing `prompt()` with a real inline `<input>` requires handling blur/Enter/Escape behavior and click-outside-to-cancel logic that `prompt()` currently handles for free, but the underlying save call (`_sb(...)` PATCH) can be reused as-is.

**Recommended Solution**
Replace both `quickEditTime`/`quickEditPrice`'s `prompt()` calls with a real inline `<input>` that appears in place of the cell's text on click, saves on blur/Enter, and cancels on Escape — reusing the existing PATCH save logic. This pairs naturally with Finding 6's grid-navigation work (an inline-edit cell is a prerequisite building block for genuine spreadsheet-style editing) and should ideally be sequenced together.

**Files affected**
D:\DEEPFLOW\index.html:6796-6816 (quickEditTime, quickEditPrice), 7312-7313/7320-7321 (call sites)

**Estimated difficulty**
Medium.

**Estimated performance gain**
N/A — usability/consistency fix, though a real inline input is also marginally lighter-weight than spawning a native dialog.

---

## Finding 8 — No bulk copy-out/paste-in

**Current Findings**
There is no way to copy multiple selected jobs' data out (e.g. to paste into a spreadsheet) or paste tabular data in to create/update multiple jobs at once — interactions expected by default in genuinely spreadsheet-like tools.

**Problems**
Users familiar with Excel/Google Sheets workflows (explicitly the comparison bar set by the CTO brief) will find this a notable, immediately-felt gap the first time they try to copy a batch of jobs somewhere else or bulk-import data.

**Root Cause**
Not built — this is a feature gap, not a bug; copy/paste grid interactions are a substantial feature in their own right.

**Evidence**
No clipboard-related event handling (`copy`/`paste` event listeners) exists anywhere in the Jobs page code.

**Impact**
A real, felt gap against the CTO brief's stated comparison tools (Excel/Sheets/Airtable), though lower urgency than Finding 6's core navigation gap since it's a "power user" feature rather than baseline interaction.

**Risk**
Medium — clipboard interactions touch security-sensitive browser APIs and need careful handling of what data formats are supported (plain text/TSV at minimum for spreadsheet compatibility).

**Recommended Solution**
Defer until after Finding 6 (grid navigation) is built, since a real copy/paste implementation is far more natural once cells have well-defined selection/focus semantics. Scope initially to a simple TSV-based copy-out of selected rows before attempting paste-in (which requires validation/conflict-handling design).

**Files affected**
D:\DEEPFLOW\index.html (new clipboard event handling, contingent on Finding 6)

**Estimated difficulty**
Medium-large.

**Estimated performance gain**
N/A — new feature.

---

## Finding 9 — No undo/redo; hard deletes only

**Current Findings**
There is no undo/redo mechanism anywhere on the Jobs page; all destructive actions (status changes, deletes, bulk actions) are immediate and permanent from the UI's perspective.

**Problems**
Any accidental action (wrong row deleted, wrong bulk priority applied, the Finding 5 "phantom success" partial failure) has no in-app recovery path short of manually re-entering the correct data (or, for deletes, potentially no recovery at all if the audit trail — itself flagged as inconsistently written, per QA BUG-9 — doesn't capture enough to reconstruct the record).

**Root Cause**
Undo/redo is a substantial feature requiring either a command-pattern architecture or before/after snapshotting, neither of which appears to have been built into the app's design from the start.

**Evidence**
No undo-stack, command-history, or snapshot-restore logic exists anywhere in the file; deletes go directly to Supabase with no soft-delete/recycle-bin pattern.

**Impact**
Combined with the confirmed live bugs elsewhere in this task force (JS Refactoring's Finding 5 `editJid` mismatch risking silent overwrite; QA's BUG-1 broken delete path), the lack of any safety net turns what would otherwise be recoverable mistakes into permanent data loss.

**Risk**
High to build a general undo/redo system (significant architectural investment); low-medium to build a narrower "soft delete with a recycle bin/restore window" specifically for deletions, which addresses the highest-severity subset of this gap more cheaply.

**Recommended Solution**
Do not attempt full undo/redo as part of this initiative — scope is too large relative to benefit at this stage. Instead, prioritize a soft-delete pattern (mark deleted, hide from normal views, allow restore within some window before a scheduled hard-delete) for job deletion specifically, since that's the single highest-consequence irreversible action on this page today.

**Files affected**
D:\DEEPFLOW\index.html (delete-related functions), `jobs` table (would need a soft-delete flag/column)

**Estimated difficulty**
Medium for soft-delete specifically; large for general undo/redo (not recommended at this stage).

**Estimated performance gain**
N/A — safety/data-integrity feature.

---

## Finding 10 — Autosave only covers new jobs; no equivalent to `engineer.html`'s offline queue on the Office side

**Current Findings**
The offline write-queue pattern built for `engineer.html` (`queueableSave()`/`OFFLINE_QUEUE_KEY`, engineer.html ~1237-1319) has no equivalent in `index.html` — the Office App's autosave-in-progress protection only covers the specific case of a new job being drafted, not general write resilience against connectivity loss.

**Problems**
An office user who loses connectivity mid-edit (or mid-bulk-action) on an existing job has no queued-retry safety net the way an engineer using the field app already does — a real asymmetry between the two apps' resilience.

**Root Cause**
The offline queue was purpose-built for `engineer.html` earlier in this engagement specifically because engineers work in the field with unreliable connectivity; the Office App's environment (presumably a fixed office location) was assumed not to need the same protection, but this assumption may not hold for every real usage pattern (e.g. an office laptop on unstable wifi, or genuinely mobile office staff).

**Evidence**
Grep for `queueableSave`/`OFFLINE_QUEUE_KEY` confirms these exist only in `engineer.html`, with no equivalent construct anywhere in `index.html`.

**Impact**
A save/bulk-action attempted during a connectivity blip on the Office App likely fails outright (or silently, per Finding 5) rather than queuing for retry, risking lost edits in exactly the scenario the engineer app was already hardened against.

**Risk**
Medium — porting the existing, already-proven `engineer.html` pattern is lower-risk than designing a new one from scratch, but must be adapted to the Office App's different write patterns (bulk actions, inline quick-edits) which don't have a direct equivalent in `engineer.html`.

**Recommended Solution**
Port the `queueableSave()`/`OFFLINE_QUEUE_KEY` pattern from `engineer.html` to `index.html`, extending it to cover the Office App's additional write paths (bulk actions, inline quick-edit) beyond the single-job-save case it was originally built for.

**Files affected**
D:\DEEPFLOW\index.html (new offline-queue port), D:\DEEPFLOW\engineer.html (existing pattern to port from, ~1237-1319)

**Estimated difficulty**
Medium — proven pattern to adapt, but wider surface area of write paths to cover than the original.

**Estimated performance gain**
N/A — reliability/data-integrity feature.

---

## Finding 11 — Scroll position lost on every save/nav except the one Realtime path that already solved it correctly

**Current Findings**
Saving a job, navigating, or triggering most re-renders resets the Jobs list's scroll position back to the top, except for the Realtime-driven row-in-place-update path, which correctly preserves scroll position (confirmed as a positive finding above).

**Problems**
A user working through a long list of jobs (e.g. reviewing/updating many in sequence) is repeatedly kicked back to the top of the list after each save, forcing them to re-scroll to find their place — a significant, repetitive annoyance directly contributing to the "feels sluggish/inconsistent" complaint in the CTO brief.

**Root Cause**
Most save/nav paths trigger a full `renderJobs()` re-render (per the JS Refactoring report's Finding 1) that rebuilds the DOM from scratch without capturing/restoring scroll position, whereas the Realtime path uses the narrower `updateRowInPlace()` function which naturally doesn't disturb scroll position since it patches a single row rather than replacing the list.

**Evidence**
Direct comparison of the full-render code path (no scroll-position capture/restore logic present) against the Realtime in-place-update path (scroll position naturally preserved as a side effect of not rebuilding the DOM).

**Impact**
One of the more viscerally-felt "this feels broken" issues for a heavy daily user of the Jobs page — repeatedly losing your place in a list you're actively working through is a strong contributor to the "occasionally becomes slow, freezes, gets stuck... inconsistent behaviour" language used in the original CTO brief, even though the underlying cause here is UX/DOM-rebuild related rather than raw computational slowness.

**Risk**
Low-medium — the direct fix (capture scroll position before re-render, restore after) is straightforward, but the more durable fix is the same partial-render work already recommended in the JS Refactoring report's Finding 1, which would eliminate the full-list DOM rebuild that causes this in the first place.

**Recommended Solution**
Short-term: wrap the existing full-render call sites with scroll-position capture/restore (a quick, low-risk patch). Long-term: this becomes moot once the JS Refactoring report's Finding 1 partial-render work lands, since a diffed/targeted update naturally preserves scroll position the same way the Realtime path already does — recommend treating the short-term patch as a stopgap, not a substitute for that larger fix.

**Files affected**
D:\DEEPFLOW\index.html (renderJobs call sites following save/nav actions)

**Estimated difficulty**
Small for the short-term patch; already covered by JS Refactoring Finding 1's larger effort for the durable fix.

**Estimated performance gain**
N/A directly (a UX/perception fix), but likely one of the highest-leverage *perceived*-smoothness improvements available, given how frequently saves happen.

---

## Finding 12 — No visual flash/highlight on Realtime-updated rows

**Current Findings**
When a row is updated via the Realtime in-place-update path (from another session's change), the row updates silently with no visual cue (e.g. a brief highlight flash) drawing attention to the fact that something changed.

**Problems**
A user watching the list may not notice that a job was just updated by someone else, especially in a busy, date-grouped list — the update is functionally correct (once Finding 2 in the Data Layer report's empty-publication issue is fixed) but not perceptually obvious.

**Root Cause**
`updateRowInPlace()` was likely built to prioritize correctness of the data patch itself, with the visual-feedback layer not yet added.

**Evidence**
Direct reading of `updateRowInPlace()` shows DOM content/class updates but no transient highlight class/animation applied.

**Impact**
Low-moderate — a real polish gap, but contingent on Realtime actually working end-to-end first (Data Layer Finding 2), since without that fix this code path rarely/never fires in practice today.

**Risk**
Low — purely additive (a CSS transition/highlight class applied briefly on update, then removed).

**Recommended Solution**
Add a brief highlight/flash CSS transition to `updateRowInPlace()`'s DOM update, so users visually notice when a row changes from another session. Sequence this after Data Layer's Finding 2 fix, since it's only meaningfully testable once Realtime events are actually flowing.

**Files affected**
D:\DEEPFLOW\index.html (updateRowInPlace)

**Estimated difficulty**
Trivial.

**Estimated performance gain**
N/A — polish/UX fix.

---

## Finding 13 — No drag-to-assign-engineer

**Current Findings**
There is no drag-and-drop interaction for assigning/reassigning a job to a different engineer (e.g. dragging a job row onto an engineer's name/column) — engineer assignment is only available via a form field inside the modal or a dropdown, not a direct-manipulation interaction.

**Problems**
For a dispatcher actively balancing workload across engineers, a drag-to-assign interaction would be considerably faster than opening each job individually to change its assigned engineer.

**Root Cause**
Not built — a feature gap rather than a bug; the existing drag-and-drop infrastructure (`initScrollListDrag`) currently only supports within-day reordering (per the Accessibility report's Finding 4), not cross-engineer assignment.

**Evidence**
No drop-target logic tied to engineer identity exists anywhere in the drag-and-drop code; `initScrollListDrag`'s drop handling is scoped to reordering within the existing list structure only.

**Impact**
A genuine efficiency gap for dispatch workflows, though lower urgency than the core navigation/performance findings elsewhere in this report — a "nice to have" acceleration rather than a fix to something broken.

**Risk**
Medium — would need a new drop-target UI (e.g. an engineer sidebar/column) not currently part of the Jobs page layout, a larger design addition than a pure logic change.

**Recommended Solution**
Treat as a future enhancement rather than part of the current performance/reliability-focused initiative — worth scoping properly with dedicated design input once the higher-priority findings in this task force are resolved, rather than bolted on quickly.

**Files affected**
D:\DEEPFLOW\index.html (would require new UI + drag-drop logic)

**Estimated difficulty**
Large (new UI surface, not just logic).

**Estimated performance gain**
N/A — new feature.

---

## Finding 14 — No frozen columns (likely not a real gap)

**Current Findings**
The Jobs list has no "frozen"/sticky columns (a common spreadsheet feature keeping key columns, e.g. job number or address, visible while horizontally scrolling other columns).

**Problems**
In a traditional wide-table layout this would be a real gap; however, this page uses a fluid percentage-width column system rather than a fixed-width horizontally-scrolling table, so the usual motivation for frozen columns (avoiding losing context while scrolling right) doesn't clearly apply here the same way.

**Root Cause**
N/A — architectural choice (percentage-width responsive columns) rather than an oversight.

**Evidence**
Column width definitions use percentage-based sizing rather than fixed pixel widths with horizontal overflow scrolling.

**Impact**
Flagged explicitly as **not necessarily a real gap** given the current layout system — included for completeness against the CTO brief's spreadsheet-comparison framing, but should not be prioritized without first confirming users actually want/need horizontal scrolling behavior this page doesn't currently have.

**Risk**
N/A — no clear problem to solve without further clarification of actual need.

**Recommended Solution**
No action recommended unless a future need for horizontal scrolling (e.g. many more columns than currently fit) actually materializes — revisit only if the column set grows significantly.

**Files affected**
N/A

**Estimated difficulty**
N/A

**Estimated performance gain**
N/A

---

## Priority ranking for remediation

1. **Finding 11** (scroll position lost on every save) — highest-leverage *perceived*-smoothness fix; directly maps to the CTO brief's own language about "inconsistent behaviour."
2. **Finding 6** (no keyboard grid navigation) — largest single gap against the explicit "feel like Excel/Sheets" goal; large effort but core to the stated mission.
3. **Finding 1** (duplicate/broken context menus) — confirmed live bug, overlaps QA BUG-1/BUG-2.
4. **Finding 5** (silent bulk-action partial failures) — data-integrity risk, cheap fix.
5. **Finding 10** (no offline queue on Office side) — real resilience gap, proven pattern already exists to port.
6. **Finding 9** (no undo/soft-delete) — safety net for the multiple confirmed data-loss-risk bugs found elsewhere in this task force.
7. **Finding 2, 3, 4** (invisible multi-select, no bulk status, orphaned bulk-delete) — related cluster, moderate effort, real daily-workflow friction.
8. **Finding 7** (prompt()-based inline edit) — polish + prerequisite for Finding 6/8.
9. **Finding 12** (no update flash) — cheap polish, sequence after Data Layer Finding 2.
10. **Finding 8, 13** (copy/paste, drag-to-assign) — real but lower-urgency feature gaps; defer.
11. **Finding 14** (frozen columns) — likely not a real gap; no action recommended.
