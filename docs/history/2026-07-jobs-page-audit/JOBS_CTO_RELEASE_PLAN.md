# CTO Release Plan — Jobs Page Remediation — DeepFlow

**Status:** All 6 task-force reports complete (Accessibility, JS Refactoring, Data Layer, UX & Automation, QA Test Cases, Rendering & Memory), plus the Security review and Scalability estimate synthesized from them. This is the phased implementation plan — nothing below has been implemented yet. Each phase is scoped to be independently shippable and independently testable, so a problem in a later phase never blocks or risks an earlier one already in production.

**Source reports:** [JOBS_AUDIT_ACCESSIBILITY.md](JOBS_AUDIT_ACCESSIBILITY.md) · [JOBS_AUDIT_JS_REFACTORING.md](JOBS_AUDIT_JS_REFACTORING.md) · [JOBS_AUDIT_DATA_LAYER.md](JOBS_AUDIT_DATA_LAYER.md) · [JOBS_AUDIT_UX_AUTOMATION.md](JOBS_AUDIT_UX_AUTOMATION.md) · [JOBS_AUDIT_QA_TESTCASES.md](JOBS_AUDIT_QA_TESTCASES.md) · [JOBS_AUDIT_RENDERING_MEMORY.md](JOBS_AUDIT_RENDERING_MEMORY.md) · [JOBS_CTO_SECURITY_REVIEW.md](JOBS_CTO_SECURITY_REVIEW.md) · [JOBS_CTO_SCALABILITY_ESTIMATE.md](JOBS_CTO_SCALABILITY_ESTIMATE.md)

---

## Guiding principle for sequencing

Fixes are ordered by **(severity × how independent/low-risk the fix is)**, not by which report found them. A few fixes are explicitly held back from an "obvious" early slot because another report proved they must ship together with something else — those dependencies are called out explicitly so they aren't missed during implementation.

---

## Phase 0 — Immediate, independent, high-confidence fixes

Each item here is small, isolated, and already fully diagnosed. No design decisions remain — these are ready to implement as-is. Recommend shipping this phase first, as its own change, before anything else.

| Fix | Source | Change | Risk |
|---|---|---|---|
| Delete `scroll._dragInited = false` at index.html:7362 | Rendering & Memory Finding 1 | One-line deletion | Low — the guard it defeats is already proven correct on the sibling `initJobMultiSelect` function |
| Fix `editJobId` → `editJid` at index.html:9765 | JS Refactoring Finding 5 | One-line variable name fix | Low — corrects an undeclared-variable typo |
| Exclude permission-gated fields from `saveJob()`'s payload when the user lacks visibility | QA BUG-6 | Guard the price/landlord/landlordPhone fields in the save payload | Low-medium — must verify every legitimate "user *can* see and edit this field" path still saves correctly |
| Escape the Referrer column in `renderJobs()` | JS Refactoring Finding 8 | Wrap existing interpolation in `escHtml()` | Low |
| Escape `j.notes`/landlord/agent names in the address tooltip | QA BUG-7 | Wrap existing interpolation in `escHtml()` | Low |
| Fix context-menu delete calling undefined `deleteJob()` | QA BUG-1 | Correct the function reference | Low |
| Add `stopPropagation`/`preventDefault` so only one context menu fires | QA BUG-2 | Consolidate to a single handler | Low-medium |

**Test plan:** QA report's Category 4 (Create/Edit/Save, specifically the `editJid`/Clear-Form scenario and permission-gated save scenario) and Category 5 (Delete, context-menu path) test cases, run manually against a staging copy before and after. No automated test suite exists in this project (no build tooling), so "testable" here means a documented manual verification script, not CI.

**Why first:** every item is a confirmed, currently-live bug (not a future-scale concern), each fix is small enough to review in full, and none of them depend on any other phase.

---

## Phase 1 — Access control (sequenced deliberately, not rushed)

This phase is separated from Phase 0 specifically because the Security review flagged it as needing verification before action, not because it's less urgent.

