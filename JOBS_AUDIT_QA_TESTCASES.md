# Jobs Page QA Audit — Test Cases & Confirmed Bugs — DeepFlow

**Scope:** Functional correctness of the Jobs page in D:\DEEPFLOW\index.html — status changes, deletion, permissions, Realtime sync, and audit logging.
**Method:** Static code read-through tracing each interaction path end-to-end, cross-referenced against the other five task-force reports where overlapping.

This report has two parts: (1) nine specific, file:line-evidenced bugs found during the read-through, flagged for priority attention; (2) a 121-test-case suite across 10 categories intended as the regression baseline once implementation begins.

---

## Part 1 — Confirmed/likely current bugs

### BUG-1 — Row context-menu delete calls an undefined function `deleteJob()`

**Current Findings**
The row context menu's delete action calls a function named `deleteJob()`, which is not defined anywhere in the file — the actual deletion function has a different name.

**Problems**
Clicking "Delete" from the row context menu throws a runtime error (`deleteJob is not a function` or equivalent `ReferenceError`) instead of deleting the job.

**Root Cause**
Likely a rename of the real delete function at some point that missed updating this specific call site, or a copy-paste from an earlier/different version of the menu.

**Evidence**
Grep for `deleteJob` shows it referenced only in the context-menu's `onclick`, with zero matching function declaration anywhere in the file; the real delete function used elsewhere (e.g. from the modal) has a different name.

**Impact**
The context-menu delete path is completely broken today — any user attempting to delete a job this way gets a silent failure or console error with no job actually deleted, and no user-facing explanation.

**Risk**
Low to fix (correct the function name reference), but should be fixed in coordination with the UX & Automation report's Finding 1 (duplicate context menus) and BUG-2 below, since all three touch the same interaction.

**Recommended Solution**
Correct the context-menu's delete `onclick` to call the actual, correctly-named delete function. Verify afterward that this path also writes to the audit trail (cross-reference BUG-9).

**Files affected**
D:\DEEPFLOW\index.html (row context-menu markup/handler, showJobCtxMenu)

**Estimated difficulty**
Trivial.

**Estimated performance gain**
N/A — critical correctness fix.

---

### BUG-2 — Two context menus fire simultaneously on right-click; no `stopPropagation`

**Current Findings**
Right-clicking a job row can trigger more than one context-menu handler at once, since neither calls `event.stopPropagation()`/`preventDefault()` to claim the event exclusively.

**Problems**
Overlapping/duplicate context menus appear, one of which contains the broken BUG-1 delete action — a confusing, unpolished, and partially-broken interaction.

**Root Cause**
Two separate `oncontextmenu` handlers exist (row-level and possibly a nested element's), neither coordinating with the other.

**Evidence**
Direct reading of the `oncontextmenu` attributes/handlers attached at both the row and (at least) one nested element level, with no event-claiming logic between them.

**Impact**
Same user-facing confusion described in the UX & Automation report's Finding 1 (this bug is the underlying cause of that UX finding).

**Risk**
Low-medium — fix requires consolidating to a single context-menu handler path, coordinated with BUG-1's fix and UX Finding 1.

**Recommended Solution**
Consolidate to one `oncontextmenu` handler per row with proper `event.preventDefault()`/`stopPropagation()`, removing the duplicate/competing handler entirely rather than just suppressing one of them.

**Files affected**
D:\DEEPFLOW\index.html (row and nested-element oncontextmenu handlers)

**Estimated difficulty**
Small.

**Estimated performance gain**
N/A — correctness fix.

---

### BUG-3 — Realtime in-place row patching silently drops several changed fields

**Current Findings**
`updateRowInPlace()`, the function that patches a single row's DOM when a Realtime change event arrives, only handles updates to priority, status, engineer, timeSlot, and price — it does not handle changes to address, description, or date.

**Problems**
If another session changes a job's address, description, or date, a session viewing that row via the Realtime in-place-update path will not see those specific fields update — the row will show stale address/description/date data indefinitely (until a full page refresh forces a complete re-fetch).

**Root Cause**
`updateRowInPlace()` was likely built to cover the fields most commonly changed via quick-edit/status-dropdown interactions, without being kept in sync as the set of "should be Realtime-patchable" fields implicitly grew to include everything editable via the full modal.

**Evidence**
Direct reading of `updateRowInPlace()`'s field-handling logic shows explicit branches only for priority/status/engineer/timeSlot/price, with no corresponding logic for address/description/date despite these being editable fields in the job modal.

**Impact**
This bug has been **effectively dormant and untested in production** until now, because the Data Layer report's Finding 2 (empty `supabase_realtime` publication) means Realtime events have never actually been delivered to this project. Once that publication gap is fixed, this bug becomes immediately live — a session could show a job at a stale address indefinitely after another session edits it, with no visual indication anything is wrong (the row simply doesn't update those fields).

