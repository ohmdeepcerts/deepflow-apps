# DeepFlow — Supabase Database & Backend Handbook

Project: **`dzqyqpuhxdrrpipbehpk`** (`https://dzqyqpuhxdrrpipbehpk.supabase.co`)

---

## 0. How This Handbook Was Produced — Please Read First

This handbook combines two different kinds of evidence, and every fact below is labelled so you always know which one it came from:

- 🟢 **LIVE-VERIFIED** — confirmed by actually querying the running Supabase project a few minutes ago, using the same public "anon" API key that is already embedded in all three application files (no special credentials were used or required).
- 🟡 **FROM CODE** — reconstructed by reading the SQL snippets and JavaScript inside `index.html`/`office.html`/`engineer.html`/`client-portal.html`. This reflects what the *developer documented or intended*, not necessarily what is *actually* configured on the live server right now.
- 🔴 **COULD NOT VERIFY** — genuinely unknown, because answering it requires access this handbook's author did not have (see below).

**Why the split is necessary:** I do not have a `service_role` key, a Supabase Management API token, or SQL Editor access to this project. Postgres's internal catalogs — the exact list of indexes, triggers, constraint names, and Row Level Security policy definitions — are **not exposed** through the public API that ordinary applications use, by design (this is a security feature, not an oversight). What I *could* do, safely and read-only, using only the public key every visitor to these apps already has:

- Ask each table for one sample row, to read back its real, current column names and data types directly from the live server.
- Ask each table how many rows it currently holds (a count, not the data itself).
- Try calling every custom function ("RPC") mentioned in the code, to see which ones are actually installed.
- List the contents of the file storage bucket (file paths only, not file contents).

I did **not** attempt to insert, change, or delete anything, and I deliberately avoided pulling or displaying real customer/staff personal data (names, phone numbers, emails) even where the server would have allowed it — the one place this became relevant is called out explicitly and responsibly in Section 9.

**Current scale of the live data** (🟢 LIVE-VERIFIED row counts, no content read): 3 `jobs`, 11 `users`, 1 `agencies`, 1 `invoices`, 32 `activity`, 2 `audit_log`. All other tables listed below currently contain 0 rows. This tells us the project is either very new or a test/staging environment — not a long-running, high-volume production system yet.

---

## 1. Critical Findings — Read This Before Anything Else

Two things came out of this review that are urgent enough to put at the very top, ahead of the reference material:

### 🚨 1.1 — Anyone with the public app can list every staff member's real email address, with no login required

🟢 **LIVE-VERIFIED.** The database has a function called `get_auth_users()`, intended (per its own code comments) to power the "Sync from Supabase" button on the Team settings screen — a feature that should only be usable by a logged-in Admin. I called this function using nothing but the public anon key that sits in plain sight in every copy of `index.html`, `engineer.html`, and `client-portal.html` — **without logging in at all** — and it returned the full list of every Supabase Auth account on the project: real work email addresses and their internal user IDs.

This happens because the function is written with `SECURITY DEFINER` (meaning it deliberately runs with elevated privileges, bypassing the normal protection on the `auth.users` table — this part is correct and necessary for the feature to work), but the *permission to call the function at all* has not been restricted to logged-in users only. Right now, the `anon` role (i.e. literally anyone on the internet who loads the page) is allowed to execute it.

**What to do about it:** run `REVOKE EXECUTE ON FUNCTION get_auth_users() FROM anon; GRANT EXECUTE ON FUNCTION get_auth_users() TO authenticated;` in the Supabase SQL Editor. This is a one-line fix and does not require changing any application code, because the Office app already only calls this function after a real login.

### 🚨 1.2 — Row Level Security is wide open for reading, on every table

🟢 **LIVE-VERIFIED.** Every single table this handbook checked — including `users` (which stores login roles, permission flags, and GPS coordinates) — returned data to a plain, unauthenticated request using only the public anon key. No table required a real login session to be read. This matches what the application's own internal documentation already admits (a warning banner at the very top of `index.html`'s source code says exactly this), but it's worth stating plainly here as a confirmed, tested fact rather than a suspicion: **today, anyone who has ever opened any of these three web pages already has everything they need to read your entire business database directly**, bypassing the app's screens entirely.

---

## 2. Project Identity

| Item | Value |
|---|---|
| Supabase project reference | `dzqyqpuhxdrrpipbehpk` |
| REST API base | `https://dzqyqpuhxdrrpipbehpk.supabase.co/rest/v1/` |
| Auth API base | `https://dzqyqpuhxdrrpipbehpk.supabase.co/auth/v1/` |
| Storage API base | `https://dzqyqpuhxdrrpipbehpk.supabase.co/storage/v1/` |
| Public "anon" key | Hardcoded identically into all three apps (visible in page source — this is expected/normal for Supabase, see Section 10) |
| `service_role` key | Not present anywhere in the codebase (correctly — it must never be shipped to a browser) |

---

## 3. Tables

For every table: what it's for, its real columns (live where possible), which app(s) actually read/write it, and what would genuinely break if it were dropped.

### 3.1 `jobs` 🟢 LIVE-VERIFIED (3 rows)

**Why it exists:** the central record of the business — one row per piece of work booked in, scheduled, worked on, and completed.

**Live columns right now:**

