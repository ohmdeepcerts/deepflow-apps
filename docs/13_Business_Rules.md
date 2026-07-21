# 13 — Business Rules

This document extracts every conditional business rule found in the DeepFlow codebase — every "if this, then that," every threshold number, every permission check — across all three apps (`index.html`, `engineer.html`, `client-portal.html`).

**Cross-references:** these rules are what drive the workflows in [12_Workflows.md](12_Workflows.md); the roles referenced throughout are defined in full in [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md); the database columns referenced throughout are documented in [05_Database.md](05_Database.md).

## 0. The One Rule That Governs All the Others

**Every rule in this document is enforced entirely in JavaScript, running in the user's own browser.** There is no backend server re-checking any of these rules, and (per the Database Handbook) the database's own security rules are currently wide open on top of that. This means every rule below should be read as **"this is what the app's interface does"**, not **"this is what is actually, unbreakably enforced."** Anyone who called the underlying database API directly, bypassing the app's screens, could ignore every rule in this document. Where a rule has real teeth (rare, and called out explicitly), it's because a specific server-side check was found — otherwise, assume client-side only.

---

## 1. Access & Permission Rules

### 1.1 The Master Switch: `S.pinLock`

- **Rule:** If the settings flag `pinLock` is turned off, the Office app skips authentication entirely **and every permission check in the system automatically returns "allowed."**
- **Exact mechanism:** `getUserPerm(perm)` — the single function every permission check in the Office app goes through — begins with `if(!S.pinLock || !_appUser) return true;`. This means turning `pinLock` off doesn't just skip the login screen (Section 11.3); it also makes every single named permission (`canEdit`, `canDelete`, `canInvoice`, `canFinance`, `seeLandlord`, `seeLandlordPhone`, `seeAgent`, `seeContact`, `seePrice`) return `true` for everyone, regardless of role.
- **Why it exists:** almost certainly a convenience for single-user/testing setups where a whole permission system would be unnecessary friction.
- **What breaks if this is misunderstood:** an admin who thinks they've "just disabled the PIN screen" has actually disabled the entire access-control system.

### 1.2 The Five Roles

A person's `role` (stored on their `users` table row) is one of: `Admin`, `Manager`, `Finance`, `Staff`, `Viewer` — plus `Engineer`, which is a special case handled separately (Section 1.11).

### 1.3 Page/Menu Visibility Rule, by Role

Every page/nav item is hidden by default; each role's list below is exactly what gets switched back on (`applyUserPermissions()`):

| Role | Pages shown |
|---|---|
| **Admin** | Every page that exists (Dashboard, Jobs, Invoices, Statements, Expenses, Timesheets, Reports, Job Requests, Directories, Properties, Certificates, Client View, Settings, Live Maps, Engineer Reports, Audit Log, Team) |
| **Manager** | Dashboard, Jobs, Invoices, Statements, Reports, Job Requests, Directories, Properties, Certificates, Client View, Settings, Live Maps — **not** Engineer Reports or Audit Log |
| **Finance** | Dashboard, Invoices, Statements, Reports, Jobs, Directories, Properties, Settings — **not** Job Requests, Certificates, Client View, or Maps |
| **Staff** | Dashboard, Jobs, Invoices, Statements, Job Requests, Directories, Properties, Certificates, Client View — **no Settings page at all** |
| **Viewer** | **Nothing.** This role is checked by the permission function (`getUserPerm` returns `false` for every permission it's asked about, unconditionally), but the nav-visibility code only has explicit rules for Admin/Manager/Finance/Staff — there is no `else` branch for Viewer. **A Viewer-role user logging in sees a completely blank sidebar with no menu items at all** — this looks like an unfinished role rather than an intentional read-only mode. |

### 1.4 Settings Sub-Tab Visibility Rule, by Role

Within the Settings page itself, a second, separate rule controls which tabs show:

| Settings tab | Admin | Manager | Finance | Staff |
|---|---|---|---|---|
| Company | ✅ | ❌ | ❌ | (no Settings access at all) |
| Appearance | ✅ | ✅ | ❌ | — |
| Team | ✅ | ✅ | ❌ | — |
| Trades | ✅ | ✅ | ❌ | — |
| Invoicing | ✅ | ✅ | ✅ | — |
| WhatsApp | ✅ | ✅ | ❌ | — |
| Jobs (config) | ✅ | ✅ | ❌ | — |
| Notifications | ✅ | ❌ | ❌ | — |
| Data (backup/storage) | ✅ | ❌ | ❌ | — |
| Guide & SQL | ✅ | ❌ | ❌ | — |

### 1.5 Who Can Edit

- **Rule:** `canEdit` is `true` automatically for Admin and Manager. For Staff, it depends on the individual `can_edit` flag stored on that person's `users` row (defaults to `true` unless explicitly turned off). For Finance and Viewer, `canEdit` is never granted by the general rule (Finance's Jobs page is explicitly rendered read-only — edit/delete buttons are hidden via `applyUserPermissions()`).
- **Enforcement:** hides the relevant buttons in the interface. There is **no** server-side check preventing an edit if someone bypassed the interface.

