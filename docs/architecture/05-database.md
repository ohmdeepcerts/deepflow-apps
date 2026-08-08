# 05 — Database Schema

DeepFlow's Postgres database, hosted on Supabase project **`dzqyqpuhxdrrpipbehpk`**.

This document replaces the old `docs/05_Database.md` and root `DATABASE_HANDBOOK.md`, both of which pre-date the PAT (Portable Appliance Testing) integration, auto-generated certificate reference numbers, the Engineer two-stage job completion flow, and a full production data reset that happened on 2026-08-06. Any row counts, "which columns are used," or "what's dead" claims in those two documents should be treated as historical, not current — everything in this document was re-verified directly against the live schema and the current application source moments before writing.

**Methodology:** every column, type, default, constraint, and foreign key below came from `list_tables`/`execute_sql` run directly against the live project (not guessed, not carried over from the old docs). Every claim about *what actually gets read or written* to a given column came from grepping the real `apps/office/main.js`, `apps/office/*.js`, `apps/engineer/*.js`, `apps/portal/*.js`, `packages/business/*.js`, `packages/data/mapping.js`, and the Supabase Edge Functions in `supabase/functions/` — not from comments in old docs, which have proven wrong before (e.g. the "nothing writes to `client_person_id`" claim below, which is no longer true).

---

## 1. Current Data State

A full production data reset happened on 2026-08-06. Live row counts, re-verified against the live project on 2026-08-07 (every table is still empty except the two noted below — nothing has been entered since the reset):

| Table | Rows | Table | Rows |
|---|---|---|---|
| `activity` | 0 | `job_comments` | 0 |
| `agencies` | 0 | `jobs` | 0 |
| `agents` | 0 | `overtime` | 0 |
| `app_settings` | **1** | `payments` | 0 |
| `attachments` | 0 | `persons` | 0 |
| `audit_log` | 0 | `portal_contacts` | 0 |
| `cert_reminder_log` | 0 | `push_subscriptions` | 0 |
| `certs` | 0 | `users` | **1** |
| `engineer_alerts` | 0 | | |
| `engineer_requests` | 0 | | |
| `expenses` | 0 | | |
| `invoice_audit` | 0 | | |

**Note on scope of the reset:** going into this review, the expectation was that `persons`, `agencies`, `agents`, and `portal_contacts` had *not* been cleared (only transactional data was assumed reset). Direct querying shows otherwise — those four tables are also at 0 rows right now, same as everything else except `app_settings` (1 row, `key='__all__'`) and `users` (1 row, the surviving admin account). Treat that original assumption as corrected: **every table is empty except `app_settings` and `users`.** Because this is a reset system, treat every row count above as a snapshot of this moment only — it will look completely different within days of real use, and no future document should rely on it.

---

## 2. Conventions Common to Every Table

- **Primary keys:** every table's `id` is application-generated, not a database sequence — usually a real (RFC-4122-shaped) v4 UUID *string* produced by the shared `uid()` helper (`apps/office/main.js:183`), stored in a `text` column even where the value looks like a UUID. Three tables (`audit_log`, `engineer_alerts`, `cert_reminder_log`'s default) use a real `uuid` column with `gen_random_uuid()`. `invoice_audit` and `push_subscriptions` use a Postgres `bigint identity` column instead — the only two auto-incrementing PKs in the schema.
- **Timestamps are inconsistent by design, not by accident:** most tables use a plain `bigint` column holding epoch-*milliseconds* (`created`, `modified`, `ts`), written by the JavaScript `Date.now()` convention throughout the apps. A handful of newer tables/columns (added post-PAT: `invoices.modified`, `checkin_time`/`checkout_time` on `jobs`, `sent_at` on `cert_reminder_log`, `created_at` on `audit_log`/`push_subscriptions`, the `portal_pin_locked_until` family) use real Postgres `timestamptz` instead. Don't assume a "date-ish" column is one or the other without checking its type below.
- **Row Level Security is enabled on all 21 tables** in `public` (confirmed live). Policy counts and the exact policy logic per table are **not** duplicated here — see [`06-supabase.md`](./06-supabase.md) for the full RLS policy reference. Section 7 below gives only a summary.
- **Foreign keys are the exception, not the rule.** Only five relationships are real, database-enforced constraints (Section 5.1). Everything else — including the `client_person_id`/`client_agency_id` columns that look like they should be foreign keys — is either a plain text-match convention or an unenforced "loose" reference. Section 5.2 covers this in detail; it is the single most important gotcha in this schema.
- **No triggers, no views, no migration-tracked history for most of the schema's life.** A real `supabase/migrations/` folder now exists (see `supabase/migrations/README.md`) and has been used for schema changes since mid-2026, but a large share of the current schema predates it and was applied by hand.

---

## 3. Tables by Domain

### 3.1 `jobs` — the central work-order record