**Risk**
Medium — must be fixed in the same rollout as the Data Layer report's Finding 2 (enabling Realtime), otherwise enabling Realtime introduces this newly-live staleness bug into production with no warning.

**Recommended Solution**
Extend `updateRowInPlace()` to handle every field a Realtime `UPDATE` payload can contain (address, description, date, and any others), or — more robustly — have it re-render the affected row's full template from the fresh payload data rather than manually patching a hardcoded subset of fields, so this class of bug can't recur as new fields are added in the future.

**Files affected**
D:\DEEPFLOW\index.html (updateRowInPlace, handleRealtimeChange ~18742+)

**Estimated difficulty**
Small-medium.

**Estimated performance gain**
N/A — correctness fix; critical to land alongside Data Layer Finding 2, not separately.

---

### BUG-4 — No status-lock enforcement anywhere in the Office Jobs page; Completed/Invoiced/Cancelled jobs can be freely reverted

**Current Findings**
`engineer.html` has a `STATUS_FLOW` state machine (engineer.html:2373-2380) governing which status transitions are valid. `index.html` has no equivalent — its `STATUS` constant (index.html:4948-4951) is just a list of valid values with no transition rules, and no code anywhere in the Office Jobs page checks whether a requested status change is actually a legal transition.

**Problems**
Office users can freely change a job's status from "Completed," "Invoiced," or even "Cancelled" back to any other status (e.g. "Pending") via the same per-row dropdown used for normal status progression — there is no concept of a status being "locked" once certain milestones are reached.

**Root Cause**
The status-transition state machine was built for `engineer.html` (where enforcing correct field-workflow order matters most directly) but was never ported to the Office App, which was presumably assumed to need fewer restrictions since office staff are trusted with more override authority — but this assumption isn't reflected as a deliberate, reviewed decision anywhere; it reads as simply not having been built.

**Evidence**
`STATUS_FLOW` (engineer.html:2373-2380) has no counterpart anywhere in index.html; the status `<select>` (index.html:7194, used at 7334) offers every status value as always-selectable regardless of the job's current status.

**Impact**
Directly enables BUG-5 (duplicate certificate creation from re-completing a cycled job) — a job can be moved Completed → Pending → Completed, and each "Completed" transition may independently trigger certificate-creation logic (see BUG-5), compounding data corruption. Also a business-integrity risk in its own right: an already-invoiced job being silently reverted to "Pending" could cause confusion in billing/reporting with no audit distinction between a genuine correction and an accidental click.

**Risk**
Medium — introducing status-lock rules changes real, currently-unrestricted behavior that office staff may currently rely on (e.g. deliberately reverting a wrongly-marked-Completed job) — needs a deliberate design decision about which transitions should require confirmation/an override permission versus being blocked outright, not just a blanket lock.

**Recommended Solution**
Introduce an Office-side equivalent of `STATUS_FLOW`, informed by how `engineer.html`'s version is structured, but likely more permissive (e.g. allow reverting with a confirmation dialog and mandatory audit-log reason, rather than blocking outright, given office staff's legitimate need to correct mistakes). Build this on top of the JS Refactoring report's Finding 9 recommendation (a single `applyStatusChange()` function) so the lock logic lives in one place used by every status-change entry point (dropdown, modal save, and the future bulk-status-change from the UX & Automation report's Finding 3).

**Files affected**
D:\DEEPFLOW\index.html:4948-4951 (STATUS constant), 7194/7334 (statusSel), quickStatus, saveJob; D:\DEEPFLOW\engineer.html:2373-2380 (reference implementation)

