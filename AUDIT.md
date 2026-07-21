# DeepFlow — Professional Software Audit

Scope: all four files (`index.html`, `office.html`, `engineer.html`, `client-portal.html`) plus the live Supabase project they connect to. This audit only **finds and explains** issues — per instruction, nothing has been fixed or changed. Severity is rated **Critical / High / Medium / Low**, based on realistic impact given how this system is actually used (a small, real, live business — see the Database Handbook for confirmed row counts).

Many of these findings were already surfaced individually while producing the four companion documents (Architecture, Workflows, Database Handbook, Business Rules, Synchronization); this audit consolidates them alongside a number of new findings (particularly around XSS exposure, a genuine performance bug, and literal code duplication) into one single, categorised list, cross-referencing the earlier documents rather than re-explaining what they already cover in full.

---

## 1. Bugs

### 1.1 — Engineer app reads the wrong settings table (`settings` instead of `app_settings`) — **High**
`engineer.html`'s `_loadOfficeSettings()` queries a table literally named `settings` to find the office's WhatsApp contact number. The real, working settings blob lives in a *different* table, `app_settings`, under key `__all__`. Confirmed live: `settings` exists and is empty; `app_settings` holds the real data. **Why it exists:** almost certainly a naming drift — the developer likely renamed the settings table at some point in the Office app's evolution and never updated the equivalent lookup that was separately hand-written into the Engineer app (these two apps do not share code, per Section 5). **Effect:** the "message the office" WhatsApp button in the Engineer app silently always uses a hardcoded placeholder number (`447700000000`) instead of the real one.

### 1.2 — Storage dashboard queries a table that doesn't exist (`certificates` instead of `certs`) — **Low**
The Office app's admin-only Storage Usage panel counts rows in a table called `certificates` for a summary statistic. The real table, used everywhere else in the app, is `certs`. Confirmed live: `certificates` returns "table not found." **Why it exists:** same class of bug as 1.1 — a naming inconsistency introduced at some point and never caught, because the failure is silent (wrapped in error-swallowing code) and cosmetic (one number on an admin-only panel), so it was never visibly "broken" to anyone using the app normally.

### 1.3 — Duplicate, inconsistently-used columns on `invoices` — **Medium**
The live `invoices` table has **both** `job_id` and `jobid`, **both** `desc` and `description`, and **three** different address-like fields (`jobaddr`, `jobaddress`, `propertyaddress`) that all mean roughly "the job's address." The application code was found to consistently use `jobid`/`description`, but which of the three address fields gets populated depends on *which specific invoice-creation code path* was used (`autoInvoice` vs. `createInvFromJob` vs. `createStandaloneProforma` were not found to be perfectly consistent with each other). **Why it exists:** evidence of the invoice feature being extended/reworked multiple times over the project's life, with new fields added alongside old ones rather than the old ones being cleaned up. **Effect:** a report or query that only checks one of these address columns risks silently missing invoices that were created via a different code path.

### 1.4 — `agencyaddr` vs `agencyaddress` on `jobs` — **Low**
Same class of issue as 1.3, on the `jobs` table this time — two columns for what appears to be the same piece of data, live-confirmed to both exist. Likely origin: identical to 1.3.

### 1.5 — Two invoice designs coexisting in the same table — **Medium**
Live-confirmed flat columns (`qty`, `unit`, `subtotal`, `total`, `vat_rate`, `vat_amount`, `paid_amount`) exist on `invoices` alongside the `items` JSON array the application code actually uses for every invoice's real line items and totals. **Why it exists:** these flat columns look like the *original* invoice design (one line item per invoice, stored as plain columns) that was superseded by the current multi-line-item `items`-array design, without a migration ever running to either backfill or remove the old columns. **Effect:** any external tool, report, or future developer who queries `invoices.total` directly (a very natural thing to try) will get **nothing useful**, because the real total is only ever computed live, client-side, from `items` — this is a trap waiting for the next person who works on this database without reading this audit first.

---