One row per piece of work: booked in, scheduled, worked, completed, invoiced. Every other automatically-generated record (a cert, an invoice, an activity entry) ultimately traces back to a `jobs` row.

Key columns beyond the obvious (`address`, `date`, `trade`, `price`, `notes`, `access`, `contact`, `timeslot`):

- **`status`** — real values are `Pending` / `In Progress` / `Engineer Completed` / `Completed` / `Invoiced` / `Cannot Access` / `Cancelled`, defined once in `packages/business/status.js`. `Engineer Completed` is the intermediate state added for the **two-stage completion** flow: the Engineer app sets this when a job is finished on-site; office staff review and finalize it to `Completed` themselves, and it's that office-side transition (not the engineer's) that actually triggers cert/invoice automation (`onJobComplete` in `apps/office/main.js`). Every "completed"/"invoiced" business-stat check across the codebase deliberately excludes `Engineer Completed` — it isn't finalized yet.
- **`certtypes`** (`jsonb`, default `[]`) — an array of cert-*type IDs* (e.g. `["ct1","ct3"]`), matched against the `id`/`name` of entries in the `certTypes` array inside the `app_settings` JSON blob (Section 4). See Section 6 for the exact shape and why this differs from `invoices.certtypes`, which is a completely different, flat text column.
- **`engineer`** — the assigned engineer's *name as a string*, not a foreign key to `users`. A rename/typo silently disconnects a job from its engineer; nothing in the schema prevents this.
- **`landlordname`/`landlordphone`/`landlordemail`/`landlordaddr`/`landlordwa`/`landlordnotes`, `agencyname`/`agencyphone`/`agencyemail`/`agencynotes`, `agentname`/`agentphone`/`agentemail`** — contact details copied onto the job *by value*, not by reference. `agencyaddr` and `agencyaddress` are both live columns holding the same kind of data — a duplication left over from a rename, both still present.
- **`client_person_id`** (`uuid`) — **actively written as of the current codebase**, contrary to what the old docs claimed. Every job save now runs `_resolveLandlordPerson()` (`apps/office/main.js:4791`), which finds-or-creates a matching `persons` row and sets `job.clientPersonId` to that row's `id` — including a real conflict-resolution prompt if the job's landlord contact details disagree with an existing Directory entry of the same name. See Section 5.2 for why this still isn't an enforced foreign key.
- **`client_agency_id`** (`uuid`) — present in the schema, but confirmed **never written or read anywhere** in any of the three apps. Unlike its sibling above, this one really is dead today.
- **`checkin_time`/`checkout_time`/`checkin_location`/`engineer_signature`/`client_signature`/`invoice_id`/`portal_token`** — all confirmed still unreferenced by any application code. These look like schema prepared for features (GPS clock-in/out, digital sign-off, a job-level portal link) that were never built, and the recent "two-stage completion" feature did **not** end up using `checkin_time`/`checkout_time` — it's driven entirely by the `status` enum above.
- **`confirmed`** (`boolean`, default `true`) and **`postcode`** — both live, ordinary columns; `postcode` is the newest addition to this table (added via `supabase/migrations/20260718130728_add_postcode_column_to_jobs.sql`).
- **`sortorder`** — manual drag-to-reorder position within a day's job list.

### 3.2 `certs` — compliance certificates

One row per issued certificate (Gas Safety, EICR, PAT, EPC, Fire Alarm, etc.), linked to the job it came from via the one real `certs.jobid → jobs.id` foreign key.

- **`appliances`** (`jsonb`, default `[]`) — new since the PAT integration. This is the PAT (Portable Appliance Test) test log: an array of individual appliance test records, only populated/relevant for cert types where `app_settings`'s `certTypes[].hasAppliances` is true. See Section 6 for the exact shape.
- **`certnum`** — the human-readable, auto-generated certificate reference number (see `generateCertRef()` in `apps/office/certs.js`), separate from `id`.
- **`noexpiry`** (`boolean`) — true for cert types that don't expire; when true, the "missing expiry" reminder/audit logic skips this record instead of flagging it.
- **`notresponding`** (`boolean`) — flags a cert whose subject (landlord/tenant) isn't responding to arrange access for a renewal; drives the "NO RESPONSE" status pill in the Certificates screen.
- **`pdf_url`/`pdf_path`** — the stored, generated PDF for this certificate (named after `certnum`, not a random id — see the commit history for that change).

### 3.3 `cert_reminder_log`

Exists to prevent a duplicate scheduled expiry reminder being sent for the same cert. `days_before` and `method` (default `'whatsapp'`) record what kind of reminder fired. A `days_before`/`sent_at`-keyed dedup table, one row per reminder actually sent — not a general log.

### 3.4 `invoices` — every kind of billing document