1. **Verify** (query/test, don't yet change) whether RLS policies on `jobs` currently block Finance-role writes independent of the UI. This single check determines how severe QA BUG-8 actually is in practice.
2. Add `canEdit`/`canDelete` checks to every write-path function (`saveJob`, `quickStatus`, delete functions, bulk actions) — QA BUG-8.
3. Fix the broken UI lockdown (correct element ID; re-apply on every `renderJobs()` re-render, not just at login) — QA BUG-8.

**Risk:** Medium — this changes real, currently-unrestricted behavior. Needs sign-off on exactly what Finance-role users should and shouldn't be able to do (the audit found the *mechanism* broken, not what the *intended* rule was) before implementation, since "fixing" this without a clear spec risks either being too permissive (no real fix) or too restrictive (blocking a legitimate workflow office staff currently rely on).

**Test plan:** QA report's Category 8 (Permissions & roles) — log in as each role, attempt every write action, confirm allowed/blocked matches the agreed spec. Test at the RLS layer directly (e.g., a scripted request bypassing the UI entirely) in addition to through the UI, since the whole point of this phase is that UI-only testing was exactly what let this bug go unnoticed.

---

## Phase 2 — Enable Realtime (one combined rollout, not two)

The Data Layer report's single highest-impact finding — the empty `supabase_realtime` publication — must ship together with its dependent fix, not alone, per the QA report's explicit warning.

1. `ALTER PUBLICATION supabase_realtime ADD TABLE jobs;`
2. **In the same release:** extend `updateRowInPlace()` to handle every field a Realtime `UPDATE` can carry (address, description, date — currently dropped per QA BUG-3), or switch it to re-render the row from the full fresh payload rather than a hardcoded field subset.
3. **In the same release:** add a brief visual highlight/flash to Realtime-updated rows (UX & Automation Finding 12) so the now-functioning sync is actually visible to users, not just technically correct.

**Risk:** Low for the publication change itself (additive, reversible); medium for verifying `handleRealtimeChange()`'s downstream logic behaves correctly once events start flowing for the first time in this project's history — this code path has never been exercised against production data before.

**Test plan:** Two-session manual test (documented in the QA report's Category 7) — open the Jobs page in two browser sessions, change every field type in one, confirm the other updates correctly including the three previously-dropped fields, confirm scroll position is preserved (UX Finding 11), confirm the new highlight appears.

**Why this phase, this order:** this is very likely the actual root cause of the "freezing/stuck" complaint that started the whole initiative — shipping it early matters — but shipping the publication fix without BUG-3's fix would introduce a *new*, previously-dormant staleness bug into production the moment it goes live, which is worse than leaving Realtime off.

---

## Phase 3 — Status integrity (business-logic decision required)

1. Design and introduce an Office-side status-transition rule set (equivalent in purpose to `engineer.html`'s `STATUS_FLOW`, but likely more permissive — allow reverting with confirmation + mandatory audit reason, rather than blocking outright, given office staff's legitimate need to correct mistakes) — QA BUG-4.
2. Add an idempotency check to certificate-creation logic (skip if an active certificate already exists for this job) as defense-in-depth — QA BUG-5.
3. Audit the current 5 live certificate records for any duplicates the existing bug may have already produced, before or alongside this fix.
4. Consolidate the status-change cascade in `quickStatus()`/`saveJob()` into one shared function as the natural home for the new rules — JS Refactoring Finding 9.
5. Fix `updateRowInPlace`'s `priMap` missing the `'Low'` key while touching this code — JS Refactoring Finding 2.
6. Fix the modal-delete path skipping the audit trail, consolidating both delete entry points to one audited function — QA BUG-9.

**Risk:** Medium — item 1 is a genuine business-rule design decision, not a mechanical fix, and needs the user's input on exactly which transitions should be blocked vs. merely confirmed. This should not be implemented unilaterally.

**Test plan:** QA report's Category 3 (Status changes) — every valid and newly-blocked transition, certificate-creation verification across a full Completed→other→Completed cycle, audit-log presence check for every delete path.

---

## Phase 4 — UX & workflow (the "feels like Excel/Sheets" work)

Ordered by leverage, per the UX & Automation report's own priority ranking:

1. Preserve scroll position on save/nav (UX Finding 11) — cheapest, highest-perceived-smoothness win; ship as a standalone quick patch even before the deeper fix below.
2. Make multi-select visually discoverable + add select-all (UX Finding 2).
3. Build `bulkSetStatus()` on the proven `bulkSetPriority` batching pattern (UX Finding 3), and wire up the already-built but orphaned `bulkDeleteJobs()` with a confirmation step and verified audit logging (UX Finding 4).
4. Fix silent partial-failure reporting in bulk actions — use `Promise.allSettled`, surface real partial-success messages (UX Finding 5).
5. Replace the `prompt()`-based Time/Price inline edit with a real inline `<input>` (UX Finding 7) — also a prerequisite building block for item 6.
6. Design and build real keyboard grid navigation (UX Finding 6) — the largest single item in this phase, and the most direct answer to the CTO brief's explicit "must feel like Excel/Google Sheets" bar. Recommend scoping this as its own sub-project with dedicated design time rather than folding it into a general sprint.
7. Port the `engineer.html` offline-queue pattern to the Office App (UX Finding 10).

**Risk:** Low-medium for items 1-5 and 7; medium-high for item 6 given its scope.

**Test plan:** UX & Automation report's implicit coverage plus manual verification of each bulk action's success/partial-failure messaging; keyboard navigation needs its own dedicated test pass once designed (not yet specified since the design itself isn't done).

---

## Phase 5 — Accessibility remediation

Ordered per the Accessibility report's own priority ranking:

1. Modal focus management — focus-on-open, focus-restore-on-close, real focus trap (Finding 5) — highest risk today since keyboard users can currently tab into invisible background content mid-edit.
2. Make job rows keyboard-operable (`role="button" tabindex="0"` + guarded keydown) (Finding 1).
3. Reinstate the priority text/icon pill, currently dead code (Finding 2).
4. Darken `--txt3` to meet WCAG AA contrast (Finding 9) — global CSS variable, needs app-wide visual review, not just Jobs page.
5. Remaining findings (checkbox/quick-edit focusability, drag-reorder keyboard equivalent, ARIA dialog semantics, status-select labels, priority-filter-dot semantics) — Findings 3, 4, 6, 7, 8.

**Risk:** Low for most items (additive ARIA/attributes); medium for Finding 5 (touches the shared `openModal`/`closeModal` used by every modal in the app, so needs regression testing beyond just Jobs) and Finding 9 (global CSS token, app-wide visual impact).

**Note:** Finding 1 (keyboard-operable rows) and Finding 4 (drag-reorder keyboard equivalent) naturally overlap with Phase 4 item 6 (grid keyboard navigation) — recommend designing them together rather than as separate efforts, since a real grid-navigation model resolves several of these accessibility gaps as a side effect.

**Test plan:** Manual keyboard-only and screen-reader walkthroughs of the full Jobs workflow (open, edit, save, delete, filter, bulk-select) per the Accessibility report's methodology.

---

## Phase 6 — Architectural refactor

This is the largest, highest-risk phase, and deliberately last — everything above is either a bug fix or an additive feature; this phase restructures the load-bearing rendering function itself.

1. Consolidate `_jobCache`/`_jobRowData` into one backing store, preserving the poll-immunity guarantee `_jobRowData` was specifically built for (JS Refactoring Finding 3, Rendering & Memory Finding 4, Data Layer Finding 4 — three independent reports converged on this).
2. Decompose `renderJobs()` from its current 370-line/57-call-site monolith into isolated stages: pure data-shaping → pure row template → diffed paint → conditional subsystem re-init (JS Refactoring Finding 1).
3. Migrate remaining status magic-strings to the `STATUS` constant (JS Refactoring Finding 4) as groundwork for item 2.

**Risk:** High — `renderJobs()` is the single most central function in the app's most important page. Must be done incrementally with a working, shippable state after every step, never as one large rewrite.

**Test plan:** Full regression pass across every test category in the QA report, run before and after each incremental extraction step — this phase is the reason a documented manual regression script (built during Phase 0) needs to exist and be kept current, since there's no automated suite to catch a silent behavioral change here.

**Why last:** the highest-value fixes for the *reported* problem (freezing/stuck) are Phases 0-2, and they're also the lowest-risk. This phase is what unlocks genuine partial/diffed re-rendering — valuable, but it's an enabler for future work (Phase 7) more than a direct fix for today's complaint.

---

## Phase 7 — Scale-triggered work (not scheduled yet, by design)

Per the Scalability estimate, do not build this speculatively. Instrument first (fetch time, rendered row count), then trigger each item below when real production numbers cross the documented thresholds:

1. Cap the default view away from unbounded `_jRange='all'` — trigger: ~1,000-2,000 rows.
2. Server-side date-range/status query scoping — trigger: ~2,000-5,000 rows or fetch time exceeding ~500ms.
3. DOM virtualization/windowed rendering — trigger: ~10,000-20,000 rows. This is the one fix with no substitute; everything else in this phase buys time before it becomes mandatory.
4. RLS query-plan optimization (subquery-wrapped auth calls, consolidated policies) — same trigger as item 2, and must be combined with the Phase 1 Finance-role RLS fix rather than done as a separate policy change.

**Risk:** Deferred, not assessed in detail here — will be scoped properly when triggered, since the right design depends on real usage patterns at that point, not assumptions made today.

---

## What ships when — summary

| Phase | What | Ships when |
|---|---|---|
| 0 | 7 independent confirmed-bug fixes | First, as its own release |
| 1 | Access control verification + enforcement | After Phase 0, pending your sign-off on the Finance-role spec |
| 2 | Enable Realtime + dependent fixes | Combined single release |
| 3 | Status-lock design + certificate/audit fixes | After your input on transition rules |
| 4 | UX/workflow improvements | Iterative, item 6 (keyboard grid nav) as its own sub-project |
| 5 | Accessibility remediation | Iterative, coordinate item 1/4 with Phase 4 item 6 |
| 6 | `renderJobs()`/cache architectural refactor | Incremental, only after 0-5 are stable |
| 7 | Scale-triggered fetch/render changes | Not scheduled — triggered by production instrumentation |

**Nothing in any phase has been implemented.** This plan is ready for your review — in particular Phase 1's Finance-role spec and Phase 3's status-transition rules need your decisions before implementation, since both are genuine business-rule questions the audits correctly identified but can't answer on their own.