### 1.6 Who Can Delete

- **Rule:** `canDelete` is `true` for Admin always. For Manager, Staff, Finance, it depends on the individual `can_delete` flag on their `users` row (defaults to whatever was set when their account was created by `teamAdd()` — Admins and Managers get `can_delete:true` by default when added, everyone else gets `false` by default).
- **Special case — deleting a job specifically** is one of only two actions tracked in the strict `audit_log` (Database Handbook, Section 3.13) — so even though the permission check itself is soft (client-side), the *consequence* of a deletion, once it happens, is durably recorded.

### 1.7 Who Can Invoice

- **Rule:** `canInvoice` is `true` for Admin/Manager always; for Staff it follows their individual `can_invoice` flag (defaults `true`).

### 1.8 Who Can See Sensitive Fields (Landlord, Agent, Price, Contact Details)

- **Rule:** Admin and Manager always see everything. Staff's visibility of landlord name/phone, agent details, contact details, and price is controlled individually per-field by their own `see_landlord`, `see_landlord_phone`, `see_agent`, `see_contact`, `see_price` flags (all default `true` unless specifically turned off for that person).
- **Finance role default:** when a Finance user is created via `teamAdd()`, they are given `see_landlord_phone:!isEng` → effectively `true`, and `see_price:!isEng && role!=='viewer'` → `true` — Finance is meant to see everything relevant to money.

### 1.9 Who Can Manage the Team / Create Logins

- **Rule:** the entire Team management screen is gated to `_appUser?.role === 'Admin'` only, checked at the very start of `loadTeam()` — Managers cannot use this screen even though they can see many other Settings tabs.
- **A second, narrower rule inside the permission function** also explicitly blocks Managers from the `canManageUsers` permission specifically, even though Managers otherwise get "yes to everything."

### 1.10 Emergency Admin Fallback Rule

- **Rule:** a hardcoded list of protected email addresses (`EMERGENCY_ADMINS`) always gets Admin access on login, regardless of what their `users` profile row currently says. If their profile is missing, one is created automatically with full permissions. If their profile exists but its role isn't `admin`, the role is silently corrected back to `admin` and the correction is saved to the database.
- **Why it exists:** so the business owner can never be permanently locked out of their own system by an accidental permission change.

### 1.11 Engineer Role Gating (cross-app)

- **Rule:** the Office app explicitly refuses login for anyone whose profile role is `engineer` — they're told to use the Engineer app instead. The Engineer app does the exact reverse: it refuses anyone whose profile role is **not** `engineer`, and additionally requires `active === true` on their profile.
- **Consequence:** a single `users` table serves two mutually exclusive apps, split entirely by this one field.

### 1.12 Per-Engineer Field-Visibility Permissions — Configured But Not Enforced

- **Rule (as designed):** an Admin/Manager can configure, per individual engineer, whether they're allowed to see: price, landlord details, tenant details, agent details, notes, invoice info (`S.engPerms[engineerId].seePrice` etc., defaulting to the global `S.engSeePrice` etc. if not overridden for that person).
- **Rule (as actually implemented):** the Engineer app's source code contains **zero references** to `engPerms` anywhere. **This configuration currently has no effect on what an engineer actually sees.**

### 1.13 Who Can Upload Photos/Files

- **Rule:** any currently logged-in, active engineer can upload to **any job they have open** — there is no additional permission flag checked before an upload (`handleUpload`/`_handleBAUpload` only check that a job is currently open, `currentJob`, not that the job belongs to that engineer specifically, nor any role/permission flag).
- **Office and Client Portal apps never upload** — this action is exclusively available in the Engineer app.
- **Risk implication:** because the upload call is a direct database/storage write using the same public API pattern as everything else, and because there's no server-side check tying a job's `engineer` field to the uploader's identity, an engineer's app could technically be made to upload a file against a job that isn't theirs — the interface simply never offers this by default.

---

## 2. Job Status & Lifecycle Rules

### 2.1 The Six Statuses

`Pending`, `In Progress`, `Completed`, `Invoiced`, `Cannot Access`, `Cancelled` — defined once as a fixed, shared list (`STATUS` constant) copied identically into both the Office and Engineer apps.

### 2.2 No Formal State Machine — Any Status Can Follow Any Status

- **Rule:** `quickStatus(id, status)` — the function every status-change button/dropdown ultimately calls — contains exactly one check: `if(old===status) return;` (skip if nothing actually changed). **There is no rule anywhere preventing, for example, moving a `Cancelled` job back to `Pending`, or an `Invoiced` job back to `In Progress`.** Every transition is equally valid as far as the software is concerned.