Invoices, proformas, disposable one-off invoices, and credit notes all live in this one table, distinguished by `status`/`type`/`isCreditNote` rather than separate tables. Real `status` values seen written in code: `Draft`, `Awaiting Payment`, `Paid`, `Credit Note`, plus `Cancelled`/`Disposable` (checked for, e.g. in `apps/portal/invoice-pdf.js`'s payability check). Real `type` values: `invoice`, `proforma` (a proforma is converted to a real invoice in place, via `sendInvEmail`'s conversion path, which flips `type` and assigns a real `number`).

- **`items`** (`jsonb`, default `[]`, `CHECK (valid_invoice_items(items))`) — **this is where the real invoice content lives.** The database-level check constraint (`valid_invoice_items`, live-verified) only rejects negative `qty`/`unit` values; everything else about the shape is enforced by convention, not the database. See Section 6 for the exact element shape and a worked example.
- **`subtotal`/`vat_rate`/`vat_amount`/`total`/`paid_amount`** — flat numeric columns that look like an older, pre-`items` invoice design. Confirmed: **`total` is never read anywhere in the app code.** The number actually shown on screen and on generated PDFs is computed live from `items` every time, via the shared `calcLineItemsTotal()` in `packages/business/invoice-total.js` (used identically by both the Office App and Client Portal). `vat_rate` does carry a real `CHECK (vat_rate >= 0 AND vat_rate <= 100)` constraint, and `subtotal`/`vat_amount`/`paid_amount` are written by some code paths, but none of these columns are what actually drives the displayed total.
- **`client_person_id`/`client_agency_id`** (`uuid`) — unlike `jobs.client_person_id`, **neither of these is ever written by any application code today.** They're read (with a fallback) by the Stripe checkout Edge Function and the `portal_get_invoices` RPC (Section 5.2), but since nothing populates them, that FK-style path can never actually match on a real invoice right now — the name-matching fallback is what's really authorizing every "Pay Now" click in production.
- **`jobaddress`/`propertyaddress`** — two overlapping columns for the same concept (the job's address on the invoice); which one gets populated depends on which invoice-creation code path was used. A real, unresolved inconsistency, not a misunderstanding.
- **`bill_to_override`** (`boolean`, default `false`) — carries its own live database comment (verified via `pg_catalog`, not just code): *"When true, billtoname/billtoaddress on this invoice are a display-only override and must not be synced back to jobs.landlordname or the persons/agencies table."* This is the mechanism that lets an office user bill someone other than the job's actual landlord/agency for one invoice without corrupting the Directory record.
- **`invoicetype`** (default `'landlord'`) vs **`type`** — two different classification columns. `invoicetype` distinguishes landlord-billed vs agency-billed; `type` distinguishes invoice/proforma/credit-note-ish document kind. Easy to confuse; they answer different questions.
- **`certtypes`** — a plain **`text`** column (not `jsonb`, unlike `jobs.certtypes`), populated as a comma-joined string of cert type *names* at invoice-creation time (`(j.certTypes||[]).join(', ')`, `apps/office/main.js:3242`), e.g. `"Gas Safety, Electrical (EICR)"`. See Section 6.
- **`pdf_url`/`pdf_path`** — the stored generated invoice PDF.

### 3.5 `payments`

One row per payment recorded against an invoice. `inv_id` maps from the JS field `invId`. No enforced FK to `invoices` — linked by matching `inv_id` to `invoices.id` in application queries only.

### 3.6 `invoice_audit`

A per-invoice audit trail (`created`/`sent`/`failed`/`converted` events). This table sat completely unused (0 rows, dead code path) until **2026-08-05**, when it was wired up for real: `sendInvEmail()` in `apps/office/main.js` now writes a `sent` row on successful email, a `failed` row (with the error detail) if sending fails, and the proforma→invoice conversion path writes a `converted` row. Uses a `bigint identity` PK, unlike almost everything else in this schema.

### 3.7 `persons`, `agencies`, `agents` — the Directory

Three related tables for landlords/individual clients (`persons`), letting agencies (`agencies`), and individual agents at an agency (`agents`).

- **`persons.roles`** (`jsonb`, default `[]`) — how one person can be tagged as more than one thing at once (e.g. both a landlord and a client). The UI (`apps/office/directory.js`) currently only ever *writes* three values into this array: `'landlord'`, `'client'`, `'subcontractor'` — checked via three checkboxes on the person form. A `'builder'` value is also read/filtered for in one export path (`master-xlsx-export.js`) as a legacy synonym, but nothing currently writes it. Example: `roles: ["landlord", "client"]`.
- **`persons.archived`** (`boolean`, default `false`) — the newest column on this table (added 2026-08-01). A soft-hide flag for the Directory's landlord list — archiving a person keeps every job/invoice/cert linked to them intact, it just removes them from the default active-list view (with an "N archived, show them" toggle).
- **`agents.agencyid → agencies.id`** — the one place in the whole schema where a real, enforced, actively-relied-upon ID-based FK genuinely exists (Section 5.1). The Office App's agency cards show a live count of linked agents by querying on this.
- **`portal_token`/`portal_enabled`/`last_portal_access`** (on `agencies` and `jobs`) — confirmed still **completely unreferenced** by any application code today, same as the old docs found. The real mechanism the Client Portal uses is the row's own `id` in the URL (`?id=<persons.id or agencies.id or agents.id>&type=landlord|agency|agent`), not a separate token column.
- **`portal_pin_hash`/`portal_pin_fail_count`/`portal_pin_locked_until`** (on `persons`, `agencies`, `agents`, and `users`) — this is the real, actively-used protection layer, added specifically because the URL-`id`-only link above has no expiry and no revoke. See Section 6 for how it works and how it differs from `portal_token`.
- **`bankname`/`bankacc`/`banksort`/`bankref`** — present on all three Directory tables plus `agencies`, used for displaying payment details on invoices/PDFs.

### 3.8 `portal_contacts`

A short, manually-curated list of "who to contact" entries shown inside the Client Portal (e.g. office phone numbers for portal visitors), ordered by `sort_order`. Independent of the `persons`/`agencies`/`agents` Directory — this is portal-chrome content, not a client record.

### 3.9 `users` — login accounts

One row per person who can log in; office staff and field engineers share this table, distinguished by `role`.

- **`role`** (default `'engineer'`) — the live column stores **lowercase** values: `admin`, `manager`, `finance`, `staff`, `viewer`, `engineer`. The Office App maps these to capitalized display/permission roles via an explicit table (`roleMap` in `apps/office/main.js:1414`): `Admin`, `Manager`, `Finance`, `Staff`, `Viewer`, `Engineer` — anything not in the map falls back to `Staff`. A user with role `Engineer` is actively blocked from logging into the Office App and redirected to the Engineer app.
- **`can_edit`/`can_delete`/`can_invoice`/`can_finance`, `see_landlord`/`see_landlord_phone`/`see_agent`/`see_contact`/`see_price`** — per-user permission flags, read at login and enforced in the UI (show/hide, not a second server-side check).
- **`portal_pin_hash`/`portal_pin_fail_count`/`portal_pin_locked_until`** — present here too, but this is a *separate* concept from the client-portal PIN family on `persons`/`agencies`/`agents`: this trio is currently schema-only for `users` (no PIN-login flow for office/engineer accounts was found wired up in the apps — office/engineer auth goes through Supabase Auth + `auth_id` instead).
- **`is_protected`** — marks an account (the emergency-admin account) that can't have its role changed or be demoted, even by another admin, from the Team management screen.
- **`session_token`/`session_expires`** — confirmed unreferenced by any current app code.

### 3.10 `engineer_requests`

A single shared inbox for two unrelated request types, told apart only by `type`: engineer overtime/leave requests (submitted from the Engineer app) and client "please book a job" requests (submitted from the Client Portal, `type='portal_request'`). `status` (default `'pending'`) plus `office_reply` is how the Office App's "Job Requests" inbox responds to either kind.

### 3.11 `engineer_alerts`

Office-to-engineer broadcast messages. `target` (default `'all'`) is either `'all'` or a specific engineer's name — still a name match, not an FK. `expires` is set to roughly one hour after `created`; the Engineer app polls this table and shows a full-screen popup for anything new and unexpired.

### 3.12 `expenses` / `overtime`

Engineer-facing cost tracking, both feeding the P&L Dashboard and payslip calculations.

- `expenses.jobref` links an expense to a job by the job's human-readable `jobnum`/reference (text match, not FK).
- `overtime.type` real values, confirmed from the UI: `overtime-1` (fixed 1h), `overtime-2` (fixed 2h), `overtime-custom` (arbitrary hours), `halfday` (−0.5h, an absence), `absent` (−1h, a full-day absence). Negative `hours` values are deliberate — they're payroll deductions, not a data error.

### 3.13 `attachments`

The database "index card" for every file in Supabase Storage — the file bytes live in Storage, this table is what lets the apps find/list/delete them by `jobid`.

- **`photo_slot`/`photo_role`** — support paired before/after job photos. `photo_role` is `'before'` or `'after'`; photos sharing the same `photo_slot` number on a job are shown as one before/after pair in the UI (`apps/engineer/photos.js`).

### 3.14 `job_comments`

An internal notes thread on a job, office-only (not visible to engineers or the Client Portal). Straightforward: `jobid`, `author`, `message`, `ts`.

### 3.15 `app_settings` — the single-row configuration store

Not a normalized settings table — the entire application configuration (company details, invoice/WhatsApp templates, certificate type definitions, the full Properties list, per-engineer permission overrides, VAT settings, etc.) is serialized as **one JSON object** and stored as the `value` of a single row where `key = '__all__'`.

Verified directly in `apps/office/main.js` (`saveAllSettings()`/`_pushAllSettingsToDb()`/`_loadSettingsFromDb()` — not in `packages/data/mapping.js`; that shared layer handles per-row table mapping, not this single-row blob):
- Writing: every key currently on the in-memory `S` settings object is serialized into one JSON blob and `POST`ed with `Prefer: resolution=merge-duplicates` (an upsert) to `app_settings`, **except** `users` and `engineers`, which are explicitly skipped (`skip=['users','engineers']`) — those live in the real `users` table instead and would be redundant/stale if duplicated here.
- Reading: on load, the app fetches `app_settings?key=eq.__all__&select=value`, `JSON.parse`s it, and merges every key back into `S` (again skipping `users`/`engineers`).
- `updated` (`bigint`, default `0`) — epoch-seconds (not milliseconds, unlike almost every other timestamp in this schema) of the last settings save.

### 3.16 `activity` / `audit_log`

Two different logs, deliberately different in scope:
- **`activity`** — a broad, general "what just happened" feed, written by almost every create/edit/delete action across the Office App, and by the Client Portal on request submission. No automated feature reads it back; it's a one-way, human-facing feed.
- **`audit_log`** (`jsonb` `details` column, `uuid` PK) — a stricter, narrower, Admin-only trail. Not a catch-all — only specific sensitive event types are logged here (e.g. job deletion, invoice amount changes), captured with `staff_name`/`staff_email`/`staff_role` for accountability.

### 3.17 `push_subscriptions`

Schema for a **planned but not yet shipped** Web Push notification feature (see `PHASE6_PUSH_NOTIFICATIONS_SQL.md` / `PHASE6B_PUSH_EDGE_FUNCTION.md`). `entity_table`/`entity_id` identify who the subscription belongs to (e.g. a specific engineer's `users` row); `endpoint`/`p256dh`/`auth` are the standard Web Push subscription fields. Confirmed: no application code currently writes to this table, and no `supabase/functions/` Edge Function for actually *sending* a push exists yet in the repo (the Office App's admin Storage Usage dashboard does list it as a browsable table, which is its only current reference). It has **zero RLS policies** despite RLS being enabled — meaning it's currently unreachable via the public API at all (any policy-less table with RLS on defaults to deny for every role except `service_role`, which bypasses RLS). That's an appropriate posture for a table meant to hold Web Push credentials.

---

## 4. Relationships

### 4.1 Real, enforced foreign keys

Exactly five — confirmed directly from the Postgres constraint catalog, not inferred from code:

| Constraint | Column | References |
|---|---|---|
| `agents_agencyid_fkey` | `agents.agencyid` | `agencies.id` |
| `attachments_jobid_fkey` | `attachments.jobid` | `jobs.id` |
| `certs_jobid_fkey` | `certs.jobid` | `jobs.id` |
| `invoices_jobid_fkey` | `invoices.jobid` | `jobs.id` |
| `job_comments_jobid_fkey` | `job_comments.jobid` | `jobs.id` |

Every other cross-table relationship in this schema — jobs-to-invoices by `linkedinvid`, jobs/invoices-to-persons/agencies by name or by `client_person_id`/`client_agency_id`, payments-to-invoices by `inv_id`, engineer/user matching by name — is **not** a database constraint. Nothing stops an insert with a dangling reference.

### 4.2 The loose reference pattern — `client_person_id`/`client_agency_id`, and why it's not a real FK

This is the schema's most important gotcha, and it is genuinely mixed in production, not just theoretically possible:

**Why these can never be enforced foreign keys as currently typed:** `jobs.client_person_id`, `jobs.client_agency_id`, `invoices.client_person_id`, and `invoices.client_agency_id` are all `uuid` columns. But the tables they're meant to point at — `persons.id` and `agencies.id` — are `text` columns. Postgres cannot declare a foreign key constraint across a type mismatch like this without changing one side's column type, which nothing in this schema's history has done. The values happen to *look* like UUIDs today (because `persons.id`/`agencies.id` are populated by the same `uid()` v4-format generator used everywhere else), so the values are compatible in practice — but the constraint itself was never, and currently can't be, declared.

**Which half is actually wired up — and which isn't:**
- `jobs.client_person_id` **is actively written**, on every job save, by `_resolveLandlordPerson()` — the current codebase genuinely finds-or-creates the matching `persons` row and links it by ID, including asking the office user to resolve a conflict if the job's landlord details disagree with an existing Directory entry.
- `jobs.client_agency_id`, `invoices.client_person_id`, and `invoices.client_agency_id` are **never written by any application code** — confirmed by full-text search across all three apps. They exist as columns, always `NULL` in practice, read only as an FK-style *fast path* that currently can never match anything.

**The result: two competing linkage mechanisms exist side by side, and both are actively used.** The `portal_get_jobs`/`portal_get_invoices` Postgres RPCs (used by the Client Portal) and the `create-checkout-session` Edge Function (used for Stripe payment links) both implement the *same* two-step resolution on every call: try the ID-based FK-style column first, and if that doesn't match, fall back to matching the portal visitor's resolved name (`persons.name`/`agencies.name`) against the invoice's own free-text fields (`clientname`, `landlordname`/`agencyname`, `billtoname`). A direct code comment on this exact fallback in `supabase/functions/create-checkout-session/index.ts` states it plainly: *"The FK columns are unpopulated on today's real invoices, so the name fallback is the path that actually authorizes real-world Pay Now clicks right now."* In other words: for jobs, the ID-based link is real and growing; for invoices, only the legacy name-matching path currently does anything at all — and because `jobs.client_person_id` gets backfilled going forward while historical/invoice data never does, a given account's data can genuinely be linked one way on some rows and the other way on others.

---

## 5. JSONB & Structured Column Shapes

Ground truth taken from the actual object literals the app code constructs — not the column's `jsonb` type alone, which says nothing about shape.

**`jobs.certtypes`** — array of cert-*type IDs* (matched against `app_settings`'s `certTypes[].id`/`.name`):
```json
["ct1", "ct3"]
```

**`invoices.certtypes`** — a completely different shape on a similarly-named column: plain `text`, a comma-joined string of cert-type *names*, built once at invoice-creation time and never updated after:
```
"Gas Safety, Electrical (EICR)"
```

**`invoices.items`** — the real line-item data actual totals are computed from (`calcLineItemsTotal()`, `packages/business/invoice-total.js`). Each element: `{desc, qty, unit, vat}` — `vat` is a per-line boolean (does VAT apply to this line), `unit` is the unit price, not a unit-of-measure string:
```json
[
  { "desc": "Gas Safety Certificate", "qty": 1, "unit": 85, "vat": true },
  { "desc": "Call-out fee", "qty": 1, "unit": 45, "vat": false }
]
```
The database-level `valid_invoice_items(items)` check constraint only validates that `qty`/`unit` on every element are non-negative numbers where present — it does not enforce the presence of `desc`/`vat` or reject unrelated shapes.

**`certs.appliances`** — the PAT test log, new with the PAT integration, deliberately ported field-for-field from a standalone PAT-Test app ("same field shape... so existing PAT knowledge/muscle-memory carries over directly" — `apps/office/certs.js`). Each element:
```json
{
  "id": "b6b6...-uuid",
  "assetId": "0001",
  "description": "Kettle",
  "testInstrument": "Seaward PrimeTest 250",
  "date": "2026-08-01",
  "retestPeriod": 12,
  "nextTest": "2027-08-01",
  "result": "Pass"
}
```
Only populated for cert types where the matching entry in `app_settings`'s `certTypes[]` has `hasAppliances: true`.

**`persons.roles`** — array of role tags, values actively written today: `"landlord"`, `"client"`, `"subcontractor"`:
```json
["landlord", "client"]
```

**`audit_log.details`** — free-form `jsonb`, shape depends on `type` (event-specific payload, e.g. old/new invoice amount for an amount-change event).

---

## 6. Portal Access: `portal_token` vs `portal_pin_hash`

Two entirely different, non-overlapping mechanisms exist on the Directory tables, easy to conflate by name:

- **`portal_token`** (on `jobs` and `agencies`, random-hex-default) — confirmed dead. Not read or written by any of the three apps today. The Client Portal never actually used a separate token; it identifies the visitor by the row's own `id` directly in the URL (`?id=<uuid>&type=landlord|agency|agent`).
- **`portal_pin_hash`/`portal_pin_fail_count`/`portal_pin_locked_until`** (on `persons`, `agencies`, `agents`, and `users`) — the real, live security layer, added specifically because a bare `?id=` link has no expiry and no revoke. The office can **reset** a PIN (never *reveal* it — it's `crypt()`-hashed via `pgcrypto`, not stored reversibly), which forces the client to set a brand-new 6-digit PIN next time they open their unchanged link. Five wrong attempts locks the PIN out for a period (tracked via `portal_pin_locked_until`); `portal_pin_fail_count` resets to zero on a successful verify or a fresh PIN set. Enforced through three `SECURITY DEFINER` RPCs (`portal_pin_status`, `portal_pin_set`, `portal_pin_verify`) rather than direct table access, so the anon key alone can't read or brute-force the hash.

`portal_enabled`/`last_portal_access` (on `agencies`/`persons`) round out the same dead-column family as `portal_token` — present, defaulted, and confirmed unreferenced by any current app code.

---

## 7. Row Level Security — Summary

RLS is enabled on all 21 tables in `public` (live-confirmed via `list_tables` and `pg_policies`). Full per-table policy definitions, the anon-vs-authenticated boundary, and the `SECURITY DEFINER` RPC exceptions belong in [`06-supabase.md`](./06-supabase.md) — not duplicated here to avoid the two documents drifting apart. For quick orientation, current policy counts per table:

| Table | Policies | Table | Policies |
|---|---|---|---|
| `jobs` | 8 | `certs` | 3 |
| `attachments` | 4 | `engineer_alerts` | 2 |
| `engineer_requests` | 4 | `invoice_audit` | 2 |
| `users` | 3 | `portal_contacts` | 2 |
| `activity` | 2 | `app_settings` | 2 |
| `agencies` | 1 | `agents` | 1 |
| `audit_log` | 1 | `cert_reminder_log` | 1 |
| `expenses` | 1 | `invoices` | 1 |
| `job_comments` | 1 | `overtime` | 1 |
| `payments` | 1 | `persons` | 1 |
| `push_subscriptions` | **0** | | |

`push_subscriptions` having zero policies while RLS is enabled means it's effectively unreachable through the public API in any role except `service_role` — consistent with it being pre-built schema for a not-yet-shipped feature that would need server-side (Edge Function) access only.

---

## 8. Appendix — Full Column Reference

Types, nullability, and defaults below are transcribed directly from the live Postgres catalog. `NO` under Nullable means `NOT NULL`.

### `activity`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | text | NO | |
| msg | text | YES | |
| type | text | YES | |
| ts | bigint | YES | epoch ms `now()` |
| created | timestamp (no tz) | YES | `now()` |

### `agencies`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | text | NO | |
| name | text | NO | |
| phone | text | YES | |
| email | text | YES | |
| wa | text | YES | |
| address | text | YES | |
| website | text | YES | |
| notes | text | YES | |
| portal_token | text | YES (unique) | random hex |
| created | bigint | YES | |
| modified | bigint | YES | |
| portal_enabled | boolean | YES | `false` |
| last_portal_access | timestamptz | YES | |
| bankname / bankacc / banksort / bankref | text | YES | |
| portal_pin_hash | text | YES | |
| portal_pin_fail_count | integer | NO | `0` |
| portal_pin_locked_until | timestamptz | YES | |

### `agents`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | text | NO | |
| name | text | NO | |
| phone / email / wa / title / notes | text | YES | |
| agencyid | text (FK → agencies.id) | YES | |
| created / modified | bigint | YES | |
| portal_pin_hash | text | YES | |
| portal_pin_fail_count | integer | NO | `0` |
| portal_pin_locked_until | timestamptz | YES | |

### `app_settings`
| Column | Type | Nullable | Default |
|---|---|---|---|
| key | text | NO (PK) | |
| value | text | NO | |
| updated | bigint | YES | `0` |

### `attachments`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | text | NO | |
| jobid | text (FK → jobs.id) | YES | |
| name / type / mime / storage_path / url / uploaded_by_name | text | YES | |
| created | bigint | YES | epoch ms `now()` |
| photo_slot | integer | YES | |
| photo_role | text | YES | |

### `audit_log`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| type | text | YES | |
| staff_name / staff_email / staff_role | text | YES | |
| details | jsonb | YES | |
| created_at | timestamptz | YES | `now()` |

### `cert_reminder_log`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | text | NO | `gen_random_uuid()::text` |
| cert_id | text | NO | |
| sent_at | timestamptz | NO | `now()` |
| days_before | integer | YES | |
| method | text | YES | `'whatsapp'` |

### `certs`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | text | NO | |
| address / type / landlord / issuedate / expirydate / certnum | text | YES | |
| jobid | text (FK → jobs.id) | YES | |
| jobnum / engineer / notes | text | YES | |
| noexpiry | boolean | YES | `false` |
| created | bigint | YES | |
| pdf_url / pdf_path / agent / email / phone | text | YES | |
| notresponding | boolean | YES | |
| appliances | jsonb | YES | `[]` |

### `engineer_alerts`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| target | text | YES | `'all'` |
| type | text | YES | `'info'` |
| title / message / sent_by | text | YES | |
| created / expires | bigint | YES | |
| status | text | YES | `'active'` |

### `engineer_requests`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | text | NO | |
| engineer_name | text | NO | |
| type | text | NO | |
| date | text | YES | |
| hours | numeric | YES | |
| rate / job / leave_type / leave_from / leave_to / notes | text | YES | |
| status | text | YES | `'pending'` |
| office_reply | text | YES | |
| created | bigint | YES | epoch ms `now()` |

### `expenses`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | text | NO | |
| date / engineer / category / description | text | YES | |
| cost | numeric | YES | `0` |
| receipt | text | YES | |
| created | bigint | YES | |
| jobref | text | YES | |
| modified | bigint | YES | |

### `invoice_audit`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | bigint (identity) | NO | |
| invoiceId | text | NO | |
| action / details / from / to / user | text | YES | |
| timestamp | bigint | YES | |

### `invoices`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | text | NO | |
| number | text | YES | |
| clientid / clientname / clientemail / clientaddr / clientwa | text | YES | |
| date / duedate / description | text | YES | |
| jobid | text (FK → jobs.id) | YES | |
| items | jsonb | YES | `[]`, `CHECK valid_invoice_items(items)` |
| status | text | YES | `'Draft'` |
| created | bigint | YES | |
| agentcc / linkedjobid / jobref / terms / notes | text | YES | |
| client_person_id / client_agency_id | uuid | YES | |
| subtotal | numeric | YES | `0` |
| vat_rate | numeric | YES | `20.00`, `CHECK 0–100` |
| vat_amount | numeric | YES | `0` |
| total | numeric | YES | `0` |
| paid_amount | numeric | YES | `0` |
| pdf_url | text | YES | |
| modified | timestamptz | YES | `now()` |
| isagency | boolean | YES | `false` |
| agencyaddress / landlordname / propertyaddress / jobnum / agentname / agentemail / agencyname / billtoname / billtoaddress / jobaddress | text | YES | |
| invoicetype | text | YES | `'landlord'` |
| type / linkedinvid / reason / certtypes / jobdate / engineer | text | YES | |
| bill_to_override | boolean | NO | `false` |
| pdf_path | text | YES | |

### `job_comments`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | text | NO | |
| jobid | text (FK → jobs.id) | YES | |
| author / message | text | YES | |
| ts | bigint | YES | epoch ms `now()` |

### `jobs`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | text | NO | |
| jobnum / date | text | YES | |
| address | text | NO | |
| referrer / trade | text | YES | |
| certtypes | jsonb | YES | `[]` |
| engineer / description / timeslot / access / contact | text | YES | |
| price | numeric | YES | `0` |
| notes | text | YES | |
| priority | text | YES | `'Normal'` |
| status | text | YES | `'Pending'` |
| landlordname / landlordphone / landlordemail / landlordaddr / landlordwa / landlordnotes | text | YES | |
| agencyname / agencyphone / agencyemail / agencynotes | text | YES | |
| agentname / agentphone / agentemail | text | YES | |
| portal_token | text | YES (unique) | random hex |
| created / modified | bigint | YES | |
| invnumber / linkedinvid | text | YES | |
| sortorder | integer | YES | |
| client_person_id / client_agency_id | uuid | YES | |
| checkin_time / checkout_time | timestamptz | YES | |
| checkin_location | text | YES | |
| engineer_signature / client_signature | text | YES | |
| invoice_id | uuid | YES | |
| agencyaddr / agencyaddress | text | YES | |
| confirmed | boolean | YES | `true` |
| postcode | text | YES | |

### `overtime`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | text | NO | |
| engineer / date / type | text | YES | |
| hours | numeric | YES | `0` |
| label / notes | text | YES | |
| created | bigint | YES | |

### `payments`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | text | NO | |
| inv_id | text | NO | |
| date | text | YES | |
| amount | numeric | NO | `0` |
| method | text | YES | `'Bank Transfer'` |
| ref / recorded_by / notes | text | YES | |
| created | bigint | YES | |

### `persons`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | text | NO | |
| name | text | NO | |
| phone / email / wa / address / notes | text | YES | |
| roles | jsonb | YES | `[]` |
| rate | numeric | YES | |
| created / modified | bigint | YES | |
| portal_token | uuid | YES | `gen_random_uuid()` |
| portal_enabled | boolean | YES | `false` |
| last_portal_access | timestamptz | YES | |
| bankname / bankacc / banksort / bankref / agencyid / trade | text | YES | |
| hourly_rate | numeric | YES | `0` |
| default_trade / whatsapp | text | YES | |
| portal_pin_hash | text | YES | |
| portal_pin_fail_count | integer | NO | `0` |
| portal_pin_locked_until | timestamptz | YES | |
| archived | boolean | NO | `false` |

### `portal_contacts`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | text | NO | |
| label / contact_name / phone | text | YES | |
| sort_order | integer | YES | `0` |
| created | timestamptz | YES | `now()` |

### `push_subscriptions`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | bigint (identity) | NO | |
| entity_table / entity_id | text | NO | |
| endpoint | text | NO (unique) | |
| p256dh / auth | text | NO | |
| created_at | timestamptz | NO | `now()` |

### `users`
| Column | Type | Nullable | Default |
|---|---|---|---|
| id | text | NO | |
| name | text | NO | |
| email / phone | text | YES | |
| role | text | YES | `'engineer'` |
| active | boolean | YES | `true` |
| created | bigint | YES | epoch ms `now()` |
| last_lat / last_lng | double precision | YES | |
| last_seen | bigint | YES | |
| last_accuracy | integer | YES | |
| auth_id | uuid | YES | |
| can_edit | boolean | YES | `true` |
| can_delete | boolean | YES | `false` |
| can_invoice | boolean | YES | `true` |
| can_finance | boolean | YES | `false` |
| see_landlord / see_landlord_phone / see_agent / see_contact | boolean | YES | `true` |
| see_price | boolean | YES | `false` |
| internal_email | text | YES | |
| session_token | text | YES | |
| session_expires | bigint | YES | |
| is_protected | boolean | YES | `false` |
| pin_hash | text | YES | |
| pin_fail_count | integer | NO | `0` |
| pin_locked_until | timestamptz | YES | |
| pin_reset_allowed | boolean | NO | `false` |