| Column | Type (observed) | Notes |
|---|---|---|
| `id` | text | Primary identifier. **Not a consistent format** — Office-created jobs use a random UUID (`uid()` in the code); jobs added from the Engineer app use a different pattern like `job-eng-<timestamp>-<random>` (confirmed by looking at real file paths in Storage, Section 11). Anything that assumes a strict UUID shape here would be wrong. |
| `jobnum` | text | Human-readable job number (e.g. `JOB-1001`), separate from `id`. |
| `address`, `description`, `notes`, `contact`, `access` | text | Core job details. |
| `date`, `timeslot` | text | Scheduling. |
| `engineer` | text | **The assigned engineer, stored as a name string — not a foreign key** to `users`. This is how the Office and Engineer apps match a job to a person, and it's the reason engineer name changes/typos can silently disconnect a job from its engineer. |
| `trade`, `priority`, `status`, `confirmed` | text/boolean | Job classification and lifecycle state. |
| `price`, `hours` | number | Billing basis. |
| `referrer`, `landlordname`, `landlordphone`, `landlordemail`, `landlordaddr`, `landlordwa`, `landlordnotes` | text | Landlord/client contact details, copied directly onto the job (again, by value/name, not by reference). |
| `agencyname`, `agencyphone`, `agencyemail`, `agencyaddr`, `agencyaddress`, `agencynotes` | text | Agency contact details (two address fields exist — `agencyaddr` and `agencyaddress` — a likely duplication left over from a rename). |
| `agentname`, `agentphone`, `agentemail` | text | Individual agent contact details. |
| `certtypes` | text/array | Which certificate types apply to this job. |
| `invnumber`, `linkedinvid`, `invoice_id` | text | Link to a generated invoice — **note `linkedinvid` (used everywhere in the app code) and `invoice_id` both exist**; only `linkedinvid` was found to actually be read/written by any of the three apps. |
| `client_person_id`, `client_agency_id` | text | **Present in the database but essentially unused.** Only one place in the entire codebase reads `client_person_id` (a fallback lookup in the Client Portal, Section "Relationships" below) — nothing ever *writes* it, so in practice it is always empty. This looks like the beginning of a proper foreign-key-based redesign that was started but never finished. |
| `checkin_time`, `checkout_time`, `checkin_location` | timestamp/text | **Not referenced anywhere in any of the three apps' JavaScript.** Looks like schema prepared for a future "engineer clocks in/out with location" feature that was never built. |
| `client_signature`, `engineer_signature` | text | **Also not referenced anywhere in the app code.** Prepared for a future digital-signature-on-completion feature that doesn't exist yet. |
| `portal_token` | text | **Not referenced anywhere in the app code.** The Client Portal actually identifies people using the `id` of a `persons`/`agencies` row (Section 3.3), not a per-job token — this column looks unused. |
| `sortorder` | number | Manual drag-to-reorder position within a day's job list. |
| `created`, `modified` | timestamp | Audit timestamps. |

**Used by:** all three apps, constantly — this is the busiest table in the system.

**What breaks if removed:** everything. Every other automatically-generated record (certificates, invoices, activity entries) ultimately traces back to a job. This table is also the only one with Supabase **Realtime** enabled (Section 13).

### 3.2 `users` 🟢 LIVE-VERIFIED (11 rows)

**Why it exists:** one row per person who can log in — office staff and field engineers both live in this same table, distinguished by a `role` column.

**Live columns right now:**