### 2.3 What Happens Automatically the Moment a Status Becomes "Completed"

- **Rule:** `onJobComplete(j)` fires automatically, exactly once, the instant a job's status changes **to** `Completed` **from something else** (checked as `status===STATUS.COMPLETED && old!==STATUS.COMPLETED` — so re-saving an already-Completed job does not re-trigger this).
- This is the single most important automation rule in the whole system — see Sections 4 (certificates) and 5.3 (invoices) for exactly what it does.
- **This rule fires identically no matter which app changed the status** — a status change made from the Engineer app (a field engineer tapping "Completed" on their phone) triggers the exact same automatic certificate/invoice creation as a status change made from the Office app, because the trigger lives inside the Office app's own code, reacting to the database row, not to who changed it.

### 2.4 "Confirmed" Is a Separate Flag From Status

- **Rule:** a job also carries an independent `confirmed` true/false flag (toggled via `quickConfirm`), unrelated to its `status`. This appears to represent "has the client/tenant confirmed the appointment," tracked alongside, not instead of, the main status.

### 2.5 Job Numbering Rule

- **Rule:** `nextJobNum(prefix)` generates the next number the same way invoice numbers are generated (Section 5.2) — by scanning every existing job number with that prefix and taking the highest number found, plus one. Not a database sequence.
- **Prefix rule:** the default prefix is `JOB-`; standalone proformas get a placeholder job created with a `PR-` prefix instead, to keep them visually distinct in reporting.

### 2.6 Manual Sort Order Rule

- **Rule:** jobs within the same day can be manually drag-reordered; this position is saved as a numeric `_sortOrder` field and is one of the actual sort keys `renderJobs()` uses (after date, before time slot) — so a manual reorder persists and outranks the natural time-based order for jobs on the same day.

### 2.7 Realtime Conflict Rule

- **Rule:** if a job currently open in someone's edit modal (`editJid === id`) receives a live update from someone else via Realtime, the app does **not** silently overwrite what's on their screen — it shows a warning toast and flashes the modal border, but leaves their in-progress edits alone, requiring them to manually decide what to do next.

---

## 3. How Employees (Engineers) Receive Jobs

### 3.1 Assignment Is a Name Match, Not an ID Link

- **Rule:** a job is "assigned" to an engineer purely by the job's `engineer` text field matching that engineer's `name`. There is no ID-based foreign key. The Engineer app's own job-fetching queries use a case-insensitive match (`ilike`) specifically to reduce (not eliminate) the risk of a job being invisible to an engineer because of a capitalisation difference.

### 3.2 What the Engineer App Actually Fetches — Exact Windows

Three separate, parallel queries define what an engineer sees, every time their app loads or refreshes:

| Tab | Rule |
|---|---|
| **Today** | `date = today AND engineer ILIKE <their name>` — every status included, not just Pending. |
| **Upcoming** | `date > today AND date <= today+30 days AND engineer ILIKE <their name>` — a fixed 30-day forward window. |
| **Done** | `engineer ILIKE <their name> AND status IN (Completed, Cannot Access, Cancelled)`, most-recently-modified first, **capped at the last 60 jobs**. |

### 3.3 Refresh Cadence Rule

- **Rule:** while the Engineer app is open and the browser tab is visible (`document.visibilityState !== 'hidden'`), it automatically re-runs the job list and alert checks **every 30 seconds**. Broadcast alerts are additionally checked on their own, faster, **15-second** cycle. A connectivity check to "is the office reachable" runs every **120 seconds**. A manual pull-to-refresh gesture can trigger an immediate refresh at any time, and going from offline back to online also triggers an immediate refresh.

### 3.4 New-Job Notification Rule

- **Rule:** after browser notification permission has been granted, every 30-second job refresh compares the current set of "Today" job IDs against the set from the previous check; any ID that's new triggers a native OS notification. The very first check after logging in only **establishes** the baseline set — it deliberately does not fire notifications for jobs that were already there when the engineer opened the app.

---

## 4. Certificate Rules

### 4.1 Certificate Types, Validity, and Reminder Windows (Default Configuration)

| Certificate Type | Valid For | Reminder Starts |
|---|---|---|
| Gas Safety | 12 months | 30 days before expiry |
| Electrical (EICR) | 60 months (5 years) | 60 days before expiry |
| Fire Alarm | 12 months | 30 days before expiry |
| Emergency Lighting | 12 months | 30 days before expiry |
| PAT Testing | 12 months | 30 days before expiry |
| EPC | 120 months (10 years) | 90 days before expiry |
| Legionella | 24 months | 60 days before expiry |

These are the shipped defaults (`S.certTypes`); an Admin/Manager can add/edit types and these exact numbers in Settings → Trades.

### 4.2 Automatic Certificate Detection Rule

