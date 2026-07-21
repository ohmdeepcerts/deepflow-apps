# 19 — Future Roadmap

A prioritised action plan, synthesising every recommendation made across this documentation set. For every item: the problem, its real-world impact, how hard it is technically, which files it touches, the risk of making the change (and, where relevant, the risk of *not* making it), a recommended implementation approach, and an estimated effort. Effort estimates assume one developer with full context on the relevant area (already reduced, thanks to this documentation set) and working against a live, small-scale dataset (per [05_Database.md](05_Database.md) Section 0) — treat them as planning estimates, not commitments. Source detail for every item is linked rather than repeated.

---

## CRITICAL — Fix Immediately

### C1. Lock down Storage write access
- **Problem:** anonymous upload, listing, and deletion are all currently possible against the entire Storage bucket, confirmed by direct, safe test. [15_Security.md](15_Security.md) §5.
- **Impact:** total, irreversible loss of every job photo/document the business has ever collected is possible today, by anyone, with no login and no technical skill beyond sending a few HTTP requests. This is the single most severe finding in the whole review.
- **Difficulty:** Low — a Supabase Storage policy change; no application code required.
- **Files affected:** None. Supabase dashboard (Storage policies) only.
- **Risk:** Low to fix, if scoped correctly and verified against real engineer uploads afterward. Severe and ongoing if left unfixed.
- **Recommended implementation:** Restrict `INSERT`/`UPDATE`/`DELETE` on `storage.objects` for the `deepflow` bucket to the `authenticated` role at minimum; ideally scope further so an engineer can only write under paths for jobs assigned to them. Re-run the exact safe test documented in [15_Security.md](15_Security.md) §5 afterward to confirm the fix.
- **Estimated effort:** 1–2 hours, including verification.

### C2. Revoke anonymous execute on `get_auth_users()`
- **Problem:** anyone can list every staff member's real email address and Supabase Auth ID with no login at all. [15_Security.md](15_Security.md) §3.4.
- **Impact:** direct staff privacy exposure and reconnaissance value for an attacker (a ready-made target list for phishing/credential-stuffing).
- **Difficulty:** Trivial — a single SQL statement.
- **Files affected:** None. Supabase SQL Editor only.
- **Risk:** None to fix — the Office App already only calls this function after a real login, so tightening it breaks nothing.
- **Recommended implementation:** `REVOKE EXECUTE ON FUNCTION get_auth_users() FROM anon; GRANT EXECUTE ON FUNCTION get_auth_users() TO authenticated;`
- **Estimated effort:** 15 minutes.

### C3. Verify UPDATE/DELETE database policies directly, on every table
- **Problem:** this review could not safely determine whether an anonymous visitor can modify or delete real rows in `jobs`, `users`, `invoices`, or `agencies` — the only method available for safe testing (a zero-match filter) is inconclusive by design. [15_Security.md](15_Security.md) §3.3.
- **Impact:** unknown until checked — this is the single largest remaining unknown in the entire security picture, and could range from "already fine" to "as severe as C1."
- **Difficulty:** Low for someone with real Supabase dashboard access — this is a lookup, not a build.
- **Files affected:** None.
- **Risk:** None to check. Risk of *not* checking is that a genuinely severe gap could remain undiscovered indefinitely.
- **Recommended implementation:** Review the Policies tab for every table directly in the Supabase dashboard, or query `pg_policies` in the SQL Editor with proper authorisation. Document the findings so this is never an open question again.
- **Estimated effort:** 2–3 hours (mostly review and documentation, given ~18 tables to check).