## 2. Hidden Bugs

These don't fail loudly — they fail silently, which is what makes them dangerous: the feature *looks* like it works (no error shown to the user), but it never actually does anything.

### 2.1 — Per-engineer visibility permissions have zero effect — **High**
An Admin can toggle, per individual engineer, whether they're allowed to see price/landlord/tenant/agent/notes/invoice info (Settings → the `engPerms` configuration, Business Rules document Section 1.12). Confirmed by full-text search: `engineer.html` never reads `engPerms` anywhere. An admin who configures this — believing they've restricted what a specific engineer can see — has changed nothing about what that engineer's app actually shows them. **Why it exists:** this has every appearance of a feature where the *configuration UI* was built first (in the Office app), with the *enforcement* (in the Engineer app) either never finished or lost somewhere along the way — the setting is saved correctly, stored correctly, and simply never consumed.

### 2.2 — Three "reads from a table that was never created" features — **High**
`client-portal.html` reads a `ratings` table (job star-ratings); `index.html` reads `invoice_audit` and `invoice_payments` (the per-invoice audit-trail timeline). All three tables were confirmed **not to exist** on the live project. Every one of these reads is wrapped in `.catch(()=>[])`, so no error is ever shown — the relevant UI (star ratings on the client portal, the invoice audit-trail panel) simply renders as permanently empty, forever, with nothing to indicate anything is wrong. **Why it exists:** these look like features whose *database migration* was written and documented (or assumed) but never actually run against the live project — the application code was written to assume tables that were, at best, planned and never followed through on.

### 2.3 — `pinLock` being off doesn't just skip login — it disables every permission check — **Critical**
Covered in depth in the Business Rules document (Section 1.1), restated here because it is genuinely a hidden bug, not just a design choice: `getUserPerm()` — the function every single permission check in the app funnels through — has an early return of `true` for *any* permission, for *any* user, the instant `S.pinLock` is falsy. An admin toggling this setting off, believing they're only removing a login prompt for convenience (e.g. for a kiosk/demo setup), has actually also silently granted every visitor full edit/delete/finance/invoice permissions regardless of role. **Why it exists:** the permission function was almost certainly written with "if there's no login system active at all, don't bother gatekeeping either" as a reasonable-sounding simplification, without considering that `pinLock` might be toggled independently in a system that otherwise still has real, differentiated user roles configured.

### 2.4 — The "Viewer" role logs in to a blank app — **Medium**
Also covered in the Business Rules document (Section 1.3). `getUserPerm()` explicitly handles a `Viewer` role (always denying every permission), but the separate nav-visibility code (`applyUserPermissions()`) has no branch for `Viewer` at all — it only explicitly re-enables navigation for Admin/Manager/Finance/Staff. A Viewer-role user passes login successfully and lands on a sidebar with nothing in it. **Why it exists:** the two halves of the role system (the permission-checking function, and the nav-visibility function) appear to have been written or updated at different times, and Viewer support was added to one without being added to the other.

