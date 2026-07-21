# CTO Security Review — Jobs Page — DeepFlow

**Purpose:** This is a synthesis, not a new audit. Five of the six task-force reports independently surfaced security-relevant findings while investigating performance/UX/correctness. This document pulls those together, adds the cross-cutting risk analysis a single-discipline audit couldn't see, and gives one prioritized remediation order. No new code was read beyond what the six reports already cite — every finding below traces back to a specific report and file:line.

---

## The core problem: every enforcement layer that matters is either missing or broken

Three completely independent audits (Data Layer, JS Refactoring, QA) each found a piece of the same underlying story from a different angle: **the Jobs page has no reliable enforcement boundary between "what a role is supposed to be able to do" and "what code will actually let them do."** No single report was looking for this — it fell out of unrelated investigations into RLS performance, escaping consistency, and status-transition bugs. That's the strongest possible signal that it's real and systemic, not a one-off.

| Layer | Status | Source |
|---|---|---|
| Database RLS (the only boundary that can't be bypassed client-side) | Present but flagged as security-sensitive — per-row auth re-evaluation, stacked permissive policies, **not verified to actually block Finance-role writes** | Data Layer Finding 8 |
| Application write-path checks (`saveJob`, `quickStatus`, delete, bulk actions) | **None exist at all** — no function checks `canEdit`/`canDelete` before executing | QA BUG-8 |
| UI-layer hiding (buttons disabled/hidden for restricted roles) | Present but broken — wrong element ID, applied once at login, undone by every one of the page's frequent re-renders | QA BUG-8 |

The practical consequence: **the Finance role's "read-only Jobs" restriction provides zero actual protection today.** A Finance-role user — or anyone with browser dev tools — can fully edit, delete, and bulk-modify jobs. Whether RLS independently saves this is unverified and is now the single most important open question in this review.

---

## Ranked findings

### 1. [CRITICAL] Silent data corruption via permission-gated field save — QA BUG-6

**What:** A user without full visibility (`seePrice`/`seeLandlord`/`seeLandlordPhone` gates) sees placeholder values (`0`, `"[Hidden]"`) in place of real data. If they save the job for *any* reason — even just changing the time slot — those placeholders get written back to Supabase as the real data, permanently destroying the actual price and landlord contact info.

**Why this belongs in a security review, not just a bug report:** this is what a broken permission boundary looks like in practice — restricting *visibility* without restricting *what the restricted view is allowed to write back* turns the safety mechanism into the corruption mechanism. This is the most severe finding across all six reports and is currently live in production.

**Action:** Exclude gated fields from the save payload entirely when the user lacks visibility into them — never write back a value the user never actually saw. Then audit existing job records for `price=0`/`landlord="[Hidden]"` that may already reflect corrupted, not real, data.

### 2. [CRITICAL] No enforcement layer actually restricts the Finance role — QA BUG-8, cross-referenced with Data Layer Finding 8

**What:** Covered above. Three independent gaps stack on top of each other with no single one providing real protection.

**Action, in order:**
1. **First**, determine via direct query/testing whether RLS policies on `jobs` actually block Finance-role writes today, independent of any client-side code. This is the only layer that can't be bypassed, so it needs to be verified (or fixed) before anything else here is trustworthy.
2. Add `canEdit`/`canDelete` checks to every write-path function as defense-in-depth — not as the primary protection, since client-side checks are always bypassable, but because they prevent *accidental* violations by legitimate UI flows and give honest users a clear "you can't do this" instead of a silent failure.
3. Fix the broken UI-layer lockdown (correct element ID, re-apply on every re-render) last — it's the cosmetic layer, valuable for UX but not for security.

### 3. [HIGH] Stored XSS via two independent unescaped interpolation points — QA BUG-7, JS Refactoring Finding 8

**What:** The address-cell hover tooltip injects `j.notes` and landlord/agent names into `innerHTML` unescaped (QA BUG-7). Separately, the Referrer column in the main row template is also interpolated unescaped (JS Refactoring Finding 8) — in the *same function* that correctly escapes contact-pill values a few lines away. Two different reports, investigating two different things, found two separate unescaped-interpolation sites in the same rendering code.

**Why two separate findings matter more than one:** inconsistent escaping discipline within a single function is a strong signal there are likely more instances neither report happened to look at. This is the basis for the audit recommendation below, not just the two known sites.

**Action:** Fix both known sites (wrap in the existing `escHtml()` helper already used elsewhere in the same functions — this is a mechanical, low-risk change). Then do a **dedicated one-time audit of every `innerHTML`/template-literal interpolation in the Jobs page rendering path** specifically looking for missing `escHtml()` calls — not a full app-wide audit, scoped to the Jobs page code the task force already reviewed, since that's where the pattern of inconsistency was actually observed.

### 4. [MEDIUM, verify before touching] RLS policies re-evaluate auth per-row and stack multiple permissive policies — Data Layer Finding 8

**What:** Already covered under Finding 2 above from the access-control angle. From a pure performance angle (the Data Layer report's original framing), per-row auth evaluation and stacked permissive policies also compound the cost of Data Layer Finding 1 (unscoped fetch) at scale.

**Action:** Do not touch as a performance-only change. When this is addressed, do it as one combined security-and-performance pass: consolidate stacked policies, wrap auth calls in subqueries per Postgres's standard RLS performance guidance, and use the same change to close the Finance-role gap from Finding 2. Fixing performance and security separately here risks two rounds of policy churn on a security-critical table instead of one reviewed one.

### 5. [LOW, but real] Realtime in-place patching silently drops fields, currently dormant — QA BUG-3

**What:** `updateRowInPlace()` only patches priority/status/engineer/timeSlot/price, dropping address/description/date changes silently. Not a security vulnerability in the traditional sense, but flagged here because it's a **data-integrity gap currently masked by the Data Layer report's Finding 2 (the `supabase_realtime` publication is empty, so this code path has never actually run in production).**

**Action:** Must be fixed in the *same rollout* as enabling the Realtime publication (Data Layer Finding 2), not after — enabling Realtime without this fix ships a newly-live staleness bug the moment it goes out, which is worse than the current state (never-live) since it would look like it's working while quietly showing stale data to some sessions.

---

## What this review deliberately does not re-litigate

- **Priority/contrast/keyboard-access findings from the Accessibility report** — real, but not security-relevant; left to the implementation plan on their own merits.
- **Bulk-action partial-failure UX (UX & Automation Finding 5)** — a reliability/UX gap, not an access-control one; the *data* it silently fails to update was already writable by that user, so nothing new is exposed.
- **The drag-listener leak (Rendering & Memory Finding 1)** — pure performance/correctness, no security dimension.

---

## Summary priority order for the implementation plan

1. QA BUG-6 (permission-gated save corruption) — fix immediately, independent of everything else.
2. Verify RLS actually enforces Finance-role restrictions on `jobs`; this determines how urgent the rest of QA BUG-8 is.
3. QA BUG-8 application-layer checks + UI fix.
4. QA BUG-7 + JS Refactoring Finding 8 (both XSS sites), plus the scoped interpolation audit.
5. Data Layer Finding 8 RLS consolidation, combined with the Finding 2/BUG-8 fix, not separately.
6. QA BUG-3, sequenced together with Data Layer Finding 2 (enabling Realtime).