### C4. Apply consistent HTML output-escaping across the Office and Employee apps
- **Problem:** 326 unescaped `innerHTML` injection points in the Office App; 38 in the Employee App with no escaping mechanism defined anywhere in that file at all. [../AUDIT.md](../AUDIT.md) §8.4.
- **Impact:** any logged-in user — including the lowest-privilege role — can plant a script payload (in a job address, description, or note) that executes in a more privileged user's browser session the next time they view it. Combined with C1–C3, a successful injection could escalate well beyond the injecting user's own privileges.
- **Difficulty:** Medium — the fix pattern itself is simple (the app already has working `escHtml`/`_escHtml` helpers), but the number of call sites makes it time-consuming to apply thoroughly and verify nothing was missed.
- **Files affected:** `index.html`, `engineer.html`.
- **Risk:** Low, but this touches rendering code throughout both apps — do this with real regression testing (see [17_Testing_and_QA.md](17_Testing_and_QA.md)), not a rushed pass.
- **Recommended implementation:** Systematically apply the existing escaping helpers at every `innerHTML` injection point involving user-controllable data. Add a code-review checklist item (or, longer-term, a lint rule) to prevent regression once fixed.
- **Estimated effort:** 3–5 days for a careful, fully-verified pass across both files (not a quick find-and-replace, given the volume and the need to test each screen afterward).