### 2.5 — Scheduled certificate reminders look "installed" but aren't running — **Medium**
The `cert_reminder_log` table exists live (confirmed), which would lead an admin skimming their table list to assume the optional scheduled-reminder feature (documented at length in the Office app's own Settings panel) is active. It is not: the Postgres function that would actually populate that table, `send_cert_reminders()`, is confirmed **not installed**. **Why it exists:** the admin appears to have run only part of the multi-step setup SQL provided in the app (the table-creation step), not the function-creation or `pg_cron` scheduling steps — a very easy thing to do when a setup guide has several sequential SQL blocks and it's not obvious from the UI which ones have actually been run.

---

## 3. Race Conditions

### 3.1 — Human-readable numbering (jobs, invoices, certificates, client-request references) is not atomic — **Medium**
Every one of these numbers is generated the same way: read every existing record with the relevant prefix, find the highest number, use "highest + 1." This is a classic **read-then-write race**: if two people (or two apps — see Synchronization document, Scenario 8.10) trigger this at nearly the same moment, both reads can happen before either write completes, and both can independently compute the same "next" number. **Why it exists:** this avoids needing a real database sequence or a server-side function, which fits the project's overall "no custom backend, everything in the browser" design — but it trades that simplicity for a genuine, if statistically rare in a small business's usage pattern, chance of two records sharing the same human-facing number.

### 3.2 — Automatic invoice creation's duplicate-prevention check is "look, then leap" — **Medium**
`autoInvoice()` checks whether an invoice already exists for a job, and only creates one if not — but the check (`GET`) and the write (`POST`) are two separate network calls, not one atomic database operation. **Why it exists:** same root cause as 3.1 — no server-side logic exists to make this check-and-write a single atomic unit, because there is no server-side logic in this system at all, by design.

### 3.3 — Full job-form saves can silently overwrite a concurrent edit — **High**
Documented in depth in the Synchronization document (Section 4, Scenario 8.4). Unlike the smaller, targeted status-change updates, saving the whole job-edit form sends **every** field, overwriting whatever is currently in the database — including fields the *saving* user never touched, if their copy of the form was loaded before someone else's more recent change. **Why it exists:** the app has a real-time warning mechanism (a banner appears if someone else changed a job you have open), but that warning is advisory only — nothing was built to actually merge two sets of changes, or to block a stale save, which would require either optimistic-concurrency version checking or field-level diffing that this design doesn't have.

### 3.4 — Job IDs are generated independently and inconsistently by two different apps — **Low**
The Office app generates a random UUID for every new job; the Engineer app's own "Add New Job" feature generates a different, custom string format (confirmed live via Storage folder names, e.g. `job-eng-<timestamp>-<random>`). This isn't a race condition on its own, but it **compounds** 3.1: because two different ID-generation strategies are running independently and never coordinate, there is no shared mechanism (like a single sequence) that could ever have prevented the numbering collision described in 3.1, even in principle.

---

## 4. Broken Logic

### 4.1 — No status state machine anywhere — **Medium**
Covered fully in the Business Rules document (Section 2.2). Both job status and invoice status can move to *any* other value from *any* current value — there is no rule preventing a `Cancelled` job from being set back to `Pending`, or a `Paid` invoice from being set back to `Draft` through the general edit path. **Why it exists:** implementing a real state machine (a table of "which transitions are actually valid") is meaningfully more work than a single dropdown/PATCH, and the app instead relies entirely on staff using good judgement in the interface — which works until someone (accidentally or otherwise) picks the "wrong" option.

### 4.2 — Financial figures are presented as facts but are actually estimates — **Medium**
Documented in the Business Rules document (Sections 10.1–10.3). The P&L Dashboard's wage-cost figure uses a flat rate per completed job, not actual logged hours; the payslip calculator assumes exactly 4 hours per job when only an hourly (not day) rate is configured; the VAT-quarter report only ever totals output VAT, never input VAT, despite the screen implying a "Net VAT Due" figure. **Why it exists:** these all look like reasonable placeholder logic written to get a first version of each report working, using the simplest available inputs, without a follow-up pass to wire in the more precise data (actual hours, real input-VAT-from-expenses) that the system does actually otherwise track elsewhere.

### 4.3 — Duplicate certificate detection is per (job, type), not per property — **Low**
A certificate is only blocked from being duplicated if the *same job* already has one of that type. If a second, unrelated job is later created at the *same property* and also matches the same certificate keywords, a second, separate, possibly-overlapping certificate will be created for that property without anything cross-checking the property's existing valid certificate. **Why it exists:** because properties are not a real, queryable table (they live inside a settings blob — Architecture document Section 8.3), there is no efficient way for the certificate-creation logic to even ask "does this property already have a valid certificate of this type," so the check was scoped down to what's actually easy to check: the current job only.

### 4.4 — Fuzzy address matching can both under- and over-match — **Low**
Covered in the Business Rules document (Section 6.4). Matching the first ~20 characters of an address is simultaneously too loose (two different flats at the same building number can match each other) and too strict (a genuinely identical property with a slightly different address format, e.g. leading vs. no leading "Flat," would fail to match). **Why it exists:** a pragmatic compromise, given that properties aren't a real linked table (4.3) and there was no proper address-normalisation step built.

---

## 5. Duplicate Code

### 5.1 — The entire Supabase connection layer is copy-pasted three times, not shared — **High**
Documented at length in the Architecture document (Section 9). The Supabase URL/key, the `fetch()` wrapper, and the camelCase-to-database-column field-mapping tables are independently hand-written into all three HTML files. **Why it exists:** there is no build tooling in this project (no bundler, no shared module system) — the entire codebase is plain static HTML files with no import mechanism between them, so "copy the relevant chunk of JavaScript into the new file" was the only realistic option available for reusing this logic without introducing a build step. **Consequence, already observed, not hypothetical:** the three copies have already drifted apart — the Office app's field-mapping table is more complete than the Engineer app's smaller, separately-maintained one, and (Finding 1.1) the two apps don't even agree on the settings table's name anymore.

### 5.2 — Verbatim-duplicated CSS block, repeated 7 times, in `engineer.html` — **Low**
The exact same CSS rule set — `.job-quick-row`, `.jq-btn`, `.jq-green`, `.jq-blue`, `.jq-red`, `.jq-map`, `.ptr-spinner` — appears **seven separate times**, character-for-character identical, once for each job-status colour variant (`.job-card.s-pending .job-quick-row{...}`, `.job-card.s-progress .job-quick-row{...}`, etc.), instead of being written once as a shared rule with the colour-specific part isolated. **Why it exists:** looks like a copy-paste-per-status-variant pattern during development (probably: get one status's card styled, copy the whole block, tweak one colour, repeat) that was never consolidated afterward. **Effect:** purely a maintainability/file-size issue — any future style change to these shared elements needs to be made in seven places to stay consistent, and it would be very easy to update six of the seven and miss one.

### 5.3 — The core job-lifecycle rules (auto-cert, auto-invoice) exist only inside the Office app — **Medium** (related duplication-avoidance risk, not literal duplication)
Not literal duplicate code, but the inverse problem worth flagging alongside it: because `onJobComplete()` only exists in `index.html`, a job marked Completed from the Engineer app only triggers the automatic certificate/invoice chain because the Office app happens to be watching the `jobs` table via Realtime and reacts to the change. **If no Office-app browser tab is open anywhere when an engineer completes a job, none of this automation runs at all** until an Office tab is next opened and this specific completed-but-unprocessed condition happens to be caught by something (there is a manual "catch-up" bulk action for exactly this, per the Workflows document, A2.17 — its existence is itself evidence this gap was noticed).

---

## 6. Dead Code

### 6.1 — `_issueOfficeSession` / `_checkOfficeSession` — a whole session system that is never called — **Medium**
Confirmed by exhaustive search: these functions read/write a custom 12-hour session token to `localStorage`, and matching `session_token`/`session_expires` columns exist live on the `users` table — but nothing anywhere in `index.html` actually calls either function. **Why it exists:** clear evidence of an earlier, abandoned attempt at building custom session management, later superseded by relying on the Supabase Auth library's own built-in session handling, with the old code (and its matching, still-live database columns) never removed.

### 6.2 — A second, parallel certificate-expiry-prompt flow that the main flow bypasses — **Low**
`promptNextCertExpiry()` / `saveCertExpiry()` / `skipCertExpiry()` and their associated modal (`mo-cert-expiry`) implement an interactive, one-certificate-at-a-time "what's the expiry date?" flow. The actual, currently-used job-completion path (`onJobComplete()`) creates matching certificates silently and automatically, using a calculated default expiry, without ever opening this modal. **Why it exists:** looks like an earlier, more manual design ("ask the office for each certificate's expiry") that was replaced by the fully-automatic version, with the older interactive code and its modal left in place rather than removed.

### 6.3 — Unused database columns present across almost every table — **Low**
Consolidated list, all confirmed live and confirmed unreferenced by any application code: `jobs.checkin_time`, `checkout_time`, `checkin_location`, `client_signature`, `engineer_signature`, `portal_token`, `invoice_id`; `agencies.portal_token`, `portal_enabled`, `last_portal_access`; `users.session_token`, `session_expires`, `is_protected`, `internal_email`; `invoices.isagency`, `pdf_url`, plus the flat invoice columns from Finding 1.5. **Why it exists:** each of these looks like the schema half of a feature that was started (clock-in/out with GPS, digital signatures, token-based rather than ID-based portal links, server-tracked sessions, per-record portal-access toggles) and never finished on the application side — the database was extended ahead of the code that would have used it, and that code was never written.

---

## 7. Memory Leaks

Being direct about the limits of this section: a full-session memory-profiling pass (actually running the apps for an extended period while watching heap growth) was not performed — this audit is based on static code review. No confirmed, unbounded memory leak was found. What follows are the specific patterns closest to leak-shaped risk, assessed honestly rather than overstated:

### 7.1 — Long-lived timers are present for the entire session, by design — **Low**
The Office app's job-draft-autosave `setInterval` (every 5 seconds) and the polling-fallback `setInterval` (every 5 seconds when Realtime is down) both run for as long as the tab is open. Neither was found to be a true leak — the fallback poller is explicitly cleared when Realtime reconnects, and the autosave timer does cheap, bounded work each tick (checking whether a specific modal is open). This is a legitimate design pattern, not a bug — flagged here only because "a timer that runs for the whole session" is the first thing worth checking for leak-shaped behaviour, and it was checked.

### 7.2 — Interval-creation guards exist, but not proven exhaustive — **Low**
The Engineer app explicitly guards against creating duplicate background intervals if its startup function is somehow called more than once (`_intervalsStarted` flag), and the Office app's Realtime reconnect logic clears its polling interval before creating a fresh one. These guards were found in every interval-creation path checked, but a full audit of *every* `setInterval`/`setTimeout` call in a 22,000-line file for a similar guard was not exhaustively completed — this is flagged as a "verify if problems are ever observed in practice" item rather than a confirmed issue.

### 7.3 — Full-table client-side caches grow with the business, not with usage — **Low/Medium**
`dAll()` fetches *every* row of a table into browser memory (paginating in chunks up to a 50,000-row safety cap) any time a screen needs to search/filter/aggregate across a whole table (jobs, invoices, persons, etc.). This isn't a "leak" in the classic sense (memory is released when the page is closed/refreshed), but it means the Office app's real-world memory footprint will grow directly in proportion to how much data the business accumulates over time, with no pagination or windowing on the client side — a business with tens of thousands of historical jobs would load meaningfully more data into every browser tab than one with a few hundred.

---

## 8. Security Issues

This is the most consequential section of this audit. Full technical detail on 8.1–8.3 is in the Database Handbook (Sections 1, 9, 10); they're restated briefly here for completeness, with two **new** findings (8.4, 8.5) not covered elsewhere.

### 8.1 — `get_auth_users()` is callable by anyone, with no login — **Critical**
Confirmed live: calling this function with only the public anon key (present in every copy of the app's source code) returns the full list of every Supabase Auth account's real email address and internal ID, with no authentication required at all.

### 8.2 — Every database table is fully readable by anyone, with no login — **Critical**
Confirmed live across every table tested, consistent with the "allow_all" policy pattern documented in the app's own admin panel.

### 8.3 — The Client Portal has no authentication mechanism of any kind — **High**
Access is granted purely by knowing (or guessing, or having forwarded to you) a database ID in a URL. No password, no one-time code, no expiry.

### 8.4 — Widespread unescaped HTML injection (stored XSS exposure) — **Critical — new finding**
Across `index.html`, dynamic content — job addresses, descriptions, notes, client/landlord/agent names — is interpolated directly into HTML template strings that are then assigned via `innerHTML`, in the **overwhelming majority** of cases, with **no escaping applied**. Measured directly: 326 `innerHTML=` assignments in `index.html` against only 10 calls to its one escaping helper function. `engineer.html` is worse still: 38 `innerHTML=` assignments and **zero** escaping helper function defined anywhere in the file — it has no HTML-escaping mechanism at all. `client-portal.html` is comparatively better disciplined (55 calls to its escaping function against 24 `innerHTML=` assignments), though this was not verified to be complete either.

**Why this is Critical, not just a code-quality nit:** any text field a user can type — a job address, a description, a note — that later gets rendered on someone else's screen through one of these unescaped paths becomes a place a malicious `<script>` or `onerror=`-style payload could execute in **another user's already-logged-in browser session**. Given that Supabase Auth's session token is stored in the browser's own storage (as it is for every Supabase app, by design), a successful injection reaching an Admin's session could be leveraged toward session/token theft. The realistic path into this isn't exotic: **any** logged-in Office user — including the lowest-privilege `Staff` role, or a compromised/shared login — can type into a job's address or notes field, and have it rendered, unescaped, on an Admin's screen the next time that Admin opens the same job. Combined with 8.2 (anyone can already read the database directly) and 8.3 (the Client Portal has no login), the overall picture is that this system currently has very few layers of defence stacked on top of each other — a weakness in one layer is not well contained by the others.

**Why it exists:** the app was built using raw JavaScript template strings and `innerHTML` throughout (a common, fast way to build UI without a framework), and output-encoding discipline was applied inconsistently rather than systematically — likely added ad hoc, in the specific places a problem was noticed (e.g. the comment-thread feature, which does have escaping), rather than as a rule applied everywhere by construction.

### 8.5 — Hardcoded credentials and privileged email addresses shipped in client-side source — **Medium — new finding**
The Supabase anon key (expected/normal, see Architecture document) and the `EMERGENCY_ADMINS` list of protected email addresses (Business Rules document, Section 1.10) are both plain, readable text in every copy of the Office app's HTML source. **Why it exists:** there is no build step or secrets-management system in this project (Architecture document, Section 5) — there is nowhere else for either of these to live, given the "static files only, no server" architecture. The anon key being public is an accepted, standard part of how Supabase works; the emergency-admin email list being equally public and equally readable to anyone who views the page source is a narrower, self-inflicted exposure that a determined attacker could specifically target (e.g., attempting to compromise those exact known-privileged accounts via other means, like credential-stuffing or phishing, now that their emails and "protected" status are known).

---

## 9. Performance Issues

### 9.1 — The command palette re-fetches five entire tables on every keystroke — **High — new finding**
Confirmed directly: the job-search box has a proper 200ms typing debounce; the **command palette search box does not** — its `input` event handler calls `renderCmd(this.value)` immediately, with no debounce at all. Once the typed query is longer than one character, `renderCmd()` runs a full `await dAll(...)` (fetch every row) against `jobs`, `persons`, `invoices`, `expenses`, and `certs` — five separate complete-table network round-trips — on **every single keystroke**. Typing a normal 10-character search term fires roughly 40+ full-table fetches in quick succession. **Why it exists:** the job-list search evidently had a debounce added to it at some point (the function is even named `debounceRenderJobs`, suggesting deliberate attention), while the newer or less-frequently-touched command palette search was not given the same treatment — a straightforward oversight rather than a deliberate design choice, given the debounce pattern already exists elsewhere in the same file and simply wasn't applied here too.

### 9.2 — No pagination on the client side for large tables — **Medium**
As covered in Section 7.3: every screen that needs to search or summarise a table loads that entire table into the browser first. This currently performs fine at the project's confirmed live scale (single-digit-to-low-double-digit rows per table) but has no built-in ceiling as the business grows, beyond the hard 50,000-row safety cutoff in `dAll()`.

### 9.3 — Every settings change re-saves the entire settings blob — **Low**
Because all configuration lives in one JSON object under one database row (Architecture document, Section 8.3), changing a single toggle in Settings triggers a full re-serialise-and-save of the *entire* settings object — company info, every certificate type, every WhatsApp template, the whole properties list, and all engineer permission overrides — even though only one value actually changed. At current scale this is a negligible cost; it would become a more noticeable and more collision-prone (Section 3) cost as the properties list and other settings-blob content grows.

### 9.4 — Large, monolithic files with no lazy loading — **Low**
`index.html`/`office.html` are 1.3MB each, containing the markup, styling, and logic for every single screen in the Office app, all downloaded and parsed up front before anything is shown — there is no per-page code-splitting (nor could there easily be, given the single-file, no-build-tool architecture). In practice this is mitigated by browser caching after the first load, but the very first load for any new user/device is meaningfully heavier than it would be in an app that only loads what's needed for the screen currently being shown.

---

## 10. UI Problems

### 10.1 — Three visually inconsistent design systems, one per app — **Low**
Each of the three apps defines its own independent set of CSS custom properties, its own colour palette, its own font choices (the Office app uses "Familjen Grotesk" + "JetBrains Mono"; the Engineer app uses "DM Sans" + "JetBrains Mono" + "Orbitron"; the Client Portal uses "Inter"), and its own component styling conventions, with no shared design-system file between them (impossible to share anyway, given Section 5.1's no-shared-code constraint). **Why it exists:** natural consequence of building three independent files with no shared foundation — each was styled to look good on its own, not necessarily to visually match its siblings, and a user who moves between, say, the Office app and a Client Portal preview would notice they don't feel like "the same product."

### 10.2 — The literal CSS duplication in Finding 5.2 is also a UI-consistency risk, not just a code smell
Because the same visual rule exists in seven separate places rather than one, it's entirely possible for these to already be (or to silently become, at the next edit) subtly inconsistent with each other across job-status colour variants, without anyone necessarily noticing during a quick visual check.

### 10.3 — A logged-in role (`Viewer`) with a completely blank interface — **Medium**
Restated from Finding 2.4 as a UI problem in its own right: regardless of the underlying permission-logic cause, the *visible result* is a user who successfully logs in and is presented with an application that appears to contain nothing at all — no error message, no explanation, nothing — which is a poor first impression for whatever this role was originally intended to represent (most likely, a genuine "look but don't touch" read-only user).

---

## 11. UX Problems

### 11.1 — Data typed while offline can be silently lost — **High**
Covered in the Synchronization document (Section 8.2). If a save fails because the device has no connection, the data is simply gone — there is no offline queue, and (outside of the narrower job-draft-autosave feature) no guarantee the typed content survives a page refresh. The only warning a user gets is an "Offline" badge and a toast *at the moment of failure* — nothing actively protects their typed work before that point.

### 11.2 — The Client Portal never tells a client their view is stale — **Medium**
Covered in the Synchronization document (Section 8.6). A client can have the portal open for an extended period while the underlying data changes (an invoice gets marked paid, a new certificate is issued) with absolutely no on-screen indication that what they're looking at might be out of date — no "last updated" timestamp, no "refresh for the latest" prompt.

### 11.3 — A broadcast alert can expire before an offline recipient ever sees it, with no visibility into that having happened — **Medium**
Covered in the Synchronization document (Section 8.9). The one-hour expiry clock starts at send time, not view time. An engineer who was out of signal for the relevant window simply never receives that alert and has no way to know one was ever sent and missed.

### 11.4 — "Advisory" conflict warnings that don't actually prevent data loss — **Medium**
Restated from Finding 3.3 as a UX problem: the system *tells* a user someone else just changed the record they're editing, which sounds like a safety feature, but then does nothing to stop them from saving over that change anyway — arguably worse than no warning at all, in the sense that it can create false confidence that the system "has this handled."

---

## 12. Database Issues

Full detail already in the Database Handbook — summarised here for completeness of this audit:

- No enforced foreign keys for the great majority of relationships; almost everything links by matching text names instead (Database Handbook Section 4).
- No confirmed indexes beyond one, documented but of unverified live status (Database Handbook Section 6) — a real forward-looking performance risk as tables grow, given how much of this system's functionality depends on text search/filtering across `jobs`, `persons`, and `invoices`.
- No triggers and no views (Database Handbook Sections 7–8) — every piece of "automatic" behaviour depends entirely on a browser tab being open and running the relevant JavaScript; there is no server-side guarantee of data consistency.
- No migration history of any kind (Database Handbook Section 14) — the current schema exists only as whatever has actually been run, by hand, over time, with no way to reliably reproduce it from scratch or know its full history.
- Duplicate/unused columns across almost every table (this audit's Findings 1.3–1.5, 6.3).

---

## 13. Supabase Issues

Also detailed in the Database Handbook — summarised here:

- Permissive `allow_all`-style Row Level Security on effectively every table, confirmed live (Section 8.1–8.2 above).
- A privileged RPC function (`get_auth_users`) callable by the unauthenticated `anon` role (Section 8.1 above) — the single most urgent finding in this entire audit.
- Three of the five documented "optional setup" SQL functions were never actually installed on the live project (`create_confirmed_user`, `send_cert_reminders`, `exec_sql`), meaning several features described in the app's own admin panel as available are not currently functional (Database Handbook Section 9, this audit's Finding 2.5).
- General bucket-listing is restricted to privileged roles, but listing the *contents* of a specific, known bucket name is not — a minor, inconsistent security posture (Database Handbook Section 11).

---

## 14. Storage Issues

### 14.1 — No cascade cleanup when a job is deleted — **Medium**
Covered in the Synchronization document (Section 6). Deleting a job does not delete its attached photos, either from the `attachments` table or from the underlying Storage files — they become permanently orphaned, taking up storage space indefinitely with no interface path left to find or clean them up (short of the admin-only Storage Usage dashboard, which itself has the bug described in Finding 1.2).

### 14.2 — No file-type or file-size validation before upload — **Low**
The upload pipeline (Engineer app) applies compression to recognised image types and gracefully falls back to uploading the original file unmodified for anything it can't process (e.g. HEIC images, or non-image documents) — but nothing was found actively restricting *what* can be uploaded (file type allow-list) or enforcing a maximum size for non-compressed files, before the file is sent to Storage.

### 14.3 — Public file URLs with no per-file access control — **Low**
Every uploaded photo/document is reachable via a public URL pattern once its exact path is known, with no additional authentication step — consistent with how the apps display images directly in `<img>` tags, but meaning file confidentiality relies entirely on the randomness/obscurity of the generated filenames, not on any real access control.

---

## 15. Synchronization Issues

Fully detailed in the standalone Synchronization document — the highest-impact items, summarised here for completeness of this audit:

- No offline write queue anywhere in the system — a failed save due to lost connectivity is simply lost, not retried (Synchronization document Section 7, this audit's Finding 11.1).
- Realtime coverage is limited to a single table (`jobs`) in a single app (Office) — every other kind of data (certificates, invoices, photos, broadcast alerts, requests) only ever updates on a fixed polling timer or a fresh page load, never instantly.
- The Client Portal has no synchronization mechanism of any kind beyond its one-time initial page load.
- Deletes do not cascade or propagate consistently — some are pushed live (jobs, since they're on the one Realtime-enabled table), most are not, and none of them clean up related records in other tables (Finding 14.1, Synchronization document Section 6).
- Race conditions in numbering and duplicate-prevention checks (this audit's Section 3) stem directly from the lack of any server-side transactional guarantee anywhere in this system's design.

---

*This audit is a point-in-time, static-code-and-live-API review. It reflects what was found by reading every line of application source and directly, safely querying the live Supabase project — it is not a substitute for dynamic testing (e.g. an actual penetration test, or a load test), which would likely surface additional issues beyond what a code review alone can find. Per instruction, no fixes have been applied — this document is findings only.*