| Column | Type (observed) | Notes |
|---|---|---|
| `id` | text | Primary identifier for this profile row. |
| `auth_id` | text | Links this profile to the matching Supabase **Auth** account (a completely separate system — see Section 10). |
| `name`, `email`, `phone`, `pin` | text | Identity/contact fields. (`pin` exists but, per the application review, is not used as a real PIN-login mechanism in the current code — see the Architecture document's note on the "PIN lock" legacy naming.) |
| `internal_email` | text | **Not referenced anywhere in the app code.** Unused. |
| `role` | text | `admin` / `manager` / `staff` / `viewer` / `engineer` — this single value decides which of the two apps (Office vs Engineer) will accept this person's login. |
| `active` | boolean | Deactivated accounts are rejected at login. |
| `can_edit`, `can_delete`, `can_finance`, `can_invoice`, `see_agent`, `see_contact`, `see_landlord`, `see_landlord_phone`, `see_price` | boolean | Per-user permission flags, read once at login and used only to show/hide things in the interface — not re-checked by anything server-side. |
| `is_protected` | boolean | **Not referenced anywhere in the app code.** Possibly intended to relate to the hardcoded `EMERGENCY_ADMINS` safety-net feature, but that feature currently checks a hardcoded email list in the JavaScript, not this column. |
| `last_lat`, `last_lng`, `last_seen`, `last_accuracy` | number/timestamp | Engineer's last known GPS position — **written only by the Engineer app**, **read only by the Office app's Live Maps screen**. |
| `session_token`, `session_expires` | text/timestamp | **Not referenced anywhere in the app code.** These columns are strong evidence that a server-tracked session system was designed and partially built (matching the dead `_issueOfficeSession`/`_checkOfficeSession` JavaScript functions found in `index.html`, which read/write a *different*, local-only session in the browser's `localStorage` instead) — but the two halves were never connected. |
| `created` | timestamp | — |

**Used by:** Office app (staff accounts) and Engineer app (engineer accounts), for login and permissions; Office app's Live Maps and Engineer Reports screens.

**What breaks if removed:** nobody could log in to either the Office or Engineer app; the emergency-admin fallback would stop working; Live Maps would have nothing to show.

### 3.3 `persons` 🟢 LIVE-VERIFIED table exists and is readable (0 rows — columns below are 🟡 FROM CODE, since an empty table has no sample row to read column names from)

**Why it exists:** landlords and individual clients.

**Columns (from code):** `id`, `name`, `phone`, `email`, `address`, `wa` (WhatsApp number), `notes`, `roles` (e.g. tagging someone as a "landlord"), `bankName`, `bankAcc`, `bankSort`, `bankRef`, `agencyId` (links a person acting as an agent to a parent agency — see `agents` below, this same shape is reused).

**Used by:** Office app (directory management, job auto-fill, duplicate detection, merging); Client Portal (this is exactly the table a landlord's portal link points at — `client-portal.html?id=<persons.id>&type=landlord`).

**What breaks if removed:** every landlord portal link stops working instantly; jobs still technically "work" because they store landlord details by value on the job row itself (Section 3.1), but the Office app's directory, duplicate-detection, and client-merge features would have nothing to operate on.

### 3.4 `agencies` 🟢 LIVE-VERIFIED (1 row)

**Live columns right now:** `id`, `name`, `address`, `phone`, `email`, `wa`, `website`, `notes`, `bankname`, `bankacc`, `bankref`, `banksort`, `portal_token`, `portal_enabled`, `last_portal_access`, `created`, `modified`.

**Notes on unused columns:** `portal_token`, `portal_enabled`, and `last_portal_access` all exist here too, and — same as on `jobs` — **none of them are referenced anywhere in the application code.** The real mechanism the Client Portal uses is simply the agency's own `id` in the URL; these three columns look like an earlier or abandoned design for token-based (rather than ID-based) portal access, or "revoke this client's portal access" controls that were never wired up to a working switch in the interface.

**Used by:** Office app (agency directory); Client Portal (agency-type portal links point here).

**What breaks if removed:** agency portal links stop working; the Office app's agency directory and any agent linked to a deleted agency lose their parent record.

### 3.5 `agents` 🟢 LIVE-VERIFIED table exists and is readable (0 rows — columns 🟡 FROM CODE)

**Why it exists:** an individual person working *for* an agency (as opposed to `persons`, who mostly represent individual landlords).

**Columns (from code):** `id`, `name`, `phone`, `email`, `agencyId` (links to `agencies.id`) — this is one of the few places in the whole system where a real ID-based link is actually used and actively relied upon (the Office app's "agency card" shows a count of linked agents by querying `agents` where `agencyid` matches).

**Used by:** Office app; Client Portal (agent-type portal links).

**What breaks if removed:** agencies would show no linked agents; agent-type portal links stop working.

### 3.6 `invoices` 🟢 LIVE-VERIFIED (1 row)

**Why it exists:** every kind of billing document in the system — normal invoices, proformas (quotes), disposable one-off invoices, and credit notes — all live in this **one table**, distinguished by a `status`/`type`/`isCreditNote` flag rather than being separate tables.

**Live columns right now:**

| Column | Type (observed) | Notes |
|---|---|---|
| `id`, `number` | text | `number` is the human-readable invoice number (e.g. `INV-1001`), generated by scanning existing invoices for the highest number in use, not a database sequence. |
| `clientid`, `clientname`, `clientemail`, `clientaddr`, `clientwa` | text | Billing contact, stored by value. |
| `client_person_id`, `client_agency_id` | text | **Present but not referenced anywhere in the application's JavaScript** — the same "started but unfinished ID-based linking" pattern seen on `jobs`. |
| `job_id`, `jobid`, `jobnum`, `jobref`, `linkedjobid` | text | **Both `job_id` and `jobid` exist as separate columns.** Reading the code, only `jobid`/`linkedjobid` (lowercase, no underscore) are actually used by any app; `job_id` appears to be an unused duplicate, possibly left over from an earlier naming convention. |
| `jobaddr`, `jobaddress`, `propertyaddress` | text | Three different columns holding what is functionally the same piece of information (the job's address) — the code does use more than one of these depending on which invoice-creation code path was used, which is a real inconsistency worth cleaning up. |
| `billtoname`, `billtoaddress`, `landlordname`, `agencyname`, `agencyaddress`, `agentname`, `agentemail`, `agentcc` | text | Who the invoice is actually addressed to, and CC details. |
| `invoicetype`, `isagency` | text/boolean | Classifies the invoice as landlord- or agency-billed. `isagency` was not found referenced anywhere in the app code — `invoicetype` is the field actually used. |
| `description`, `desc`, `notes`, `terms` | text | **Both `description` and `desc` exist.** The application code consistently uses `description`; `desc` looks unused. |
| `items` | array/JSON | The actual line items (description, quantity, unit price, VAT flag per line) — this is where the real invoice content lives in the current app design. |
| `qty`, `unit`, `subtotal`, `total`, `vat`, `vat_rate`, `vat_amount`, `paid_amount` | number | **These flat, invoice-level numeric columns look like an older invoice design** (one line item per invoice, stored as plain columns) that pre-dates the current `items` array design. They are not written to by any invoice-creation path found in the app code — invoice totals are instead calculated live, on the fly, from the `items` array every time an invoice is displayed. |
| `pdf_url` | text | **Not referenced anywhere in the app code.** PDF invoices are generated fresh, in the browser, every time someone clicks Download — nothing saves a permanent PDF file or URL anywhere. |
| `status` | text | Draft / Awaiting Payment / Paid / Credit Note / Proforma, etc. |
| `date`, `duedate`, `created`, `modified` | text/timestamp | — |

**Used by:** Office app (creates, edits, sends, records payment against); Client Portal (reads and displays, generates its own PDF independently).

**What breaks if removed:** all billing history disappears; the P&L Dashboard, Statements, and Client Portal invoice tabs would all show nothing; the automatic job-completion-to-invoice feature would fail outright.

### 3.7 `certs` 🟢 LIVE-VERIFIED table exists and is readable (0 rows — columns 🟡 FROM CODE)

**Why it exists:** compliance certificates (Gas Safety, EICR, PAT, EPC, Fire Alarm, etc.) and their expiry dates.

**Columns (from code):** `id`, `jobid`, `jobnum`, `type`, `address`, `landlord`, `agent`, `certnum`, `issuedate`, `expirydate`, `noexpiry`, `created`.

**Important:** the live database has **no table called `certificates`** (confirmed — a direct query for it returns "table not found"). The Office app's admin-only Storage Usage dashboard queries a table named `certificates` for a count — **this is a genuine bug**; that specific count will always fail/return nothing, because the real table is named `certs` everywhere else in the system.

**Used by:** Office app (creation, expiry tracking, reminders); Client Portal (reads certificates for that client's properties).

**What breaks if removed:** all certificate/compliance tracking disappears; the automatic job-completion-to-certificate feature fails; Client Portal compliance scores would always show empty.

### 3.8 `payments` 🟢 LIVE-VERIFIED table exists and is readable (0 rows — columns 🟡 FROM CODE)

**Columns (from code):** `id`, `invId` (→ `inv_id` in the database, per the app's field-mapping table), `date`, `amount`, `method`, `ref`, `recordedBy` (→ `recorded_by`).

**Used by:** Office app only (recording payments against invoices, calculating outstanding balances).

**What breaks if removed:** no invoice could ever be marked Paid; the P&L Dashboard's revenue figures (based on paid invoices) would show zero.

### 3.9 `expenses` 🟢 LIVE-VERIFIED table exists and is readable (0 rows — columns 🟡 FROM CODE)

**Columns (from code):** `id`, `date`, `category`, `cost`, `desc`/`description` (→ `description` in the database, per field-mapping), `engineer`, `jobRef` (→ `jobref`), `receipt`.

**Used by:** Office app's Expenses screen, P&L Dashboard, and engineer payslip calculations (deducted from gross pay by category).

**What breaks if removed:** the Expenses screen becomes empty; P&L cost figures and payslip deductions would understate real costs.

### 3.10 `overtime` 🟢 LIVE-VERIFIED table exists and is readable (0 rows — columns 🟡 FROM CODE)

**Columns (from code):** `id`, `engineer`, `type` (e.g. `overtime-1`, `overtime-2`, `overtime-custom`, `halfday`, `absent`), `hours` (negative for absences), `date`, `rate`, `notes`, `created`.

**Used by:** Office app only, for both direct logging (Timesheets) and payslip calculations.

**What breaks if removed:** the Timesheets screen and payslip overtime/absence adjustments would be empty.

### 3.11 `job_comments` 🟢 LIVE-VERIFIED table exists and is readable (0 rows — columns 🟡 FROM CODE)

**Columns (from code):** `id`, `jobId` (→ `jobid`), `author`/staff name, `text`, `created`.

**Used by:** Office app only — an internal notes thread on each job, not visible to engineers or clients.

**What breaks if removed:** the small comment-thread feature on jobs disappears; nothing else depends on it.

### 3.12 `activity` 🟢 LIVE-VERIFIED (32 rows)

**Live columns right now:** `id`, `msg`, `type`, `ts`, `created`.

**Why it exists:** a general-purpose, lightweight "what just happened" feed, written by almost every create/edit/delete action across the Office app *and* by the Client Portal (when a client submits a request). This is different from — and much broader than — `audit_log` (Section 3.13), which is deliberately narrow.

**Used by:** Office app (the activity feed shown around the Dashboard/reports); Client Portal (writes a copy of every job request submitted here too).

**What breaks if removed:** the general activity feed goes empty. No automated feature actually *depends* on reading this table back (it's a one-way log), so removing it would not break any calculation — only the visibility feed.

### 3.13 `audit_log` 🟢 LIVE-VERIFIED (2 rows)

**Live columns right now:** `id`, `type`, `staff_name`, `staff_email`, `staff_role`, `details`, `created_at`.

**Why it exists:** a strict, Admin-only, more formal trail — but deliberately narrow. Reading the app code confirms it is written for exactly **two** kinds of events: a job being deleted, and an invoice's amount being changed. Nothing else writes here.

**Used by:** Office app's Audit Log screen (Admin-only).

**What breaks if removed:** the Audit Log screen becomes empty; the two sensitive actions it tracks would no longer leave any permanent, admin-reviewable trace of who did them.

### 3.14 `attachments` 🟢 LIVE-VERIFIED table exists and is readable (0 rows — columns 🟡 FROM CODE)

**Columns (from code):** `id`, `jobid`, `name`, `type`, `mime`, `storage_path`, `url`, `uploaded_by_name`, `created`, `photo_slot`, `photo_role` (before/after pairing).

**Why it exists:** the database-side "index card" for every file in Supabase Storage — the actual file bytes live in Storage (Section 11); this table is what lets the apps find, list, and delete them.

**Used by:** Engineer app (writes — this is the only app that uploads); Office app (reads and deletes); Client Portal (reads only, for certificate files/documents).

**What breaks if removed:** every uploaded photo/document becomes permanently invisible and unreachable inside the apps, even though the actual files would still physically exist in Storage (orphaned, with no index pointing at them).

### 3.15 `engineer_requests` 🟢 LIVE-VERIFIED table exists and is readable (0 rows — columns 🟡 FROM CODE)

**Columns (from code):** `id`, `engineer_name`, `type` (`overtime` / `leave` / `portal_request`), `date`, `hours`, `rate`, `job`, `leave_type`, `leave_from`, `leave_to`, `notes`, `status` (`pending`/`approved`/`rejected`), `office_reply`, `created`.

**Why it exists:** a single shared inbox for two very different kinds of incoming requests — engineer overtime/leave requests, *and* client "please book a job" requests from the Client Portal — told apart only by the `type` field.

**Used by:** Engineer app (submits overtime/leave requests, views their own past ones); Client Portal (submits job requests); Office app (the "Job Requests" inbox reads and responds to everything here).

**What breaks if removed:** engineers could no longer request overtime/leave through the app; clients could no longer self-serve a new job request; the Office "Job Requests" inbox would always be empty.

### 3.16 `engineer_alerts` 🟢 LIVE-VERIFIED table exists and is readable (0 rows — columns 🟡 FROM CODE)

**Columns (from code):** `id`, `target` (`'all'` or a specific engineer's name), `type` (`info`/`warning`/`urgent`), `title`, `message`, `sent_by`, `created`, `expires` (auto-set to one hour after creation), `status`.

**Why it exists:** office-to-engineer broadcast messages/alerts.

**Used by:** Office app (writes, via the 📢 broadcast button); Engineer app (polls this every 15 seconds and shows a full-screen popup for anything new and unexpired).

**What breaks if removed:** the broadcast/alert feature stops working entirely, and — notably — the Office app's own code contains a self-repair step that tries to *recreate this exact table* automatically the first time a broadcast is sent, if it's ever missing (Section 9).

### 3.17 `cert_reminder_log` 🟢 LIVE-VERIFIED table exists and is readable (0 rows)

**Columns (from code, matching the SQL that created it):** `id`, `cert_id`, `sent_at`, `days_before`, `method`.

**Why it exists:** to prevent the same certificate-expiry reminder being sent twice, as part of an **optional, scheduled, server-side reminder system** described in the Office app's own "Guide & SQL" panel.

**Important:** this table existing (confirmed 🟢) does **not** mean the reminder system is actually running. The Postgres function that would populate it, `send_cert_reminders()`, does **not exist** on the live server (confirmed 🟢 — see Section 9). So today, this table is present but permanently unused; nothing writes to it.

**Used by:** nothing, currently, in practice.

**What breaks if removed:** nothing currently working would break, since nothing currently writes to it. It would only matter if/when an admin finishes setting up the optional scheduled-reminder feature by installing the missing function.

### 3.18 `app_settings` 🟢 LIVE-VERIFIED (1 row, confirmed content: `key = "__all__"`)

**Live columns right now:** `key`, `value`, `updated`.

**Why it exists:** a deliberately simple key-value store. In practice, the entire application configuration (company details, invoice templates, WhatsApp message templates, certificate type definitions, the full **Properties** list, and per-engineer visibility permission overrides) is saved as **one single JSON blob** under the key `"__all__"`, rather than as proper, individually-queryable rows and tables.

**Used by:** all three apps read from this on load; only the Office app writes to it.

**What breaks if removed:** every app loses its configuration — company name, invoice settings, message templates, certificate types, the entire Properties list, and engineer permission overrides would all revert to hardcoded defaults or disappear.

### 3.19 `settings` 🟢 LIVE-VERIFIED table exists and is readable (0 rows) — a second, separate, essentially unused table

This is a genuinely interesting live finding: **there is a second table, literally named `settings`, separate from `app_settings`, and it is empty.**

Reading the code explains why it exists and why it's a problem: the **Engineer app** has a function, `_loadOfficeSettings()`, whose entire job is to fetch the office's configured WhatsApp contact number so the "message the office" button works. It queries `settings?limit=1&select=*` — the wrong table. The **real** settings live in `app_settings` (Section 3.18), which the Engineer app never queries. Because `settings` is always empty, this lookup silently finds nothing every time, and the Engineer app falls back to a hardcoded placeholder WhatsApp number (`447700000000`) instead of the real one configured by the office. This is a live-confirmed bug, not a hypothesis.

**What breaks if removed:** nothing currently working depends on this table (its one reader always gets nothing back from it anyway) — removing it would have zero practical effect, other than making the underlying naming bug in `engineer.html` more obviously broken (it would then get an outright error instead of a silent empty result).

### 3.20 Tables Referenced in the Code That Do NOT Exist in the Live Database

These four are confirmed **absent** — a direct query for each one returns "could not find the table in the schema cache":

| Table name used in code | Where it's referenced | What actually happens today |
|---|---|---|
| `ratings` | `client-portal.html` — reads star ratings for completed jobs | The call is wrapped in error-catching code, so it fails silently; the Client Portal's job-rating display feature never has any data to show. |
| `invoice_audit` | `index.html` — the per-invoice audit-trail timeline (`_renderInvAuditTrail`) | Fails silently; the "who did what to this invoice" timeline is permanently empty in the live app. |
| `invoice_payments` | `index.html` — read alongside `payments` in the same audit-trail feature | Also fails silently for the same feature; the actual working payment record-keeping goes through the `payments` table instead (Section 3.8), which does exist. |
| `credit_notes` | Not actually queried as a separate table anywhere — mentioned only conceptually; credit notes are real rows inside `invoices` (Section 3.6) | No impact — this was a documentation assumption, not a real gap. Listed here to close the loop, since earlier working notes on this project speculated a dedicated table might exist. |

### 3.21 "Properties" — Confirmed Not a Table At All

🟢 **LIVE-VERIFIED** — a direct query for a `properties` table returns "not found," confirming what the application code's own comments say directly: properties are stored as a list inside the `app_settings` JSON blob (Section 3.18), not as a real, independently queryable table. This means properties cannot be filtered, indexed, or searched efficiently by the database — the entire list has to be loaded and searched in the browser every time.

---

## 4. Relationships & Foreign Keys

🔴 **COULD NOT VERIFY** whether any *real*, database-enforced foreign key constraints exist between these tables — that requires access to Postgres's own constraint catalog, which was not available. What can be said with confidence, from directly reading how every screen in all three apps actually looks up related data:

- **The overwhelming majority of relationships in this system are done by matching text (names), not IDs.** A job "belongs" to a landlord because its `landlordname` column is spelled the same as a row in `persons.name` — there is no ID stored on the job pointing at that person in the vast majority of code paths.
- **One real exception exists, and it is only half-built:** `jobs.client_person_id` and `invoices.client_person_id`/`client_agency_id` columns exist in the live database, clearly intended to eventually replace the name-matching approach with a proper reference. But only **one single place** in the entire codebase (`client-portal.html`, the `fetchJobs()` function) actually *reads* `client_person_id`, as a fallback used only when the primary name-search finds nothing — and **no code anywhere writes a value into it**, so in practice this fallback path can currently never trigger, because the column is always empty.
- **Agents-to-Agencies is the one relationship that works properly and is actively used:** `agents.agencyId` reliably links each agent to their parent agency, and the Office app's agency cards genuinely rely on this to show a live count of linked agents.
- **Jobs-to-Invoices and Jobs-to-Certificates** are linked with real ID references that *are* consistently used (`jobs.linkedinvid` ↔ `invoices.id`; `certs.jobid` ↔ `jobs.id`), unlike the person/agency relationships above.

**Practical implication:** because most links are by name, renaming a client, or having two slightly different spellings of the same name entered by mistake, will silently split what should be one client's history into two. The Office app's duplicate-detection and merge tools (documented in the Workflow document) exist specifically to manage this ongoing risk — they are a workaround for the underlying design, not a guarantee against it.

---

## 5. Constraints

🔴 **COULD NOT VERIFY** primary key names, unique constraints, `NOT NULL` rules, or check constraints — this requires Postgres catalog access not available here.

What can be inferred with reasonable confidence from behaviour: every table has a working `id` primary key (every table accepted an `id`-based lookup without error), and the whole system tolerates a very large number of optional/blank fields (jobs, invoices, and directory records are routinely saved with many fields empty), suggesting **few or no `NOT NULL` constraints** are enforced beyond `id` itself. This is an inference from behaviour, not a confirmed fact.

---

## 6. Indexes

🔴 **COULD NOT VERIFY.** No index list is visible through the public API. The only concrete evidence available is the SQL shown in the Office app's own "Guide & SQL" panel, which includes exactly one explicit index creation statement, for the optional reminder feature:

```sql
CREATE INDEX IF NOT EXISTS idx_cert_reminder_log_cert ON cert_reminder_log(cert_id, sent_at);
```

🟡 **FROM CODE** — this is documentation of developer intent, shown to an admin to copy-paste; it cannot be confirmed whether it has actually been run (though `cert_reminder_log` does exist live, so it is plausible this specific one has been applied — its own function has *not* been installed, per Section 9, so it's also possible only the table+index half of that setup was completed).

No other index statements were found anywhere in the codebase. **Given the frequent name-based text searches this system performs (matching landlord names, addresses, etc. across `jobs`, `persons`, `invoices`), a lack of indexes on those text columns would become a real performance concern as the row counts grow beyond the current small scale** (Section 0) — this is a reasonable recommendation, not a confirmed problem today.

---

## 7. Triggers

🔴 **COULD NOT VERIFY**, and 🟡 **FROM CODE**: no `CREATE TRIGGER` statement of any kind appears anywhere in any of the SQL embedded in the three application files. Combined with the fact that every piece of "automatic" behaviour in this system (auto-creating a certificate or invoice on job completion, updating `last_seen`, expiring a broadcast alert) is implemented as **JavaScript running in the browser** rather than as database logic, it is reasonable to conclude **this project very likely has no database triggers at all** — though this cannot be stated as a 100%-certain fact without catalog access.

**Practical implication:** all of this system's "automation" only happens if a browser is open and running the JavaScript. There is no safety net at the database level — for example, if two different browser tabs try to create an invoice for the same completed job at the same moment, nothing in the database itself would prevent a duplicate; the JavaScript's own "check if one already exists first" logic is the only protection, and it has a small timing gap.

---

## 8. Views

🔴 **COULD NOT VERIFY**, and 🟡 **FROM CODE**: no `CREATE VIEW` statement appears anywhere in the codebase, and every query seen in the app code targets a real table directly (`jobs`, `invoices`, etc.), never a view name. **This project almost certainly has no database views.** All "combined" or "summary" data (like the Client View 360° profile, or the P&L Dashboard) is assembled by fetching several raw tables separately and combining them with JavaScript in the browser, not by a pre-built database view.

---

## 9. Functions & RPCs

Every custom function mentioned anywhere in the application code was tested directly against the live project.

| Function | 🟢 Live status | What it's for | Callable by | What breaks if removed |
|---|---|---|---|---|
| **`get_auth_users()`** | 🟢 **Installed and working** — confirmed by direct test | Lets the Office app's "Sync from Supabase" (Team management) feature see the full list of Supabase Auth accounts, so an admin can grant a real login a role/profile in the `users` table. | **Currently: `anon` (anyone, no login needed) — see Critical Finding 1.1.** Should be `authenticated` only. | The Team management screen's "Sync from Supabase" button would stop working entirely; new staff/engineer accounts could no longer be linked to a working profile through the app (an admin would have to do it by hand in the Supabase dashboard). |
| **`create_confirmed_user(email, password)`** | 🟢 **NOT installed** — confirmed absent (function not found) | Meant to let an admin create a brand-new login (email + password) that works immediately, with no separate "confirm your email" step. | N/A — doesn't exist yet | Nothing currently breaks, because nothing currently depends on it — but it means **new staff accounts today must go through Supabase's normal email-confirmation flow**, or be created manually in the Supabase dashboard by a project owner. The "🔑 Create Login" button described in the app's own help text will not work until this is installed. |
| **`send_cert_reminders()`** | 🟢 **NOT installed** — confirmed absent | Meant to run once a day (via the Postgres `pg_cron` scheduler) and find certificates due for a renewal reminder, logging them to `cert_reminder_log`. | N/A — doesn't exist yet | Nothing currently breaks, because the app never depended on this running for its core certificate-tracking feature (that works entirely client-side, on-demand). It simply means the **fully-automated, scheduled reminder system described in the app's own admin panel is not actually active** — reminders currently only happen when a staff member manually looks at the Certificates screen and sends one. |
| **`exec_sql(query)`** | 🟢 **NOT installed** — confirmed absent | A self-repair mechanism: if the Office app ever tries to send a broadcast alert and finds the `engineer_alerts` table missing, it attempts to call this function to create the table automatically, before falling back to showing the admin raw SQL to run by hand. | N/A — doesn't exist yet | No impact today, because `engineer_alerts` already exists (Section 3.16) — the self-repair path was never actually needed. It would only matter if that table were ever deleted. **Worth flagging separately:** a function like this, if it *were* installed and callable by `anon` (as `get_auth_users` currently is), would let anyone run arbitrary SQL against your database — this should never be granted broader than the most trusted internal role, if it's installed at all. |
| **`query_cron_jobs()`** | 🟢 **NOT installed** — confirmed absent | Used by an admin-facing "✓ Check if pg_cron is active" button, to see whether the scheduled-reminder system (above) has been fully set up. | N/A — doesn't exist yet | The "check" button falls back to a simpler check (whether `cert_reminder_log` exists) and reports a less certain result, but nothing else depends on this. |

---

## 10. Row Level Security (RLS) Policies

🟢 **LIVE-VERIFIED (read access):** every table tested — `jobs`, `users`, `persons`, `agencies`, `agents`, `invoices`, `certs`, `payments`, `expenses`, `overtime`, `job_comments`, `activity`, `attachments`, `engineer_requests`, `engineer_alerts`, `audit_log`, `cert_reminder_log`, `app_settings`, `settings` — returned data to a plain read request using only the public `anon` key, with no login. This is consistent with the application's own embedded documentation describing a default policy of `allow_all` (i.e., no real restriction) on most tables.

🔴 **NOT TESTED (write access):** to avoid any risk of writing to, corrupting, or deleting real data in a live system, no insert/update/delete request of any kind was attempted during this review. The write-side security posture is therefore taken from the application's own documented SQL (🟡 FROM CODE) rather than independently confirmed:

- The default, broadest policy pattern used throughout the embedded SQL snippets is:
  ```sql
  CREATE POLICY "allow_all" ON <table> FOR ALL USING (true) WITH CHECK (true);
  ```
  This grants full read, insert, update, and delete access to anyone able to reach the API at all — which, given the public anon key, effectively means the general public, not just logged-in staff.
- A small number of **tighter** policies have been specifically written for the `users` table (documented as a "fix" in the same panel), restricting who can update/delete user rows to existing Admins:
  ```sql
  CREATE POLICY "users_update" ON users FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM users u WHERE u.auth_id = auth.uid() AND u.role='admin' AND u.active=true))
    WITH CHECK (true);
  ```
  Whether this tighter policy (versus the looser default) is the one actually currently active on `users` cannot be confirmed without catalog access — both versions are documented in the same admin panel as things to "run if needed," which by nature means it's uncertain which state any given table is actually in without checking directly in the Supabase dashboard.

**What breaks if RLS were properly locked down:** every one of the three apps would need each of its data requests to be sent by a genuinely logged-in user (with a real Supabase Auth session) matching rules written per table — for example, "an engineer can only see jobs assigned to their own name." **Critically, the Client Portal (Section 3, and the Architecture document) has no login system at all** — if RLS were tightened to require authentication, the Client Portal would need a different, deliberate access mechanism designed for it (for example, a Postgres function that safely checks a portal link's ID server-side) rather than simply querying tables directly with the public key, since it has no user session to attach a policy check to.

---

## 11. Storage — Buckets & Folders

🟢 **LIVE-VERIFIED.**

**Bucket:** `deepflow` — confirmed to exist and be listable via the object-listing endpoint. (Note: the *general* bucket-listing endpoint, `/storage/v1/bucket`, returned an empty list to the anon key — meaning the ability to enumerate "what buckets exist" is itself restricted, even though listing the *contents* of a bucket you already know the name of is not. This is a slightly inconsistent security posture worth being aware of.)

**Folder structure (confirmed live):**
```
deepflow/
└── jobs/
    ├── <uuid-style job id>/        ← jobs created in the Office app
    │     └── <timestamp>-<random>.<ext>
    └── job-eng-<timestamp>-<random>/   ← jobs created in the Engineer app
          └── <timestamp>-<random>.<ext>
```

This confirms, directly from the live file listing (not just the code), that **jobs created from the two different apps end up with visibly different ID formats** — Office-created jobs get a proper random UUID; Engineer-app-created jobs (via the "Add New Job" feature) get a different, custom-built ID string. Both work fine as a folder name, but this is worth knowing if anything downstream ever assumes job IDs are always valid UUIDs.

**Public access:** files inside this bucket are reachable via a public URL pattern (`storage/v1/object/public/deepflow/...`), meaning once someone has (or guesses) a file's exact path, no login is needed to view it — consistent with how the apps display photos directly in `<img>` tags without any extra authentication step.

**Used by:** Engineer app uploads here exclusively; Office app reads/deletes; Client Portal reads only (for certificate/document files).

**What breaks if the bucket were removed:** every photo and document ever uploaded would be permanently lost, and every `attachments` row pointing at it would become a dead link.

---

## 12. Edge Functions

🟢 **CONFIRMED: none exist and none are used.** Supabase Edge Functions are called from a specific URL pattern (`/functions/v1/...`); this pattern does not appear anywhere in any of the four HTML files. There is also no `supabase/functions` folder anywhere in the project's source. Every piece of "server-side"-feeling logic in this system is either plain browser JavaScript, or one of the small number of Postgres functions documented in Section 9 — there is no serverless function layer at all.

**What breaks if this were ever added and later removed:** not applicable — nothing currently relies on this layer existing.

---

## 13. Realtime Subscriptions

🟡 **FROM CODE**, consistent with everything documented in the Architecture document: exactly **one** live subscription exists in the entire system.

```js
_supaAuth.channel('jobs-realtime')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, handleRealtimeChange)
  .subscribe()
```

- **Where:** only inside `index.html`/`office.html` (the Office app). Started automatically right after a successful login.
- **What it watches:** every insert, update, and delete on the `jobs` table — nothing else.
- **Why it exists:** so that when one member of office staff changes a job (reassigns an engineer, changes a status, etc.), every *other* office staff member's screen updates instantly, without needing to refresh, and so the app can warn someone if they're about to overwrite a change someone else just made to the same job.
- **What breaks if removed:** the Office app would simply fall back to what it already does when this connection drops anyway — polling (repeatedly re-checking) on a timer. Nothing would stop functioning, it would just become slightly slower to notice another user's change (up to the length of the polling interval, instead of instantly).
- **Everything else in this system (broadcast alerts, job requests, the Engineer app's job list, all of the Client Portal) uses plain polling or a one-time page load — none of it is "realtime" in the live-push sense**, no matter how instant it might feel in normal use.

---

## 14. Migrations

🟢 **CONFIRMED: there is no migration history anywhere.** There is no `supabase/migrations` folder, no `.sql` migration files, and no version-tracking table of any kind referenced by the application. The entire schema exists only as: (a) whatever has actually been run, by hand, over time, directly in the Supabase SQL Editor, and (b) a library of copy-paste SQL snippets embedded in the Office app's own "Guide & SQL" settings screen, which serves as the closest thing to schema documentation this project has — but which, as Section 9 demonstrates, does not necessarily reflect what has actually been executed.

**Practical implication:** there is currently no reliable way to know the exact schema history, no way to safely "roll back" a database change, and no automated way to bring a new environment (e.g. a staging copy) up to the same schema state as production, other than manually running every snippet from the admin panel and hoping none of them have since been superseded or are missing something not yet documented there.

---

## Appendix A — Recommendations, Ranked by Effort vs. Impact

1. **(5 minutes, highest priority)** Restrict `get_auth_users()` to `authenticated` only — see Critical Finding 1.1.
2. **(A few hours)** Replace the blanket `allow_all` policies with real per-role rules, starting with the most sensitive tables (`users`, `payments`, `invoices`). The app's own admin panel already contains a tighter example policy for `users` to use as a template.
3. **(A design decision, not urgent)** Decide whether the Client Portal should remain link-only-with-no-login (acceptable for a low-stakes internal tool, riskier the more real client financial/compliance data it carries) or move to a lightweight verification step (e.g. a one-time code sent to the client's known phone/email before showing their data).
4. **(Cleanup, low risk)** Either finish or remove the half-built columns found live but unused in code: `checkin_time`/`checkout_time`/`checkin_location`, `client_signature`/`engineer_signature`, `portal_token` (on both `jobs` and `agencies`), `session_token`/`session_expires`, `is_protected`, `internal_email`, and the duplicate invoice columns (`job_id` vs `jobid`, `desc` vs `description`, the flat `qty`/`unit`/`subtotal`/`total`/`vat_rate` columns superseded by the `items` array).
5. **(One-line code fix)** Point `engineer.html`'s `_loadOfficeSettings()` at `app_settings` (with `key=eq.__all__`) instead of the empty `settings` table, so the Engineer app's "message the office" button uses the real configured WhatsApp number.
6. **(One-line code fix)** Fix the Storage Usage dashboard's certificate count to query `certs`, not the non-existent `certificates`.
7. **(Decide and either finish or remove)** `client_person_id`/`client_agency_id` on `jobs` and `invoices` are a good idea — a real foreign-key link would fix the fragile name-matching problem described in Section 4 — but they're currently dead weight since nothing writes to them. Either finish wiring them up (write the ID whenever a job/invoice is linked to a directory record) or remove them to reduce confusion.
8. **(Verify directly in the Supabase dashboard)** Because this handbook could not access Postgres's own catalogs, someone with dashboard access should directly check: which RLS policies are *actually* attached to each table today, whether any indexes exist beyond the one documented snippet, and whether `pg_cron` is enabled at all (needed before `send_cert_reminders()` would even be useful if installed).

---

*This handbook combines direct, read-only, non-destructive testing of the live Supabase project (using only the same public key already embedded in the applications) with a full manual review of all four application source files. No data was created, changed, or deleted in the process, and no personal data (staff or customer names, emails, or phone numbers) retrieved during testing has been reproduced in this document.*