### C5. Decouple `pinLock` from full permission bypass
- **Problem:** turning this one setting off disables both the login screen *and* every permission check in the app simultaneously — one flag, two critical effects. [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md) §3.
- **Impact:** an admin toggling this for a narrow, well-intentioned reason (e.g. a kiosk/demo setup) has no way to know they've also removed all access control system-wide — a silent, total authorization bypass.
- **Difficulty:** Low-Medium — requires separating two currently-fused code paths (`getUserPerm()`'s early return, and the login-check on startup).
- **Files affected:** `index.html`.
- **Risk:** Low — this is a narrowing of behaviour, not a feature removal, provided the "no login required" use case (if still wanted) is replaced with something equivalent but scoped.
- **Recommended implementation:** Make every permission check independent of `pinLock`. If a genuinely-no-login mode is still wanted for some deployments, have it assign a real, restricted role (e.g. Viewer, once fixed per M2) rather than bypassing the permission system entirely.
- **Estimated effort:** 1 day, including testing every role's behaviour with the setting both on and off.

---

## HIGH — Fix This Quarter

### H1. Fix the Employee App's settings-table mismatch
- **Problem:** the Employee App queries a table called `settings` for the office's WhatsApp number; the real data lives in `app_settings`, which it never queries. [../AUDIT.md](../AUDIT.md) §1.1.
- **Impact:** the "message the office" button always uses a hardcoded placeholder number instead of the real one — a real, live, user-facing bug.
- **Difficulty:** Trivial — one table/query name in one function.
- **Files affected:** `engineer.html` (`_loadOfficeSettings()`).
- **Risk:** Very low — a narrow, well-understood, single-function change.
- **Recommended implementation:** Point the query at `app_settings` with `key=eq.__all__`, matching the pattern already used correctly elsewhere in the same file and in `index.html`.
- **Estimated effort:** 30 minutes, including a manual test of the WhatsApp button afterward.

### H2. Restore or replace the Client Portal's request-submission write path
- **Problem:** live testing found anonymous `INSERT` into `engineer_requests` is currently blocked by the database. [15_Security.md](15_Security.md) §3.2.
- **Impact:** clients very likely cannot currently raise requests through the portal at all — a direct business impact (missed job requests), not just a technical one.
- **Difficulty:** Low — either loosen the specific `INSERT` policy for this one table, or (more in the spirit of C1–C3) build a narrow `SECURITY DEFINER` function that only allows creating a new pending request and nothing else.
- **Files affected:** None for the simple fix (Supabase policy); possibly `client-portal.html` if a dedicated function-based approach is chosen instead.
- **Risk:** Low if scoped to exactly this one table/action; avoid re-opening broader anonymous write access as a side effect.
- **Recommended implementation:** First confirm the break against the live app (a two-minute manual test); then apply the narrowest fix that restores the feature without widening anonymous write access elsewhere.
- **Estimated effort:** 2–4 hours, including confirmation and a real end-to-end test of a submitted request appearing in the Office App's Job Requests inbox.

### H3. Enforce (or remove) per-engineer visibility permissions
- **Problem:** configurable in the Office App (`engPerms`), never read anywhere in the Employee App. [../AUDIT.md](../AUDIT.md) §2.1.
- **Impact:** an admin who believes they've restricted sensitive information (price, landlord contact details) from a specific engineer has not actually done so — a false sense of access control.
- **Difficulty:** Medium — requires the Employee App to fetch this configuration (dependent on H1 being fixed first, since it lives in `app_settings`) and apply it across every relevant field in the job detail view.
- **Files affected:** `engineer.html`; depends on H1.
- **Risk:** Low-Medium — needs care to apply consistently across every field the setting is meant to cover, or the fix will itself be incomplete in a new way.
- **Recommended implementation:** After H1, extend the Employee App's job-loading logic to fetch `engPerms` for the current engineer and conditionally hide/show price, landlord, tenant, agent, notes, and invoice fields accordingly, matching exactly what the Office App's configuration UI promises.
- **Estimated effort:** 1–2 days, including testing every permission flag individually.

### H4. Add a debounce to the Command Palette
- **Problem:** the Command Palette's search box fires roughly 40+ full-table fetches for a typical search, with no debounce at all. [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) §6.1.
- **Impact:** currently a minor, invisible cost at the project's small live data scale; becomes a real, user-noticeable slowdown (and unnecessary Supabase load/cost) as the business's data grows.
- **Difficulty:** Trivial — the exact same debounce pattern already exists and works elsewhere in the same file (`debounceRenderJobs`).
- **Files affected:** `index.html`.
- **Risk:** Very low.
- **Recommended implementation:** Wrap the Command Palette's `input` handler in the same 200ms debounce pattern used for job search; consider also cancelling/ignoring stale in-flight searches superseded by a newer keystroke.
- **Estimated effort:** 1–2 hours.

### H5. Give the Client Portal a real, if lightweight, identity check
- **Problem:** access is granted purely by possessing a URL, with no verification step and no real link expiry despite the UI's wording implying one. [15_Security.md](15_Security.md) §1, §15.
- **Impact:** the sensitivity of what's exposed (invoices, contact details, compliance status) currently exceeds the strength of the access control protecting it.
- **Difficulty:** Medium — requires a new, small verification flow (e.g. a one-time code sent to a phone/email already on file for that client) rather than a large redesign.
- **Files affected:** `client-portal.html`; likely a new, narrowly-scoped Supabase function to check the code server-side.
- **Risk:** Medium — this changes a real user-facing flow for external clients, so needs to be rolled out carefully (e.g. with a grace period or clear client communication) to avoid locking out people who already rely on existing links.
- **Recommended implementation:** Add an optional one-time-code step before showing any data, gated behind a setting so it can be rolled out gradually; keep the existing link-based identity as the *first* factor, add the code as a second.
- **Estimated effort:** 3–5 days, including the small server-side function and client communication/rollout planning.

---

## MEDIUM — Plan for the Next Few Releases

### M1. Introduce a shared cache for tables beyond `jobs`
- **Problem:** 172 counted redundant full-table fetch call sites across 7 tables (`invoices`, `certs`, `persons`, `agencies`, `agents`, `payments`, `expenses`) with no caching at all. [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) §6.2.
- **Impact:** invisible today at small data scale; will directly slow down every heavy screen (P&L, Client View, Engineer Reports) as the business's data grows.
- **Difficulty:** Medium — the existing `_getJobs()`/`_jobCache` pattern (with explicit invalidate-on-write) is a proven, ready-made template to extend, since `dAll()` is already the single, unified access point for every table.
- **Files affected:** `index.html`.
- **Risk:** Medium — caching bugs (stale data shown after a write) are easy to introduce if invalidation isn't handled as carefully as the existing jobs cache does it.
- **Recommended implementation:** Generalise the jobs-cache pattern into a small, reusable cache keyed by table name, invalidated on any write to that table, wired into `dAll()` itself so every call site benefits without individual changes.
- **Estimated effort:** 3–5 days, including testing invalidation correctness across every screen that writes to a cached table.

### M2. Fix the `Viewer` role
- **Problem:** the permission-checking function denies a Viewer everything, but the nav-visibility function has no rule for Viewer at all, so it shows nothing — this role logs in to a completely blank app. [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md) §4.
- **Impact:** the role is currently unusable; anyone assigned it cannot do anything with the app at all, which is very unlikely to have been the intent.
- **Difficulty:** Low — add the missing nav-visibility branch, granting whatever read-only page set was originally intended.
- **Files affected:** `index.html` (`applyUserPermissions()`).
- **Risk:** Low.
- **Recommended implementation:** Decide what a Viewer should actually be able to see (a reasonable default: Dashboard, Jobs, Invoices, Directories, Certificates, all read-only), then add that as an explicit branch alongside the existing Admin/Manager/Finance/Staff logic.
- **Estimated effort:** 2–4 hours.

### M3. Clean up duplicate/unused database columns and tables
- **Problem:** ~15+ confirmed-unused columns across several tables, a confirmed-unused second `settings` table, and multiple tables referenced in application code that don't exist in the live database at all. [05_Database.md](05_Database.md), [../AUDIT.md](../AUDIT.md) §6.3.
- **Impact:** ongoing confusion risk for anyone new to the schema (this documentation set exists partly to prevent that, but a cleaner schema needs it less); no functional impact today since nothing reads these columns.
- **Difficulty:** Low-Medium — mostly safe removals, but each should be re-confirmed against a fresh code search before dropping, in case something outside the reviewed files depends on it.
- **Files affected:** Database schema only (Supabase SQL Editor); no application file changes expected.
- **Risk:** Low if each removal is individually verified unused first; do not batch-drop without checking.
- **Recommended implementation:** Work through the list in [05_Database.md](05_Database.md) table-by-table, confirm each column/table is genuinely unreferenced, then drop it in a single documented migration (see M5).
- **Estimated effort:** 1–2 days, mostly verification time rather than the drops themselves.

### M4. Add real foreign-key-based relationships, finishing what `client_person_id`/`client_agency_id` started
- **Problem:** most core relationships (job-to-landlord, job-to-agency) are fragile name-matches rather than ID references, even though the columns for a proper ID-based link already exist and are partially wired up. [05_Database.md](05_Database.md) §3.
- **Impact:** data-integrity risk that grows with client count — a typo or a client rename can silently split one client's history in two, with no error raised anywhere.
- **Difficulty:** High — requires both a data-migration step (backfilling the ID columns for every existing record by matching on the current name-based logic) and application-code changes across all three apps to write and read by ID going forward.
- **Files affected:** `index.html`, `engineer.html`, `client-portal.html`, plus the database schema.
- **Risk:** Medium-High — touches the core data model everywhere; needs careful staged rollout (backfill first, dual-write for a period, then cut over reads) to avoid breaking existing records mid-migration.
- **Recommended implementation:** Backfill `client_person_id`/`client_agency_id` for all existing jobs/invoices by running the current name-matching logic once, server-side; update every write path to populate the ID going forward; only then migrate read paths from name-matching to ID-matching, one screen at a time.
- **Estimated effort:** 2–3 weeks, given the scope across all three apps and the need for careful, staged testing.

### M5. Introduce a real migration system
- **Problem:** no schema version history exists anywhere — the live schema is only whatever has actually been run, by hand, over time. [07_SQL_Migrations.md](07_SQL_Migrations.md).
- **Impact:** no reliable way to reproduce the schema from scratch, no safe rollback path for a schema change, and no way to bring a new (e.g. staging) environment to the same state as production with confidence.
- **Difficulty:** Low-Medium to start (adopt the Supabase CLI's own migration tooling going forward); higher effort to retroactively reconstruct the *full* history of how the current schema came to be (may not be fully possible given no record exists).
- **Files affected:** A new `supabase/migrations` folder; no changes to the three application files.
- **Risk:** Low to adopt going forward; the retroactive reconstruction carries the risk of an incomplete/inaccurate picture of the past, which should be clearly labelled as "best effort" rather than authoritative.
- **Recommended implementation:** Snapshot the current live schema as migration "zero" (a baseline, not a true history), then require every future schema change to go through a tracked migration file from that point on.
- **Estimated effort:** 1–2 days to set up and snapshot the baseline; ongoing small effort (an hour or so) per future schema change thereafter.

### M6. Consolidate the duplicated Supabase connection layer
- **Problem:** the Supabase URL/key, fetch wrapper, and field-mapping logic are independently copy-pasted into all three apps, and have already been confirmed to have drifted apart in practice (H1 is a direct, live symptom of this). [../AUDIT.md](../AUDIT.md) §5.1.
- **Impact:** every future fix to this shared logic has to be manually, separately applied and tested in three places, with an ongoing risk of exactly the kind of drift already found.
- **Difficulty:** Medium-High — genuine code-sharing across three plain HTML files with no build tooling either requires adopting a minimal build step (a real architectural change, see [01_System_Architecture.md](01_System_Architecture.md)) or a strict manual-sync discipline backed by strong automated tests to catch drift immediately rather than after the fact.
- **Files affected:** `index.html`, `engineer.html`, `client-portal.html`.
- **Risk:** Medium — introducing a build step, even a minimal one, is a meaningful process change for a team used to editing these files directly; needs buy-in and a clear rollout plan (see [16_Deployment.md](16_Deployment.md)).
- **Recommended implementation:** Start with the lowest-risk option — a small, checked-in shared JavaScript snippet (connection setup, fetch wrapper, field mapping) that a lightweight build step (even just a simple concatenation script) injects into all three files at deploy time, without requiring a full framework adoption.
- **Estimated effort:** 1–2 weeks, including deciding on and setting up the chosen build approach and migrating all three apps to use it.

---

## LOW — Worth Doing, Not Urgent

### L1. Consolidate the duplicated invoice-status colour map
- **Problem:** two separate definitions of the same status-colour mapping exist and have drifted apart — the same invoice status can render a different colour depending which screen is showing it. [../AUDIT.md](../AUDIT.md) §3.1.
- **Impact:** a minor, cosmetic inconsistency, not a functional bug.
- **Difficulty:** Trivial.
- **Files affected:** `index.html`.
- **Risk:** Very low.
- **Recommended implementation:** Extract one shared constant and reference it from both locations.
- **Estimated effort:** 1 hour.

### L2. De-duplicate the 7×-repeated CSS block in the Employee App
- **Problem:** the same CSS rule set is repeated verbatim seven times (once per job-status colour variant) instead of written once. [../AUDIT.md](../AUDIT.md) §5.2.
- **Impact:** larger file size and a real risk of the seven copies silently drifting out of sync at the next style change.
- **Difficulty:** Low.
- **Files affected:** `engineer.html`.
- **Risk:** Low.
- **Recommended implementation:** Write the shared rules once, with only the colour-specific part varying per status class.
- **Estimated effort:** 2–3 hours.

### L3. Remove the dead custom-session code
- **Problem:** `_issueOfficeSession`/`_checkOfficeSession`, and their matching live database columns, are never called by anything. [../AUDIT.md](../AUDIT.md) §6.1.
- **Impact:** none functionally; a maintainability/clarity cost for anyone reading the code and wondering if this is active.
- **Difficulty:** Low.
- **Files affected:** `index.html`; the matching `session_token`/`session_expires` columns on `users` (see M3).
- **Risk:** Low — confirm via a final search that nothing calls these before removing.
- **Recommended implementation:** Remove the two functions; fold the column cleanup into M3.
- **Estimated effort:** 1–2 hours.

### L4. Add a smaller, thumbnail-sized image variant for grid contexts
- **Problem:** the same 1200px-max compressed photo is downloaded even when displayed in a small thumbnail grid. [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) §8.
- **Impact:** unnecessary data transfer, most noticeable on slower mobile connections viewing photo-heavy job lists.
- **Difficulty:** Low-Medium — the compression code already exists and runs at upload time; this adds a second, smaller output from the same step.
- **Files affected:** `engineer.html` (upload pipeline); `index.html` and `client-portal.html` (display, to use the new thumbnail where appropriate).
- **Risk:** Low.
- **Recommended implementation:** Generate a second, ~300px variant alongside the existing compressed image at upload time; store both paths on the `attachments` row; use the thumbnail in grid views and the full version in detail/lightbox views.
- **Estimated effort:** 1–2 days across the upload and display changes.

### L5. Cap "HD" photo uploads at a real, if generous, ceiling
- **Problem:** HD mode skips compression entirely, with no size limit at all. [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) §9.
- **Impact:** uncapped, compounding Storage cost and slow uploads on poor connections for any engineer who frequently uses HD mode.
- **Difficulty:** Low.
- **Files affected:** `engineer.html`.
- **Risk:** Low.
- **Recommended implementation:** Change the HD path from "skip compression" to "compress to a higher but still bounded ceiling" (e.g. 2500px / 90% quality) instead of no limit at all.
- **Estimated effort:** 1–2 hours.

### L6. Add a periodic cleanup pass for orphaned Storage files
- **Problem:** deleting a job does not delete its Storage files or `attachments` rows — they accumulate indefinitely. [09_Storage.md](09_Storage.md) §8.
- **Impact:** growing, unnecessary Storage cost over time, and a larger, slower "list everything" operation for any future admin tooling.
- **Difficulty:** Medium — requires a new, careful cross-check (files/rows with no matching live job) before any deletion, to avoid accidentally removing something still in use.
- **Files affected:** New tooling (could be a manual admin-panel button in `index.html`, or a separate script/scheduled Supabase function).
- **Risk:** Medium — any automated deletion tool touching Storage needs to be very conservative and well-tested, given C1's findings about how easily Storage data can currently be lost.
- **Recommended implementation:** Start as a manual, admin-triggered "find orphaned files" report (list only, no deletion) before ever adding an automatic delete step.
- **Estimated effort:** 2–3 days for the report-only version; further effort later if automatic deletion is added.

### L7. Load heavy third-party libraries only when needed
- **Problem:** `jsPDF`/`jsPDF-AutoTable` and the Lucide icon library are loaded unconditionally on every page load, even for sessions that never use PDF generation or need the full icon set. [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) §10.
- **Impact:** unnecessary download/parse cost on every visit, for a feature most sessions never use.
- **Difficulty:** Low — these are simple `<script>` tags; loading them on-demand (e.g. when a "Download PDF" button is first clicked) is a standard, well-understood technique.
- **Files affected:** `index.html`, `client-portal.html`.
- **Risk:** Low.
- **Recommended implementation:** Move the `<script>` tags for these libraries to be injected dynamically the first time a feature that needs them is used, rather than sitting in `<head>`.
- **Estimated effort:** 1 day, including testing that on-demand loading doesn't introduce a noticeable delay the first time a user clicks "Download PDF."

---

## FUTURE — Larger, Strategic Considerations

### F1. A genuine backend/server layer for the highest-stakes logic
- **Problem:** all business rules (invoice numbering, VAT, permissions) run entirely client-side, with no server-side re-verification anywhere in the system.
- **Impact:** the root cause behind a large share of the findings in [15_Security.md](15_Security.md) and [18_Known_Issues.md](18_Known_Issues.md) — anyone bypassing the UI entirely can currently ignore any rule the interface enforces.
- **Difficulty:** Very High — a genuine architectural shift for a project that has, by design, never had a backend.
- **Files affected:** Potentially all three apps, plus new server-side code (Postgres functions at minimum, or a real backend service).
- **Risk:** High if rushed; this should be approached incrementally, moving only the highest-stakes logic (payment recording, invoice numbering) first, not as a single big-bang rewrite.
- **Recommended implementation:** Start with the numbering race condition (Section 3 of [../SYNCHRONIZATION.md](../SYNCHRONIZATION.md)) as a contained pilot — move invoice/job/certificate numbering into a single atomic Postgres function, and use that project to build the team's confidence and tooling before tackling anything larger.
- **Estimated effort:** Several weeks for the pilot; ongoing, multi-month effort if pursued more broadly.

### F2. Accessibility investment
- **Problem:** no `aria-*` attributes, semantic landmark usage, or screen-reader support were confirmed anywhere across all three apps. [14_UI_Documentation.md](14_UI_Documentation.md) §5.
- **Impact:** the system is very likely unusable for anyone relying on assistive technology, most consequentially for the Client Portal given its external, non-technical audience.
- **Difficulty:** High — retrofitting accessibility into a large, already-built interface is more work than designing it in from the start.
- **Files affected:** All three apps, most urgently `client-portal.html`.
- **Risk:** Low to fix (accessibility improvements rarely break existing functionality), but requires dedicated, specialist effort to do well.
- **Recommended implementation:** Start with an accessibility audit against WCAG 2.1 AA on the Client Portal specifically, then prioritise fixes by how commonly each screen is used.
- **Estimated effort:** 2–4 weeks for the Client Portal alone; larger for all three apps.

### F3. A proper mobile-responsive Office App
- **Problem:** desktop-first design with no confirmed mobile breakpoints for its densest screens (the Jobs table, the 3-column job modal). [02_Office_App.md](02_Office_App.md) §5.5.
- **Impact:** currently limits office staff to desktop use; only relevant if the business wants staff to be able to work from a phone/tablet.
- **Difficulty:** High — the densest screens would need real layout rework, not just minor CSS tweaks.
- **Files affected:** `index.html`.
- **Risk:** Low to fix, but a significant time investment for uncertain business value unless there's a clear, stated need.
- **Recommended implementation:** Only pursue if there's a confirmed business need; if so, start with the Dashboard and Jobs screens (most frequently used) before the denser admin screens.
- **Estimated effort:** 3–6 weeks for genuinely solid mobile support across the main screens.

### F4. Automated testing investment
- **Problem:** no automated tests exist anywhere in the project. [17_Testing_and_QA.md](17_Testing_and_QA.md).
- **Impact:** every change carries an unquantified regression risk; several of the confirmed bugs in this documentation set are exactly the kind a basic test suite would have caught.
- **Difficulty:** Medium to start (the phased approach in [17_Testing_and_QA.md](17_Testing_and_QA.md) begins with manual checklists, no tooling required), higher for genuine automated coverage of the business-rule logic.
- **Files affected:** New test files/tooling; no changes to the three apps required to start (Phase 1 is process-only).
- **Risk:** Low — testing investment essentially never makes things worse.
- **Recommended implementation:** Follow the four-phase approach already laid out in [17_Testing_and_QA.md](17_Testing_and_QA.md), starting immediately with Phase 1 (manual QA checklist) at zero tooling cost.
- **Estimated effort:** Phase 1: 1 day to write the checklist, then ongoing per-release use. Phases 2–4: several weeks each, spread over multiple quarters.

### F5. Real monitoring and error tracking
- **Problem:** no error-tracking service, uptime monitoring, or usage analytics exist anywhere in this system. [16_Deployment.md](16_Deployment.md) §9.
- **Impact:** the team currently only learns about a production problem when a user reports it — there is no earlier warning system.
- **Difficulty:** Low — most error-tracking services (e.g. Sentry) integrate with a few lines of `<script>`, requiring no architectural change.
- **Files affected:** All three apps (a small snippet added to each).
- **Risk:** Low.
- **Recommended implementation:** Add a lightweight error-tracking snippet to all three apps as an early, cheap win, before investing in the larger items above — it will also help validate whether fixes like C4 (XSS) and H1–H2 (confirmed/suspected live bugs) are actually resolved in practice.
- **Estimated effort:** 1–2 days to integrate and configure across all three apps.

---

## Summary Table

| Priority | Items | Typical effort range |
|---|---|---|
| Critical | C1–C5 | 15 minutes – 5 days each |
| High | H1–H5 | 30 minutes – 5 days each |
| Medium | M1–M6 | 2 hours – 3 weeks each |
| Low | L1–L7 | 1 hour – 3 days each |
| Future | F1–F5 | Several weeks – multiple months each |

## Cross-Reference Index

Every item above traces back to full detail in: [../AUDIT.md](../AUDIT.md), [15_Security.md](15_Security.md), [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md), [05_Database.md](05_Database.md), [07_SQL_Migrations.md](07_SQL_Migrations.md), [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md), [09_Storage.md](09_Storage.md), [17_Testing_and_QA.md](17_Testing_and_QA.md), and [18_Known_Issues.md](18_Known_Issues.md).