- **Rule:** every certificate type has a list of keywords (e.g. Gas Safety → `gas, boiler, heating, gas safety, gas check, gas service`). Both while typing a job description (live, in the form) **and** at the moment a job is marked Completed (Section 2.3), the job's description text is lower-cased and checked for any of these keywords appearing anywhere in it. Any match adds that certificate type to the job — **matches are additive/combined with whatever certificate types were manually ticked**, not a replacement for them.

### 4.3 Duplicate Certificate Prevention Rule

- **Rule:** before creating a certificate, `createCertEntry()` checks whether a certificate already exists for the **same job AND the same certificate type**. If one does, it is not duplicated.

### 4.4 Expiry Date Calculation Rule

- **Rule:** a new certificate's expiry date = issue date + that certificate type's `validity` value, in months.

### 4.5 "No Expiry" Rule

- **Rule:** a certificate can be flagged `noExpiry: true` (no expiry field is set) — such certificates are explicitly excluded from every expiry/reminder calculation everywhere in the system (`AND c.noexpiry IS NOT TRUE` appears in the reminder SQL; the client-side equivalent check is identical).

### 4.6 Reminder Threshold Rules

Two independent, separate reminder mechanisms exist, at different levels:

- **On-screen dashboard warning:** `S.certWarnDays` (default **30**) — anything expiring within this many days (and not yet expired) is shown as "expiring soon" on the Dashboard and Certificates screen.
- **Optional, separately-installed, scheduled server-side reminders** (only if the admin has run the SQL and it's actually active — per the Database Handbook, this function was **not found installed** on the live project checked): fires at exactly **60, 30, 14, 7, and 1** days before expiry, and will not repeat the same threshold-for-the-same-certificate reminder within a **2-day** window (`sent_at > now() - interval '2 days'`) even if triggered again.

### 4.7 Certificate Numbering Rule

- **Rule:** if no certificate number is supplied manually, one is auto-generated from: that certificate type's configured prefix (e.g. `GAS-`), plus digits pulled from the job number, plus the last 4 characters of the current timestamp — designed to be unique without needing a database sequence.

---

## 5. Invoice Rules

### 5.1 One Table, Four "Types"

- **Rule:** normal invoices, proformas (quotes), disposable one-off invoices, and credit notes are **not** different tables or even a single clean "type" enum — they're told apart by a combination of a `type` field (`invoice`/`proforma`), a `status` value (`'Credit Note'` is itself a status), and an `isCreditNote` boolean flag, checked in different combinations depending which screen is asking.

### 5.2 Invoice Numbering Rule

- **Rule:** exactly the same "scan everything, take the highest number with this prefix, add one" approach as job numbering (Section 2.5) — **not** a database auto-increment sequence. Regular invoices use `S.invPrefix` (default `INV-`) or `S.agencyInvPrefix` for agency-billed invoices. Proformas use a fixed `PF-` prefix with the number padded to 3 digits (e.g. `PF-001`), read directly from existing `type='proforma'` rows rather than the general settings counter. Credit notes are numbered `INV-CN-<the original invoice's number>`.
- **Consequence of this design:** two invoices could theoretically be created at nearly the same instant, both compute the same "next number," and both save successfully — the guard is "look before you write," not an atomic database-enforced sequence.

### 5.3 Automatic Invoice Creation Rule

- **Trigger:** fires automatically inside `onJobComplete` → `autoInvoice(j)`, roughly **1.4 seconds** after a job becomes Completed (delayed deliberately, to let certificate creation, which happens first, finish writing).
- **Guard conditions (all must be true, or nothing is created):**
  1. The setting `S.autoInvOnComplete` is not explicitly `false`.
  2. No invoice already exists referencing this job (checked by scanning all invoices for a matching `jobId` or `linkedJobId`).
  3. A client can be identified or created — the job must have either a `referrer` or a `landlordName` value; if neither exists, nothing is created at all, silently.
- **If a matching client (by name) doesn't already exist in `persons`,** one is created automatically on the spot, purely from whatever landlord details are on the job, so the auto-invoice always has somewhere to attach to.

### 5.4 Line-Item Construction Rule

The generated invoice's line items depend on what data the job actually has, checked in this exact priority order:

1. **Hours logged AND the assigned engineer has a configured hourly rate:** one "Labour" line = hours × rate. If the job's separate flat `price` field is also set and differs from hours×rate by more than 1 penny, a **second** "Materials / Additional" line is added for that difference.
2. **Hours logged but no hourly rate configured for that engineer:** one "Labour" line showing the hours worked, but priced at **£0** (deliberately, so office staff notice it needs manual pricing), plus a second line for the flat price if one exists.
3. **No hours logged at all:** a single line using the job's flat price, described using the job's description (or "Labour" if no description).

### 5.5 VAT Rule

- **Rule:** `getVatRate()` = the configured `S.vatRate` (default **20%**) if `S.vatEnabled` is not explicitly `false`, otherwise **0%**.
- **Per-line, not blanket:** every individual line item on an invoice carries its own `vat: true/false` flag — the invoice total is the sum of every line's price, plus VAT calculated only on the lines flagged for it, not a single VAT rate applied to the whole invoice indiscriminately.

### 5.6 Invoice Status Flow

The observed statuses are `Draft` → `Awaiting Payment` → `Paid`, with `Cancelled` and `Credit Note` as side-branches. Like job status (Section 2.2), **nothing in the code prevents moving backward or sideways** — for example, editing certain fields on an invoice already marked `Draft` can move it back to `Draft` again automatically if the linked job changes (Section 5.10).

### 5.7 "Fully Paid" Threshold Rule

- **Rule:** an invoice is automatically marked `Paid` once the **sum of every payment recorded against it** is within **1 penny** of the invoice's calculated grand total (`Math.abs(totalPaid - grand) < 0.01`, in effect) — not required to match exactly to the last fraction of a penny, to tolerate rounding.

### 5.8 Overdue Rule

- **Rule:** an invoice counts as "overdue" the moment `status === 'Awaiting Payment'` **and** it has a `dueDate` **and** that due date is before today. The Dashboard/notification-preview additionally has a separate, configurable threshold, `S.invReminderDays` (default **7**), for "how many days overdue before this appears as an urgent reminder" — being 1 day overdue and being 7+ days overdue are treated differently for reminder purposes, even though both already count as "overdue" for status/colour purposes.

### 5.9 Missing-Invoice Rule

- **Rule:** a completed job is flagged as needing office attention if its status is `Completed`, it has no invoice linked to it at all, **and** it's been at least `S.missingInvDays` (default **3**) days since the job's date. This is what powers the Dashboard's "smart banner" prompting bulk invoice creation (Workflow A2.17).

### 5.10 Invoice-Edits-Sync-Back-to-Job Rules

When editing an invoice that's linked to a job, different fields behave differently:

- **Text fields** (description, address, date, client/agent/agency name): synced back to the job **silently**, no confirmation needed.
- **Price, single line item:** synced back to the job **silently**, with a toast confirmation.
- **Price, multiple line items** (so which number is "the" job price is ambiguous): **not** auto-synced — a non-blocking on-screen notice is shown instead, leaving a human to decide.
- **If the job itself changes** after the invoice was created (e.g. price or description edited on the job side) in a way that no longer matches the invoice, and the invoice hasn't already been paid, this can automatically **move the invoice's status back to `Draft`** (`if(needsDraft && linked.status!=='Draft' && linked.status!=='Paid') invPatch.status='Draft'`) — i.e., a job change can un-finalise an invoice, but only if it wasn't already Paid.

### 5.11 Credit Note Rule

- **Rule:** a credit note is created directly against a specific existing invoice, pre-filled with that invoice's own line items (so the default is "reverse everything," and the user can adjust from there), numbered `INV-CN-<original number>`, and flagged `status:'Credit Note'` + `isCreditNote:true`.

### 5.12 Proforma-to-Invoice Conversion Rule

- **Rule:** converting requires generating a brand-new real invoice number at the moment of conversion (a proforma's `PF-###` number is never reused as the real invoice number) — the row's `type` changes from `proforma` to `invoice`, and a `proformaConverted`/`convertedAt` marker is kept for traceability.

---

## 6. Directory / Duplicate / Merge Rules

### 6.1 Duplicate Phone Number Detection Rule

- **Rule:** triggers **600 milliseconds** after the user stops typing a phone number into a landlord/agent/agency field on the job form (a debounce, to avoid checking on every keystroke). Only runs at all if the cleaned number (spaces removed) is **at least 7 digits long**. If a match is found in the corresponding directory table under a name that is **not** (case-insensitively) identical to what's currently typed, a warning popup appears. If the name does match, nothing happens — assumed to be the same, already-known person.

### 6.2 Merge "Default Winner" Rule

- **Rule:** when merging duplicate directory records, the field-by-field merge tool pre-selects whichever candidate's value is **longest** (interpreted as "most complete") as the default for each field — the human can still override any individual field before confirming.

### 6.3 Client Star Rating Formula (exact)

Every client's star rating starts at **5** and is adjusted as follows, using that client's own invoice history:

1. If they have **more than 3** invoices overdue by more than 60 days ("very overdue"): **−3**.
   - Else if they have **any** invoices overdue by more than 60 days: **−2**.
   - Else if they have **more than 3** invoices overdue at all (any amount): **−2**.
   - Else if they have **any** invoices overdue at all: **−1**.
   *(Only one of these four branches applies — they are checked in this exact priority order, not added together.)*
2. Separately, compare their total currently-unpaid amount to their average invoice value: if unpaid amount is **more than 5×** their average invoice: **−2**. Else if **more than 3×**: **−1**.
3. If they have **more paid invoices than unpaid ones**, **and more than 3** paid invoices in total: **+1**.
4. The result is clamped to a **minimum of 1, maximum of 5** stars.
5. **Risk label:** 1–2 stars = "HIGH RISK," 3 stars = "MEDIUM RISK," 4–5 stars = "LOW RISK."
- **Guard:** a client with **zero** invoices on record gets no rating at all (`null`), rather than a default score.

### 6.4 Fuzzy Address Matching Rule

- **Rule:** a property "owns" a job or certificate if the **first ~20 characters** of their addresses match (case-insensitive substring check) — not an exact match, and not a database link. This is deliberately loose to tolerate minor formatting differences, at the cost of being able to produce false matches between genuinely different addresses that happen to start the same way (e.g. "Flat 1, 12 High Street" vs. "Flat 2, 12 High Street" would both match on a 20-character prefix check, depending on exact string lengths).

---

## 7. How the Office App Synchronizes

### 7.1 Realtime Scope Rule

- **Rule:** only the `jobs` table is subscribed to live push updates, and only from within the Office app, and only after a successful login. No other table, and neither of the other two apps, receives push updates of any kind.

### 7.2 Fallback and Reconnection Rule

- **Rule:** if the live connection is ever not in the `SUBSCRIBED` state (closed, errored, or never connected), the app automatically starts polling instead, and separately schedules a reconnection attempt **every 10 seconds** until the live connection is restored — at which point polling stops again.

### 7.3 Smart Row-Update Rule

- **Rule:** not every live change causes a full page re-render. `getChangedFields()` compares the old and new version of a job across a fixed list of visually-relevant fields (`status, priority, date, engineer, timeSlot, address, price, description, jobNum`). If **3 or fewer** fields changed, only that one row is patched in place (with a brief highlight animation). If **more than 3** changed (or it's a brand-new/deleted row), the whole visible list re-renders, preserving the user's scroll position.

### 7.4 Cache Invalidation Rule

- **Rule:** the Office app keeps an in-memory cache of jobs (`_getJobs()`) so that searching/filtering/sorting doesn't hit the database on every keystroke. This cache is explicitly invalidated (forced to reload on next use) after any save, delete, quick-status-change, or confirm action — and also whenever the browser tab regains visibility while the live connection is active, as an extra safety net against missed updates.

### 7.5 Tab-Visibility Refresh Rule

- **Rule:** coming back to a background browser tab (`visibilitychange` event, `document.hidden` becomes `false`) while Realtime is connected triggers an immediate cache invalidation and, if the Jobs page happens to be the active screen, a re-render — catching anything that might have been missed while the tab was in the background.

---

## 8. How the Client Portal Updates

### 8.1 Identity Rule

- **Rule:** the portal has no concept of "logging in" or "logging out." Its entire identity for the whole session is fixed the moment the page loads, taken from the `id` and `type` values in its own URL. There is no session, no token refresh, and no way to switch identity without loading a different link.

### 8.2 Load-Once Rule

- **Rule:** every piece of data shown in the portal (jobs, invoices, certificates, attachments, ratings) is fetched **exactly once**, in parallel, immediately after the client's identity is confirmed. **There is no polling and no realtime connection of any kind.** If the office changes something (adds a job, marks an invoice paid) after the client has the page open, the client will not see it until they manually reload the page.

### 8.3 Job Request Reference Number Rule

- **Rule:** when a client submits a new request, the reference number (`CR-####`) is generated by scanning up to the **last 500** existing portal-request entries in `engineer_requests`, extracting the highest `CR-` number seen in their stored text, and adding one — the same "scan and increment" pattern used everywhere else in this system for human-readable numbers (jobs, invoices, certificates). If that scan fails for any reason, it falls back to a reference built from the last 4 digits of the current timestamp instead, so a reference number is always produced even if the primary method fails.

### 8.4 Request Validation Rules

Before a client's request can be submitted: the property address is required and must be **at least 5 characters** long; a service/job type must be selected from the list; if a preferred date is entered, it **cannot be earlier than today**.

### 8.5 Renewal Pre-Fill Rule

- **Rule:** tapping "Request Renewal" on an expiring/expired certificate card jumps straight to the request form with the address and (implicitly) the certificate's service type already filled in — reducing the request down to "review and submit" rather than "start from a blank form," specifically for the single most common reason a client would use the request feature.

---

## 9. Notification & Broadcast Rules

### 9.1 Broadcast Alert Expiry Rule

- **Rule:** every broadcast alert automatically expires exactly **1 hour** after it was sent (`expires = created + 3600 seconds`). The Engineer app's alert-checking query explicitly filters to `expires >= now` — an alert older than an hour will never be shown to anyone who hadn't already seen it.

### 9.2 Broadcast Targeting Rule

- **Rule:** a broadcast is sent either to `target: 'all'` (every engineer) or to one specific engineer's exact name string. On the receiving end, an alert is skipped if its target is set and doesn't case-sensitively equal the current engineer's name (and isn't `'all'`).

### 9.3 "Don't Show the Same Alert Twice" Rule

- **Rule:** every alert ID the engineer has already seen is remembered in their browser's local storage (capped at the most recent **50** IDs, oldest dropped first), so an alert already dismissed once will not reappear on a later poll, even though it's technically still "active" and unexpired in the database.

### 9.4 In-App Notification Bell Rules (Office App)

- **Rule:** notifications shown via the bell icon are **not stored anywhere** — they exist only in the browser's memory for the current session, capped at the most recent **50** entries, and are lost on page refresh. They're generated as a side-effect of other events (a live job change arriving via Realtime, a poll discovering a new request), not fetched from any dedicated "notifications" table (none exists).

### 9.5 New-Job Push Notification Rule (Engineer App)

Already covered in Section 3.4 — restated here for completeness as a notification rule: only fires for genuinely new job IDs appearing in the day's list compared to the previous check, and never fires on the very first check after login (baseline-only).

---

## 10. Financial Calculation Rules

### 10.1 P&L Wage Cost Estimate Rule

- **Rule:** the P&L Dashboard's "Engineer Wages" cost figure is **not** based on actual hours logged per job — it's a flat `dayRate` (if configured) or `hourlyRate` charged per completed job that has an assigned engineer, for every job in the selected period. **This is explicitly an estimate**, and will over- or under-state real labour cost for any job that took meaningfully more or less time than the assumed flat rate implies.

### 10.2 Payslip Formula

- **Rule:** gross pay = (day rate × number of jobs completed that month) **or** (hourly rate × a fixed assumption of 4 hours per job × number of jobs completed that month) — whichever rate the engineer has configured. Net pay = gross pay minus any matching expense-category deductions recorded against that engineer for that month.
- **The "4 hours per job" assumption is hardcoded**, used only when an hourly (not day) rate is configured and no better data is available — it does not look at each job's actually-logged `hours` value for this specific calculation.

### 10.3 VAT Quarter Grouping Rule

- **Rule:** invoices are grouped into UK-style quarters (`Q1`–`Q4` of each year, computed as `Math.floor(month/3)`) purely from each invoice's date. **Only the "output" (VAT collected/charged) side is actually calculated** — the "input VAT" (VAT the business itself paid on its own purchases/expenses) figure is referenced in the display but was not found to be populated anywhere from the `expenses` data, so the "Net VAT Due" this screen implies is really just total VAT charged, not a true return-ready reconciliation.

### 10.4 Cash Flow Projection Rule

- **Rule:** the 30-day cash-flow forecast's "Incoming" figure = every currently-outstanding invoice (regardless of how old, not limited to the selected period) **plus** every completed-but-not-yet-invoiced job's price. "Outgoing" = the trailing 30-day average of past expenses **plus** the wage cost (Section 10.1's formula) of every job already scheduled in the next 30 days. The resulting balance is labelled Healthy / Tight / At Risk based on fixed thresholds in the rendering code.

---

## 11. Session & Security Rules

### 11.1 Office Session Rule

- **Rule:** session persistence for the Office app is handled entirely by the Supabase Auth library itself (its own token, refreshed automatically, stored in the browser by the library). A separate, custom 12-hour session mechanism exists in the code (`_issueOfficeSession`/`_checkOfficeSession`) but — confirmed by searching the whole file — is **never actually called** by anything else. It is inert.

### 11.2 Engineer Session Rule

- **Rule:** the Engineer app additionally keeps its own session marker in `localStorage`, explicitly valid for **30 days** from login (`Date.now() + 30*24*60*60*1000`) — a deliberately long window, on the reasoning that engineers shouldn't have to log in daily on a work phone.

### 11.3 pinLock-Off Login Bypass Rule (cross-reference to 1.1)

- **Rule:** on startup, if `S.pinLock` is on and no user is currently logged in, the login overlay is shown after a short delay. **If `S.pinLock` is off, this check is skipped entirely, and the app instead builds a working logged-in identity directly from the first user found in the cached settings — with no password check of any kind.**

### 11.4 Logout Clears Location Rule

- **Rule:** logging out of the Engineer app doesn't just end the session — it explicitly stops the GPS watcher and sends one final update setting that engineer's `last_lat`/`last_lng`/`last_seen` to `null`, so they immediately stop appearing as "live" on the Office app's map, rather than appearing frozen at their last position forever.

---

## 12. Photo & Upload Rules

### 12.1 Compression Rule

- **Rule:** unless the "HD" upload-quality toggle is switched on, every photo is resized (if larger) to a maximum of **1200 pixels** in both width and height, and re-encoded as a JPEG at **quality 0.8 (80%)**, before upload. A photo already smaller than 1200px in both dimensions is left untouched (not upscaled).

### 12.2 Watermark Rule

- **Rule:** every uploaded photo has a compact stamp drawn onto its lower-left corner containing the job address, the engineer's name, and a timestamp — using the photo's own EXIF capture time if it was readable, or the current time otherwise. This happens **regardless of the HD toggle** — HD only affects compression, not whether the stamp is applied.

### 12.3 Before/After Slot Rule

- **Rule:** before/after photo pairs are tracked as a numbered slot (`photo_slot`) plus a role (`before`/`after`) on the `attachments` row — a slot can have just a "before," just an "after," or both; there's no rule forcing a pair to be completed together.

### 12.4 Storage Path Rule

- **Rule:** every uploaded file, whether a standard photo, a before/after photo, or a document, is saved to the identical path pattern: `jobs/<job id>/<upload timestamp>-<random 4-character code>.<file extension>` — the only difference between a "standard" and a "before/after" upload is the extra metadata saved on the `attachments` row, not the file's location.

---

## 13. GPS / Live Map Rules

### 13.1 Tracking Cadence Rule

- **Rule:** the Engineer app uses the browser's continuous "watch position" mode (not a repeating timer) — it reports a new position update whenever the device's location changes meaningfully, using a maximum cached-position age of **30 seconds** and a per-attempt timeout of **20 seconds**, with high-accuracy mode requested.

### 13.2 "Currently Live" Definition Rule

- **Rule:** the Office app's Live Maps screen only counts an engineer as currently trackable if they have a stored `last_lat`/`last_lng` **and** their `last_seen` timestamp is within the last **1 hour** (3,600,000 milliseconds) — anyone last seen longer ago than that is treated as offline/not shown, even if their last known coordinates are still sitting in the database.

### 13.3 No History Rule

- **Rule:** only the single most recent position per engineer is ever stored — each GPS update **overwrites** the previous one. There is no location history table anywhere in the system; it is impossible to see where an engineer was an hour ago, only where they are (or were, as of their last update) right now.

---

## 14. Consolidated Validation Rules

Every explicit "this must be true before saving/submitting" check found anywhere in the three apps:

| Where | Rule |
|---|---|
| Office login | Email and password fields must both be non-empty before attempting sign-in. |
| Office → Team → Add | A name must be typed before a Supabase Auth account can be added as a DeepFlow user. |
| Office → Job save | No hard-required fields enforced by the code — jobs can be saved with most fields blank. |
| Office → Directory duplicate check | Only triggers once a phone number is at least 7 digits long. |
| Office → Backup import | The uploaded file must parse as valid JSON, and the user must explicitly confirm before any existing data is overwritten. |
| Office → Bulk actions | At least one job must be selected; a target value (engineer/date, as relevant) must be chosen before the action runs. |
| Engineer login | Email and password required; additionally, after authentication succeeds, the matched profile must have `role==='engineer'` and `active===true`, or access is refused with an explanatory message. |
| Engineer → Add Job | Address is required at minimum. |
| Engineer → Photo upload | A job must currently be open (`currentJob` set); for before/after uploads, a specific slot/role must have been tapped first. |
| Client Portal → Submit Request | Property address required and must be at least 5 characters; a service/job type must be selected; a preferred date, if given, cannot be in the past. |
| Client Portal access | No validation at all beyond "does a record with this exact ID exist" — there is no format-checking, ownership-proving, or expiry on the link itself. |

---

## 15. Cross-Cutting Data Integrity Rules

- **Duplicate-invoice guard:** before creating an automatic invoice, the system checks whether any existing invoice already references the job (by `jobId` or `linkedJobId`) — but this check-then-write is not atomic (Section 5.2's numbering caveat applies here too), so a very unlucky, near-simultaneous double-trigger is theoretically possible, though unlikely in normal single-user-per-job usage.
- **Job ID format is not consistent:** Office-created jobs get a random UUID; Engineer-app-created jobs get a differently-shaped ID string (confirmed by inspecting real file paths in Storage) — nothing in the system enforces or relies on a single ID format, but any future code that assumes "job IDs are always valid UUIDs" would be wrong.
- **Settings are all-or-nothing:** because company settings, invoice preferences, WhatsApp templates, certificate types, the properties list, and per-engineer permission overrides are all stored inside one single JSON blob (Section 3.18 of the Database Handbook), saving a change to *any one* of these always re-saves the *entire* blob — there is no way to update one setting without touching all of them in the same write.

---

*Every rule in this document was extracted directly from the application source code (all three apps) and cross-checked against the live database behaviour documented in [05_Database.md](05_Database.md). Where a number is stated as a "default," it means the value ships with the app but can be changed by an Admin in Settings; where no such override exists, the number is fixed in the code itself. See [00_Project_Overview.md](00_Project_Overview.md) for the full documentation index.*