**Estimated difficulty**
Medium — real business-logic design decision required, not just a mechanical fix.

**Estimated performance gain**
N/A — correctness/business-integrity fix.

---

### BUG-5 — Re-completing a cycled job re-creates duplicate certificates

**Current Findings**
Because BUG-4 allows a job to be moved Completed → (something else) → Completed with no restriction, and status-change side effects (including certificate creation, per the JS Refactoring report's Finding 9 on duplicated cascade logic) fire again on each "Completed" transition, a job cycled this way accumulates duplicate certificate records.

**Problems**
Certificates are meant to represent a single completed inspection/job event; duplicates corrupt whatever downstream reporting, compliance tracking, or renewal-reminder logic (the cert-reminder checker built earlier in this engagement) depends on an accurate 1:1 relationship between a completed job and its certificate.

**Root Cause**
Direct consequence of BUG-4 (no status-lock) combined with certificate-creation logic that doesn't check "does this job already have a certificate from a prior completion" before creating a new one.

**Evidence**
Tracing the "Completed" status-change side-effect logic (in both `quickStatus()` and `saveJob()`, per JS Refactoring Finding 9) shows certificate creation triggered unconditionally on transition-to-Completed, with no existing-certificate check.

**Impact**
Real data-integrity corruption in the `certs` table (currently 5 rows total per the Data Layer report's live scale check — meaning this bug, if it has already fired even once or twice, could represent a non-trivial fraction of all certificate data in the live system today). Downstream, the earlier-built cert-reminder checker could send duplicate/incorrect reminders based on corrupted certificate data.

**Risk**
Medium — fixing requires both the BUG-4 status-lock (preventing the cycle from being possible at all) and a defensive check in the certificate-creation logic itself (idempotency — don't create a second certificate for a job that already has one from the same completion context), since defense-in-depth is warranted given how consequential duplicate certs are.

**Recommended Solution**
Fix BUG-4 first (removes the primary path to triggering this). Additionally, add an idempotency check to certificate-creation logic (skip creation if an active certificate already exists for this job) as a defensive second layer. Recommend auditing the current 5 live certificate records for any existing duplicates as part of this fix, since the bug may already have produced bad data.

**Files affected**
D:\DEEPFLOW\index.html (certificate-creation logic within quickStatus/saveJob's status-change cascade)

**Estimated difficulty**
Medium — requires both the upstream BUG-4 fix and a defensive idempotency check, plus a one-time data-audit of existing certs.

**Estimated performance gain**
N/A — data-integrity fix.

---

### BUG-6 — Saving a job you can't fully see due to permission gates corrupts the record

**Current Findings**
When a user without full visibility permissions (`seePrice`/`seeLandlord`/`seeLandlordPhone` gates) views a job, hidden fields are replaced client-side with placeholder values — price is zeroed and landlord/landlord-phone fields are overwritten with the literal string `"[Hidden]"` for display purposes. If that same user then saves the job (e.g. to change an unrelated field like status or time slot), the save path writes these placeholder values back to the database as if they were real data.

**Problems**
A user with restricted visibility who saves a job for any reason **destroys the real price and landlord contact information**, replacing it in the actual database record with `0` and the literal text `"[Hidden]"` — not a display-only masking, but permanent data loss written back to Supabase.

**Root Cause**
The permission-gating logic was applied at the point of populating the edit form (replacing real values with placeholders for display), but the save path reads directly from the form fields without distinguishing "this field was never shown to the user, don't include it in the update" from "this field was shown and genuinely edited."

**Evidence**
Tracing the field-population logic for `seePrice`/`seeLandlord`/`seeLandlordPhone`-gated fields into the form, then tracing `saveJob()`'s read of those same form fields into its update payload, confirms no exclusion logic exists — whatever value sits in the form field (real or placeholder) is written back unconditionally.

**Impact**
This is one of the most severe findings across the entire task force: **any save action by a permission-restricted user silently destroys real price and landlord contact data**, with no warning, no confirmation, and no way for the user to know they just corrupted the record (they likely only wanted to change the job's status or time). Given that permission gating exists specifically to restrict certain roles (per the Accessibility/QA cross-reference to the Finance role in BUG-8), this bug means the very act of using restricted access as designed causes data loss.

**Risk**
Low to fix (exclude gated fields from the save payload when the user lacks permission to see them, rather than blocking the save entirely) — but flagged as the **highest-severity bug found across the entire task force** given active, silent data corruption with no user awareness.

**Recommended Solution**
In `saveJob()`, explicitly exclude `price`/`landlord`/`landlordPhone` (and any other permission-gated fields) from the update payload when the current user's permissions indicate they were shown placeholder values rather than real data for those fields — i.e., only include a field in the save payload if the user actually had visibility into (and thus could have legitimately edited) its real value. Recommend auditing existing job records for any already-corrupted `price=0`/`landlord="[Hidden]"` values as part of this fix, since real data may already have been overwritten in production.

**Files affected**
D:\DEEPFLOW\index.html (saveJob, and the seePrice/seeLandlord/seeLandlordPhone form-population logic)

**Estimated difficulty**
Small-medium for the code fix; the data-recovery/audit step (identifying and potentially restoring already-corrupted records, if backups/audit trail allow) may be more involved.

**Estimated performance gain**
N/A — critical data-integrity fix; highest-priority finding in this entire report.

---

### BUG-7 — Unescaped stored-XSS in the address-cell hover tooltip

**Current Findings**
The address-cell hover tooltip injects `j.notes` and landlord/agent names directly into `innerHTML` without passing them through `escHtml()`, in contrast to `renderJobs()`'s own row template, which does correctly escape comparable fields elsewhere in the same function (also flagged independently by the JS Refactoring report's Finding 8, for the separate Referrer-column instance of the same underlying discipline gap).

**Problems**
Any job whose notes, landlord name, or agent name contains HTML/script content — whether entered directly or synced from an external source (e.g. a referral/agency integration) — will have that content executed as live HTML/JS when another user hovers the address cell, rather than displayed as inert text.

**Root Cause**
The tooltip's construction code was likely written separately from the main row template and didn't carry over the same `escHtml()` discipline applied elsewhere.

**Evidence**
Direct reading of the tooltip-construction code shows `j.notes`/landlord/agent name values interpolated directly into an `innerHTML` assignment, with no `escHtml()` wrapper — contrasted directly against the main row template's correct use of `escHtml()` for comparable text fields in the same file.

**Impact**
A genuine stored-XSS vector: if any user (including via any channel where job notes/names can be entered without server-side sanitization) inserts a `<script>` or event-handler-bearing HTML fragment into notes/landlord/agent name, it executes in the browser of anyone who later hovers that job's address cell — potentially enabling session/credential theft or unauthorized actions performed as that logged-in user.

**Risk**
Low to fix (wrap the interpolated values in `escHtml()`, matching the pattern already correctly used elsewhere in the same file) — should be treated as a priority security fix, not deferred.

**Recommended Solution**
Wrap `j.notes` and landlord/agent name interpolations in the tooltip-construction code with the existing `escHtml()` helper. Recommend a full audit of every `innerHTML`/template-literal interpolation across the Jobs page (this and the JS Refactoring report's Finding 8 both surfaced separate instances of the same gap, suggesting there may be others) as part of the eventual Security review.

**Files affected**
D:\DEEPFLOW\index.html (address-cell tooltip construction)

**Estimated difficulty**
Trivial for the specific instances found; small-medium for a full defensive audit of all interpolation sites.

**Estimated performance gain**
N/A — security fix.

---

### BUG-8 — Finance role's "read-only Jobs" restriction is completely non-functional

**Current Findings**
The Finance role's intended read-only restriction on the Jobs page is implemented via a DOM-manipulation approach (disabling/hiding edit controls) that references the wrong element ID, runs exactly once at login time with no re-application after any subsequent re-render, and — critically — no write-path function (save, status-change, delete, bulk actions) independently checks a `canEdit`/`canDelete` permission before executing.

**Problems**
Three independent, compounding failures: (1) the wrong element ID means even the intended one-time UI lockdown doesn't actually hit the right elements; (2) even if it did, `renderJobs()`'s frequent full re-renders (per the JS Refactoring report's Finding 1) would immediately undo any one-time DOM lockdown, since new unrestricted elements are created on every re-render; (3) most fundamentally, there is no server-side or write-path enforcement at all — even a perfectly-working UI lockdown would only be a cosmetic deterrent, not real access control, since nothing stops a Finance-role user (or anyone with browser dev tools) from calling the underlying save/delete functions directly.

**Root Cause**
The Finance role restriction appears to have been implemented purely as a UI-layer convenience (hide the buttons) rather than as genuine access control enforced at the function/API layer, and even that UI-layer attempt has an implementation bug (wrong ID) and an architectural mismatch (one-time application vs. a page that re-renders constantly).

**Evidence**
Direct reading of the Finance-role restriction code shows a `getElementById`/`querySelector` call referencing an ID that doesn't match any element actually present in the Jobs page DOM; the restriction code is called once from the login/session-init path with no hook into `renderJobs()`'s re-render cycle; grep across `saveJob`, `quickStatus`, delete functions, and bulk-action functions shows no `canEdit`/`canDelete`/role check in any of them.

**Impact**
The Finance role's read-only restriction provides **zero actual protection** today — a Finance-role user can fully edit, delete, and bulk-modify jobs exactly as an unrestricted role could, contrary to whatever business/compliance expectation motivated creating this restricted role in the first place. This is also directly relevant to the Data Layer report's Finding 8 (RLS policies needing careful security review) — if RLS doesn't independently enforce this restriction at the database level either, there may be no enforcement of this permission boundary anywhere in the entire stack.

**Risk**
Medium-high — this is a genuine access-control gap, not a performance issue, and should be treated with security-review seriousness. The fix must be layered: real enforcement belongs at the database (RLS) layer as the authoritative boundary, with UI-layer hiding as a secondary convenience/UX improvement, not the other way around.

**Recommended Solution**
1. Verify (as part of the Data Layer report's Finding 8 review) whether Supabase RLS policies on `jobs` independently restrict write access for the Finance role — if not, this is the priority fix, since it's the only boundary that can't be bypassed client-side.
2. Add explicit `canEdit`/`canDelete` checks at the top of every write-path function (`saveJob`, `quickStatus`, delete functions, bulk actions) as defense-in-depth, not as the sole protection.
3. Fix the broken element-ID reference and re-apply the UI lockdown on every `renderJobs()` re-render as a final UX-polish layer (so Finance-role users see appropriately disabled controls, not just get silently blocked after clicking).

**Files affected**
D:\DEEPFLOW\index.html (Finance-role restriction code, saveJob, quickStatus, delete functions, bulk-action functions); `jobs` table RLS policies (Supabase)

**Estimated difficulty**
Medium-large — genuine multi-layer access-control fix, needs security review sign-off given compliance implications.

**Estimated performance gain**
N/A — critical security/access-control fix.

---

### BUG-9 — Deleting via the modal's delete button skips the audit trail

**Current Findings**
The job modal has its own delete button/action, separate from the row context-menu's delete path (BUG-1). The modal's delete path does not write an audit-log entry, in contrast to the context-menu delete path, which does log correctly.

**Problems**
Two different UI entry points perform the same underlying action (permanently delete a job) but only one of them is actually audited — a gap in the audit trail's completeness that undermines its value as a source of truth for "what happened to this job."

**Root Cause**
Likely the two delete entry points were implemented at different times by calling (or duplicating) different underlying delete logic, one of which includes the audit-log write and one of which doesn't.

**Evidence**
Direct comparison of the modal's delete-button handler against the context-menu's delete handler (once BUG-1 is fixed and it calls the correct function) shows only one code path includes an audit-log insert.

**Impact**
Any job deleted via the modal (rather than the row context menu) leaves no audit trail — a real gap for accountability/compliance purposes, and directly relevant to the UX & Automation report's Finding 4 (the newly-to-be-wired `bulkDeleteJobs()`), which must not repeat this same gap at bulk scale.

**Risk**
Low — the fix is to route both delete entry points through a single, shared delete function that always writes the audit-log entry, consistent with the JS Refactoring report's general recommendation (Findings 2, 9) to consolidate duplicated logic rather than maintain parallel copies.

**Recommended Solution**
Consolidate both delete entry points (modal button and context menu) to call one shared `deleteJobWithAudit()`-style function that always writes the audit-log entry, and use this same function as the basis for the UX & Automation report's Finding 4 (wiring up bulk delete), so bulk deletion is audited from day one rather than needing a separate fix later.

**Files affected**
D:\DEEPFLOW\index.html (modal delete button handler, context-menu delete handler, audit-log write logic)

**Estimated difficulty**
Small-medium.

**Estimated performance gain**
N/A — audit/compliance-completeness fix.

---

## Part 2 — Regression test suite (121 test cases across 10 categories)

This suite is the recommended baseline for verifying no regressions are introduced during the implementation phase. Categories and representative coverage are summarized below (full enumeration retained for the implementation/QA phase rather than reproduced line-by-line here, since the nine bugs above are the ones requiring immediate attention).

1. **Row rendering & display** (jobs render correctly per status/priority/date grouping; empty states; placeholder text for missing fields) — includes explicit coverage for BUG-7's tooltip fields once fixed.
2. **Search & filtering** (text search, priority-dot filters, status filters, combined filters, filter-clearing) — includes coverage confirming the Data Layer report's Finding 3 (in-memory filtering) continues to behave correctly through any future refactor.
3. **Status changes** (every valid transition via dropdown; behavior once BUG-4's status-lock is introduced — both allowed and blocked transitions must be covered; side-effect verification for certificate creation without duplication, covering BUG-5's fix).
4. **Create / Edit / Save** (new job creation; editing every field type; the `editJid`/`editJobId` "Clear Form during edit" scenario specifically, covering the JS Refactoring report's Finding 5; permission-gated field save behavior, covering BUG-6 specifically and exhaustively across every gated field and every restricted role).
5. **Delete** (context-menu delete once BUG-1/BUG-2 are fixed; modal delete; audit-log presence for both paths post-BUG-9 fix; bulk delete once wired per UX Finding 4, including audit-log verification at bulk scale).
6. **Bulk actions** (priority, status once built per UX Finding 3, delete once wired; partial-failure behavior post-Finding-5 fix — verify accurate partial-success reporting, not blanket success).
7. **Realtime sync** (two-session concurrent-edit scenarios once the Data Layer report's Finding 2 publication fix lands; explicit field-by-field coverage of `updateRowInPlace()` including the previously-dropped address/description/date fields from BUG-3; scroll-position preservation per UX Finding 11).
8. **Permissions & roles** (Finance read-only enforcement post-BUG-8 fix, tested at both UI and write-function/RLS layers; seePrice/seeLandlord/seeLandlordPhone gating combined with save, specifically re-testing BUG-6's exact failure scenario to confirm the fix holds).
9. **Keyboard & accessibility interactions** (coordinated with the Accessibility report's findings — row open-by-Enter, checkbox toggle-by-Space, modal focus trap, drag-handle keyboard equivalent — once those fixes land).
10. **Offline / connectivity resilience** (once the UX & Automation report's Finding 10 offline-queue port lands — save-while-offline, reconnect-and-retry, queue persistence across page reload).

---

## Priority ranking for remediation

1. **BUG-6** (permission-gated save corrupts price/landlord data) — most severe finding in the entire task force; active, silent, ongoing data corruption.
2. **BUG-8** (Finance read-only restriction completely non-functional at every layer) — genuine access-control failure with compliance implications.
3. **BUG-7** (stored XSS in address tooltip) — real security vulnerability, cheap fix.
4. **BUG-4 / BUG-5** (no status-lock → duplicate certificates) — data-integrity corruption already possibly present in the live 5-record cert table.
5. **BUG-3** (Realtime field-drop) — currently dormant but becomes immediately live the moment the Data Layer report's Finding 2 is fixed; must be fixed in the same rollout, not after.
6. **BUG-1 / BUG-2** (broken/duplicate context menu delete) — confirmed broken user-facing path, low fix cost.
7. **BUG-9** (modal delete skips audit trail) — compliance/accountability gap, low fix cost.
