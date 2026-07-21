# DeepFlow — Complete Feature Workflow Documentation

This document walks through **every feature** in all three DeepFlow applications, following the same 12-step pipeline for each one. Nothing is skipped — where a stage genuinely does not apply to a feature (for example, most features never touch file Storage), that is stated explicitly rather than left out, so you can trust that an empty-looking stage was checked, not ignored.

## The 12-Stage Pipeline — What Each Stage Means

| # | Stage | What it means in this system |
|---|---|---|
| 1 | **User Action** | The exact thing a person clicks, types, or does that starts the workflow. |
| 2 | **Frontend Process** | Which JavaScript function(s) run, and what they do to the on-screen data before anything is sent anywhere. |
| 3 | **Validation** | What checks happen before the action is allowed to proceed (required fields, format checks, duplicate checks, permission checks). DeepFlow has **no server-side validation** — every check listed here happens in the user's own browser and could theoretically be bypassed by someone calling the API directly. |
| 4 | **Database Queries** | Exactly which table(s) are read from or written to, and how (GET/POST/PATCH/DELETE). |
| 5 | **Supabase** | Which Supabase *service* is involved — the Database API (PostgREST), Auth, or an RPC (custom SQL function) — and any Supabase-specific behaviour (e.g. JWT headers, RLS). |
| 6 | **Storage** | Whether the Supabase Storage file bucket (`deepflow`) is touched. Most features never touch it — only photo-related features in the Engineer app do. |
| 7 | **Realtime** | Whether Supabase's live WebSocket push is involved. As covered in the architecture document, this only exists for the `jobs` table inside the Office app — every other feature is stated as "Not used." |
| 8 | **Other Apps** | Whether this action becomes visible to one of the *other* two applications, and how (always indirectly, through the shared database, never directly). |
| 9 | **Notifications** | Any toast pop-up, browser notification, in-app notification-bell entry, or vibration this action produces. |
| 10 | **UI Update** | What visibly changes on screen once the action finishes. |
| 11 | **Logs** | Whether this action is recorded anywhere permanent — the `activity` table (general feed), the `audit_log` table (Admin-only, currently only 2 event types), or neither. |
| 12 | **Completion** | The final state / success signal the user sees, marking the workflow as done. |

---

# PART A — Office App (`index.html` / `office.html`)

## A1. Authentication & Session

#### A1.1 — Log In
- **User Action:** Staff member types their email and password on the login screen and clicks "Sign In →" (or presses Enter).
- **Frontend Process:** `doLogin()` reads the two input fields, trims/lowercases the email, disables the button and shows "Signing in…".
- **Validation:** Both fields must be non-empty (checked in JavaScript before anything is sent); if either is blank, an inline error message is shown and nothing is sent to Supabase.
- **Database Queries:** After Supabase Auth confirms the password, a `GET` to the `users` table filtered by `auth_id`, falling back to a second `GET` filtered by `email` if the first finds nothing.
- **Supabase:** Calls **Supabase Auth**'s `signInWithPassword()`. If the profile lookup found a user by email but it had no `auth_id` saved yet, a `PATCH` silently backfills it.
- **Storage:** Not used.
- **Realtime:** Not used yet at this point — it is switched on *after* login succeeds (see A11.1).
- **Other Apps:** Not used — this is a private per-app login.
- **Notifications:** A success toast "👋 Welcome, `<name>`!" (or a special "Emergency admin access used" warning toast if the hardcoded emergency-admin fallback had to kick in).
- **UI Update:** The login overlay is hidden, the main app (sidebar, dashboard) appears, and the sidebar/menu items are shown or hidden according to the user's role.
- **Logs:** The user's `last_seen` timestamp is updated on their `users` row (a `PATCH`, fire-and-forget). No entry is written to `activity` or `audit_log` for a plain login.
- **Completion:** The Dashboard page is shown as the logged-in home screen; company settings are re-loaded from the database in the background.

#### A1.2 — Log Out
- **User Action:** Clicks "Log Out" from the user menu.
- **Frontend Process:** `doLogout()` clears the in-memory `_appUser` variable and the login form fields.
- **Validation:** None needed — always allowed.
- **Database Queries:** None.
- **Supabase:** Calls **Supabase Auth**'s `signOut()`, which invalidates the session token server-side.
- **Storage:** Not used.
- **Realtime:** The open Realtime connection is not explicitly closed in this step, but it will stop being useful once no authenticated session remains.
- **Other Apps:** Not used.
- **Notifications:** None.
- **UI Update:** The login overlay reappears; the background animated canvas restarts.
- **Logs:** None.
- **Completion:** User is back at the login screen.

#### A1.3 — Forgot Password
- **User Action:** Clicks "Forgot password?" after typing their email.
- **Frontend Process:** `doResetPassword()` reads the email field.
- **Validation:** Email field must not be empty, or an inline message asks for it first.
- **Database Queries:** None.
- **Supabase:** Calls **Supabase Auth**'s `resetPasswordForEmail()`, which sends a password-reset email from Supabase's own mail service.
- **Storage:** Not used.
- **Realtime:** Not used.
- **Other Apps:** Not used.
- **Notifications:** An inline green success message, "✅ Password reset email sent."
- **UI Update:** Button text returns to normal once the request finishes.
- **Logs:** None.
- **Completion:** User checks their email and follows Supabase's own reset link (outside the app).

#### A1.4 — "PIN Lock" Off → Automatic Login (edge case, not a normal feature)
- **User Action:** Simply opening the app while an admin has previously turned the `S.pinLock` setting off.
- **Frontend Process:** On page load, since `S.pinLock` is falsy, the login-check step is skipped entirely and the app builds a logged-in `_appUser` object directly from the first user found in the cached settings — no password step runs at all.
- **Validation:** **None.** This is the one place in the whole system where a real, working login identity is granted with zero checks.
- **Database Queries:** None beyond the normal settings load that already happened.
- **Supabase:** Not called for authentication in this path.
- **Storage / Realtime / Other Apps:** Not used.
- **Notifications:** None — this happens silently.
- **UI Update:** The app opens straight to the Dashboard as if someone had logged in.
- **Logs:** None — this is the reason it's flagged as a risk in the architecture document; there is no log entry proving who actually opened the app this way.
- **Completion:** User is inside the app under whichever identity happened to be first in the settings list.

---

## A2. Jobs

#### A2.1 — Create a New Job
- **User Action:** Clicks "+ New Job", fills in address, trade, engineer, date/time, description, access instructions, price, etc., and clicks Save.
- **Frontend Process:** `openJobModal()` opens a blank 3-column form; typing in the address field triggers `fuzzyAddr()` (property autocomplete) and typing a landlord/agent/agency phone triggers `checkDuplicatePhone()` (see A5.4). `saveJob()` collects every field into one job object.
- **Validation:** No hard "required field" blocking observed for most fields (the app is designed to let office staff save incomplete jobs and fill details later); the main active checks are the duplicate-phone popup and fuzzy-address suggestions, which *warn* rather than block.
- **Database Queries:** `POST` (via `dPut`) to the `jobs` table. If a landlord/agency/agent name was typed that doesn't already exist as a directory record, a background fire-and-forget `POST` also creates that `persons`/`agencies`/`agents` row.
- **Supabase:** Straight `PostgREST` REST call through the shared `_sb()` fetch helper, authenticated with the logged-in user's JWT.
- **Storage:** Not used (no file is attached at creation time — photos come later, from the Engineer app).
- **Realtime:** The `INSERT` on `jobs` is picked up automatically by Supabase Realtime and pushed back to this same Office app's open connection (and to any other office computer that's logged in) — the new job row is inserted into the on-screen list live, even without a manual refresh.
- **Other Apps:** The Engineer app will see this job the next time it polls the `jobs` table (up to 30 seconds later) if it's assigned to that engineer for today/upcoming.
- **Notifications:** A success toast confirming the job was saved.
- **UI Update:** The job modal closes; the jobs table re-renders (or the new row is inserted in place via the Realtime handler); badge counters (e.g. unassigned job count) update.
- **Logs:** An entry is written to the `activity` table via `logActivity()` (e.g. "Job created — `<address>`").
- **Completion:** The new job is visible in the day's job list with status "Pending."

#### A2.2 — Edit a Job
- **User Action:** Clicks an existing job row, changes any field, clicks Save.
- **Frontend Process:** Same `saveJob()` function as creation, but with an existing job ID — it now runs as an update rather than an insert.
- **Validation:** Same as creation. If the job has a linked invoice, changing certain fields (price, description, address) also triggers `_syncJobToInvoice()` to keep the invoice's copy of those fields aligned.
- **Database Queries:** `POST` with `resolution=merge-duplicates` (an "upsert" — insert or update in one call) to `jobs`.
- **Supabase:** Same REST call pattern as creation.
- **Storage:** Not used directly (photo management is a separate action inside the same modal — see A2.14).
- **Realtime:** The `UPDATE` is pushed live to any other open Office session. If another staff member currently has *this same job* open in their own edit modal, they see an orange warning border and a toast telling them someone else just changed it, so they don't blindly overwrite the change.
- **Other Apps:** Engineer app picks up the change (new date, new instructions, etc.) on its next 30-second poll.
- **Notifications:** Success toast.
- **UI Update:** The specific row updates in place if only a few fields changed (an optimisation that avoids re-drawing the whole table), or the whole list re-renders for bigger changes (e.g. the date moved).
- **Logs:** Activity feed entry.
- **Completion:** Modal closes, updated job visible in the list.

#### A2.3 — Delete a Job
- **User Action:** Clicks the delete/trash icon on a job, confirms in the popup.
- **Frontend Process:** `deleteCurrentJob()` (or the row-level delete action) shows a confirmation dialog before doing anything.
- **Validation:** Requires explicit confirmation click; requires the logged-in user's role to have delete permission (`canDelete`) — the delete button itself is hidden from the UI for roles without this permission, so this is a UI-level check, not a database-level one.
- **Database Queries:** `DELETE` on the `jobs` table for that job's ID.
- **Supabase:** Standard REST `DELETE` call.
- **Storage:** Not used (attached photos are **not** automatically removed from Storage when a job is deleted — they become orphaned files unless separately cleaned up).
- **Realtime:** The `DELETE` is pushed live; any other open Office session animates the row sliding out and removes it from their screen automatically.
- **Other Apps:** The job disappears from the Engineer app's job list on its next poll.
- **Notifications:** A confirmation toast.
- **UI Update:** Row is removed from the table.
- **Logs:** This is one of the only two event types written to the strict **`audit_log`** table (`type: 'job_delete'`), recording who deleted it, when, and which job — because deleting a job is considered a sensitive, auditable action.
- **Completion:** Job is permanently gone.

#### A2.4 — Change Job Status (quick status dropdown / one-click buttons)
- **User Action:** Uses the inline status dropdown/buttons on a job row (e.g. Pending → In Progress → Completed → Cannot Access → Cancelled) without opening the full job modal.
- **Frontend Process:** `quickStatus(id, status)` runs a small, targeted update rather than saving the whole job form — this deliberately avoids accidentally overwriting other fields someone else may be editing at the same time.
- **Validation:** None beyond the status being one of the fixed allowed values (a dropdown, not free text).
- **Database Queries:** `PATCH` on the single `jobs` row, updating only `status` and `modified`.
- **Supabase:** Standard REST `PATCH`.
- **Storage:** Not used.
- **Realtime:** Pushed live to other open Office sessions.
- **Other Apps:** Visible to Engineer app on next poll; if this job later becomes "Completed" this way, it also feeds into A2.5/A2.6 below.
- **Notifications:** A status-specific toast/icon appears in the notification feed for other logged-in staff (e.g. "✅ Job updated — Completed").
- **UI Update:** The row's colour stripe and dropdown value update immediately.
- **Logs:** General activity entry.
- **Completion:** New status is saved and visible.

#### A2.5 — Job Completion → Automatic Certificate Creation
- **User Action:** Not a direct action by itself — this workflow is *triggered automatically* whenever a job's status becomes "Completed" (from A2.4, from the job modal, or from the Engineer app).
- **Frontend Process:** `onJobComplete(j)` runs. It checks the job's description text against every certificate type's list of keywords (e.g. the word "boiler" matches "Gas Safety"), combining any keyword matches with certificate types the office already manually ticked on the job.
- **Validation:** No confirmation prompt in the current default flow — certificates are created silently and automatically the moment the keyword match happens.
- **Database Queries:** For each matched certificate type, a duplicate check (`GET` on `certs` filtered by job + type) runs first, then a `POST` creates the new certificate row (expiry date calculated from that certificate type's validity period, e.g. 12 months for Gas Safety).
- **Supabase:** Standard REST calls.
- **Storage / Realtime:** Not used (certificates are not part of the Realtime-enabled `jobs` table).
- **Other Apps:** The new certificate becomes visible to the Client Portal the next time that client's portal page is loaded, and to the Office Certificates screen immediately.
- **Notifications:** None specific to certificate creation (a related invoice toast follows shortly after, see A2.6).
- **UI Update:** New certificate(s) appear in the Certificates screen and on the job's info panel.
- **Logs:** Activity feed entry per certificate created.
- **Completion:** Certificate(s) exist with a calculated expiry date, ready to be tracked for renewal reminders.

#### A2.6 — Job Completion → Automatic Draft Invoice Creation
- **User Action:** Same trigger as A2.5 — happens automatically on job completion (roughly 1.4 seconds afterwards, to let the certificate step finish first).
- **Frontend Process:** `autoInvoice(j)` runs. It checks a setting (auto-invoicing can be turned off) and checks no invoice already exists for this job. It finds (or creates) a matching client record, then builds invoice line items — a "Labour" line from logged hours × the assigned engineer's hourly rate if both are known, otherwise a single line using the job's flat price.
- **Validation:** Logical guards only (skip if disabled in settings, skip if an invoice already exists) — no user confirmation step in the automatic path.
- **Database Queries:** A `GET` on `persons` to find/verify the client (with a `POST` to create one if missing), a call to generate the next sequential invoice number (a `GET` scanning all existing invoice numbers), then a `POST` to create the invoice, followed by a `PATCH` on the job to mark it `Invoiced` and link the two records together.
- **Supabase:** Standard REST calls, several in sequence.
- **Storage / Realtime:** Not used directly for the invoice (invoices are not on the Realtime-enabled table), but the job's status `PATCH` to "Invoiced" *is* pushed live since it's a change to `jobs`.
- **Other Apps:** Visible in the Client Portal's Invoices tab as soon as it's created (marked "Draft" — clients only see invoices once office actually sends them, though the Portal code does display Draft status honestly rather than hiding it).
- **Notifications:** A toast: "📄 Draft invoice `<number>` created — review in Invoices."
- **UI Update:** Job row now shows "Invoiced" status; a new draft invoice appears in the Invoices screen.
- **Logs:** Activity feed entry describing the auto-created invoice and its value.
- **Completion:** A Draft invoice exists, waiting for office review before being sent to the client (see A3.1/A3.8).

#### A2.7 — Bulk: Assign an Engineer to Multiple Jobs
- **User Action:** Selects several jobs with the checkboxes, opens the bulk action bar, picks "Assign Engineer," chooses a name.
- **Frontend Process:** `bulkAssignEngineer()` loops over every selected job ID.
- **Validation:** Requires at least one job selected; requires an engineer to be chosen from the list of configured engineers (no free text).
- **Database Queries:** One `PATCH` per selected job, setting the `engineer` field.
- **Supabase:** Multiple sequential REST `PATCH` calls (not a single batch call — each job is updated individually).
- **Storage:** Not used.
- **Realtime:** Each individual `PATCH` is pushed live as it happens, so the screen may visibly update job-by-job rather than all at once.
- **Other Apps:** All affected jobs appear for their newly assigned engineer on the next poll.
- **Notifications:** A single summary toast once the loop finishes (e.g. "5 jobs assigned to `<engineer>`").
- **UI Update:** Selection is cleared; job list re-renders.
- **Logs:** Activity entries, typically one per job.
- **Completion:** All selected jobs now show the new engineer.

#### A2.8 — Bulk: Reschedule Multiple Jobs
- **User Action:** Selects jobs, picks "Reschedule," chooses a new date.
- **Frontend Process:** `bulkReschedule()` loops the selection, same pattern as A2.7 but updating `date` instead of `engineer`.
- **Validation:** Requires a date to be chosen.
- **Database Queries / Supabase:** One `PATCH` per job.
- **Storage:** Not used.
- **Realtime:** Live-pushed per job.
- **Other Apps:** Engineer sees the date change on next poll.
- **Notifications:** Summary toast.
- **UI Update:** Jobs move to the new date in the calendar/list view.
- **Logs:** Activity entries.
- **Completion:** All selected jobs now scheduled for the new date.

#### A2.9 — Bulk: Copy Jobs to a Date
- **User Action:** Selects jobs, picks "Copy to Date," chooses a target date.
- **Frontend Process:** `bulkCopyToDate()` builds brand-new job objects (fresh IDs, fresh job numbers) using the selected jobs as templates, rather than modifying the originals.
- **Validation:** Requires a target date.
- **Database Queries:** One `POST` per copied job (originals are untouched).
- **Supabase:** Sequential REST `POST` calls.
- **Storage:** Not used (attachments/photos are not copied).
- **Realtime:** Each new job insert is pushed live.
- **Other Apps:** New copies appear for the assigned engineer(s) on next poll.
- **Notifications:** Summary toast with count copied.
- **UI Update:** New jobs appear on the target date; originals remain unchanged on their original date.
- **Logs:** Activity entries for each new job.
- **Completion:** Duplicated jobs exist as independent new records.

#### A2.10 — Bulk: Delete Multiple Jobs
- **User Action:** Selects jobs, picks "Delete," confirms.
- **Frontend Process:** `bulkDeleteJobs()` loops the selection after a confirmation prompt.
- **Validation:** Explicit confirmation required; delete permission required (UI-level).
- **Database Queries:** One `DELETE` per selected job.
- **Supabase:** Sequential REST `DELETE` calls.
- **Storage:** Not used (their attached photos become orphaned, same caveat as A2.3).
- **Realtime:** Each deletion animates out live for other open sessions.
- **Other Apps:** Jobs disappear from Engineer's list on next poll.
- **Notifications:** Summary toast.
- **UI Update:** Rows removed.
- **Logs:** One `audit_log` entry (`type:'job_delete'`) **per job deleted** — bulk delete is just this same audited action repeated.
- **Completion:** All selected jobs permanently removed.

#### A2.11 — Quick Inline Edit (Time or Price, without opening the modal)
- **User Action:** Clicks directly on the time or price value in a job row, types a new value, presses Enter/clicks away.
- **Frontend Process:** `quickEditTime()`/`quickEditPrice()` turns that one table cell into an editable input in place.
- **Validation:** Basic type check (price must parse as a number).
- **Database Queries:** A single targeted `PATCH` on just that field.
- **Supabase:** Standard REST `PATCH`.
- **Storage:** Not used.
- **Realtime:** Pushed live.
- **Other Apps:** Engineer sees updated time/price on next poll.
- **Notifications:** None (silent save, or a brief inline confirmation).
- **UI Update:** Cell reverts to display mode showing the new value.
- **Logs:** Activity entry.
- **Completion:** Field updated without leaving the job list screen.

#### A2.12 — Copy a Single Job to the Next Day
- **User Action:** Clicks "copy to next day" action icon on a job.
- **Frontend Process:** `copyJobToNextDay(id)` builds one new job object dated one day later.
- **Validation:** None beyond the job existing.
- **Database Queries:** One `POST` (new job), original untouched.
- **Supabase:** Standard REST `POST`.
- **Storage:** Not used.
- **Realtime:** New insert pushed live.
- **Other Apps:** New copy visible to engineer next poll.
- **Notifications:** Confirmation toast.
- **UI Update:** New job appears the following day.
- **Logs:** Activity entry.
- **Completion:** A near-identical job now exists tomorrow.

#### A2.13 — Post / Delete a Job Comment
- **User Action:** Clicks the comment icon on a job row, types a note, clicks Post (or deletes an existing comment).
- **Frontend Process:** `postComment(jobId)` / `deleteComment(jobId, commentId)`; `_renderCommentPanel()` shows a slide-down panel of existing comments under the row.
- **Validation:** Comment text must not be empty to post.
- **Database Queries:** `POST` (or `DELETE`) on the `job_comments` table.
- **Supabase:** Standard REST call.
- **Storage:** Not used.
- **Realtime:** Not used — `job_comments` is not on the Realtime-enabled table, so other open Office sessions won't see a new comment until they reload/re-open that job.
- **Other Apps:** Not visible to Engineer or Client Portal apps (comments are internal/office-only).
- **Notifications:** None specific.
- **UI Update:** Comment appears instantly in the panel for the person who posted it; the comment-count badge on the row updates.
- **Logs:** The comment itself is effectively the log entry (stored permanently in `job_comments`).
- **Completion:** Comment thread updated.

#### A2.14 — View / Delete Job Attachments (Photos)
- **User Action:** Opens a job and views the photo grid; clicks the ✕ on a photo to remove it.
- **Frontend Process:** `loadJobAttachments(jobId)` fetches and displays thumbnails; `deleteAttachment(attId, storagePath)` handles removal. **Office never uploads new photos** — that only happens in the Engineer app.
- **Validation:** None beyond the photo existing.
- **Database Queries:** `GET` on `attachments` filtered by job ID (for viewing); `DELETE` on `attachments` (for removal).
- **Supabase:** REST calls to the Database API, **plus** a direct `DELETE` call to the Storage API to remove the actual file from the `deepflow` bucket.
- **Storage:** Yes — the underlying image file is deleted from Supabase Storage, not just the database record.
- **Realtime:** Not used.
- **Other Apps:** The photo also disappears from the Engineer app's view of that job and from the Client Portal (if it was linked to a certificate) on their next load.
- **Notifications:** None specific.
- **UI Update:** Photo grid updates immediately.
- **Logs:** None dedicated (not written to `activity` in the code reviewed).
- **Completion:** File permanently removed from both the database and Storage.

#### A2.15 — Kanban Board: Drag a Job Card to a New Status Column
- **User Action:** Drags a job card from one status column (e.g. "Pending") to another (e.g. "Completed") on the Kanban board view.
- **Frontend Process:** Drag-and-drop event handlers detect the drop target column and call the same targeted status-update logic as A2.4.
- **Validation:** None beyond a valid drop target.
- **Database Queries:** `PATCH` on `status`.
- **Supabase:** Standard REST `PATCH`.
- **Storage:** Not used.
- **Realtime:** Pushed live.
- **Other Apps:** Visible to Engineer next poll; if dropped into "Completed," this also triggers A2.5/A2.6 automatically.
- **Notifications:** Toast confirming the move.
- **UI Update:** Card animates into the new column.
- **Logs:** Activity entry.
- **Completion:** Job status changed via drag-and-drop.

#### A2.16 — Search / Filter / Sort Jobs
- **User Action:** Types in the jobs search box, or clicks a date-range chip, engineer filter, status filter, or priority dot, or clicks a column header to sort.
- **Frontend Process:** `renderJobs()` re-runs entirely client-side against the already-loaded, cached list of jobs — this does **not** trigger a new database query for every keystroke.
- **Validation:** None (search is forgiving/fuzzy text matching, not exact).
- **Database Queries:** None on interaction — jobs are cached in memory (`_getJobs()`) and only re-fetched from the database when the cache is invalidated (e.g. after a save, or a Realtime event).
- **Supabase / Storage / Realtime / Other Apps:** Not used for this specific action.
- **Notifications:** None.
- **UI Update:** The visible table instantly re-filters/re-sorts.
- **Logs:** None.
- **Completion:** User sees the filtered/sorted list.

#### A2.17 — "Create Drafts for Completed" (bulk catch-up invoicing)
- **User Action:** Clicks a button (typically on the Dashboard's smart banner) offering to generate invoices for any completed-but-not-yet-invoiced jobs.
- **Frontend Process:** `createDraftsForCompleted()` finds every job where `status==='Completed'` and no invoice is linked, and runs `autoInvoice()` (A2.6) on each one.
- **Validation:** None beyond the completed/not-invoiced condition.
- **Database Queries / Supabase:** Same as A2.6, repeated for each qualifying job.
- **Storage:** Not used.
- **Realtime:** Each job's `PATCH` to "Invoiced" is pushed live.
- **Other Apps:** New draft invoices become visible to the Client Portal once sent.
- **Notifications:** Summary toast with count of invoices created.
- **UI Update:** The smart banner disappears (or its count drops to zero); new drafts appear in Invoices.
- **Logs:** Activity entries per invoice.
- **Completion:** No completed jobs are left without at least a draft invoice.

---

## A3. Invoices

#### A3.1 — Create Invoice From a Job (manual)
- **User Action:** Opens a completed job, clicks "Create Invoice," reviews/edits the pre-filled invoice, clicks Save.
- **Frontend Process:** `createInvFromJob(jobId)` pre-fills the invoice modal using the same labour/materials line-item logic as the automatic path (A2.6), but stops for the user to review and edit before saving. While editing, `updInvTotals()` recalculates subtotal/VAT/total live as line items change, and warns (`_showInvJobSyncBanner`) if the new total no longer matches the job's stored price.
- **Validation:** Client name/address expected to be present (pre-filled from the job); numeric fields checked for valid numbers.
- **Database Queries:** `GET` to check no invoice already exists for the job; a numbering call (scans existing invoices); `POST` to create the invoice; `PATCH` on the job to link it and mark it Invoiced.
- **Supabase:** Standard REST calls.
- **Storage / Realtime:** Not used directly for the invoice; the job's status `PATCH` is pushed live.
- **Other Apps:** Visible to Client Portal once the invoice exists.
- **Notifications:** Success toast.
- **UI Update:** Modal closes; new invoice shown in the Invoices list.
- **Logs:** Activity entry; an `invoice_audit` row may also be written describing the creation action.
- **Completion:** A reviewed, accurate invoice exists and is ready to send.

#### A3.2 — Create a Standalone Proforma
- **User Action:** Clicks "New Proforma" (not linked to a specific job), fills in client + items, saves.
- **Frontend Process:** `openStandaloneProformaModal()` / `saveStandaloneProforma()` / `createStandaloneProforma()`. This also **auto-creates a lightweight placeholder job** (prefixed `PR-`) so the proforma has something to attach to in reporting.
- **Validation:** Client name and at least a price expected.
- **Database Queries:** `POST` for the placeholder job, a numbering call for the next `PF-###` number, `POST` for the invoice row (with `type:'proforma'`).
- **Supabase:** Standard REST calls.
- **Storage / Realtime:** Not used for the invoice; the placeholder job insert is pushed live (it's on the `jobs` table).
- **Other Apps:** Not shown to the Client Portal unless later converted to a real invoice and sent (proformas are quotations, not final bills).
- **Notifications:** Success toast.
- **UI Update:** New proforma visible in the Invoices list, tagged distinctly.
- **Logs:** Activity entry.
- **Completion:** A quotation-style document exists, ready to send or later convert.

#### A3.3 — Create a Disposable Invoice
- **User Action:** Clicks "Quick/Disposable Invoice" for a one-off client not in the directory, enters name/amount/description, saves.
- **Frontend Process:** `openDisposableModal()` / `saveDisposableInvoice()` / `createDisposableInv()` — deliberately minimal, flagged `disposable:true`.
- **Validation:** Client name and amount required.
- **Database Queries:** Numbering call, then `POST` to `invoices`.
- **Supabase:** Standard REST call.
- **Storage / Realtime:** Not used.
- **Other Apps:** Not linked to a Client Portal link automatically (no `persons` record is created for a disposable invoice, so there's no portal ID to share).
- **Notifications:** Success toast.
- **UI Update:** New invoice appears in the list.
- **Logs:** Activity entry.
- **Completion:** A quick, no-fuss invoice exists for a one-off job/client.

#### A3.4 — Convert a Proforma to a Real Invoice
- **User Action:** Opens a proforma, clicks "Convert to Invoice."
- **Frontend Process:** `convertProformaToInvoice(proformaId)`.
- **Validation:** Must currently be type `proforma`.
- **Database Queries:** A numbering call for a real invoice number, then `PATCH` changing `type` to `'invoice'` and assigning the number.
- **Supabase:** Standard REST call.
- **Storage / Realtime:** Not used.
- **Other Apps:** Now visible to the Client Portal as a real invoice (previously it would not have been shown as billable).
- **Notifications:** Success toast.
- **UI Update:** Invoice badge/status changes from "Proforma" to normal invoice.
- **Logs:** An `invoice_audit` entry recording the conversion.
- **Completion:** The quotation is now an official invoice.

#### A3.5 — Record a Payment Against an Invoice
- **User Action:** Opens an invoice, clicks "Record Payment," enters amount/date/method/reference, saves.
- **Frontend Process:** `openPaymentModal()` / `savePayment()` calculates the current outstanding balance and pre-fills the full remaining amount as a suggestion.
- **Validation:** Amount must be a positive number.
- **Database Queries:** `POST` to the `payments` table; the invoice's paid-status is then recalculated by summing all payments against that invoice's total.
- **Supabase:** Standard REST call.
- **Storage / Realtime:** Not used.
- **Other Apps:** Payment/paid-status becomes visible to the Client Portal on next load.
- **Notifications:** Success toast; if the payment brings the invoice to fully paid, an additional confirmation.
- **UI Update:** Invoice status badge changes to "Paid" once the running total matches the invoice total (within 1 penny); a payment progress bar updates otherwise.
- **Logs:** Written into the invoice's own audit trail (`_renderInvAuditTrail`, drawing on `payments` + `invoice_audit`).
- **Completion:** Invoice balance reduced or fully settled.

#### A3.6 — Create a Credit Note
- **User Action:** Opens a paid/sent invoice, clicks "Issue Credit Note," adjusts line items if needed, saves.
- **Frontend Process:** `saveCreditNote()` pre-fills the credit note with the original invoice's line items for adjustment, and links it back to the original.
- **Validation:** Must be based on an existing invoice.
- **Database Queries:** A numbering call producing `INV-CN-<original number>`, then `POST` to `invoices` with `status:'Credit Note'` and `isCreditNote:true`.
- **Supabase:** Standard REST call.
- **Storage / Realtime:** Not used.
- **Other Apps:** Visible to Client Portal as a credit against their account.
- **Notifications:** Success toast.
- **UI Update:** Credit note appears in the special "Credit Notes" admin view (`renderCreditNotesAdmin`), which also totals up losses by staff member and by client.
- **Logs:** Activity entry with rich detail (amount, staff, original invoice reference).
- **Completion:** A formal reversal/adjustment document exists against the original invoice.

#### A3.7 — Download Invoice PDF
- **User Action:** Clicks "Download PDF" on an invoice.
- **Frontend Process:** Builds a PDF entirely in the browser using the jsPDF library — draws the company logo/header, an itemised table, VAT breakdown, totals, bank details, and terms, based on settings toggles (show/hide VAT, show/hide bank details, watermark "PAID" if applicable).
- **Validation:** None — always available once the invoice exists.
- **Database Queries:** None new (uses already-loaded invoice data).
- **Supabase:** Not called (no server involved in PDF creation).
- **Storage / Realtime / Other Apps:** Not used.
- **Notifications:** None (the file download itself is the confirmation).
- **UI Update:** Browser triggers a file download/save dialog.
- **Logs:** None.
- **Completion:** A `.pdf` file is saved to the user's device.

#### A3.8 — Send Invoice via WhatsApp
- **User Action:** Clicks "Send via WhatsApp" on an invoice.
- **Frontend Process:** Builds a message from the `S.waInvTpl` settings template, substituting invoice number, amount, due date, and bank details.
- **Validation:** A phone number must be present on the client record, or the user is prompted to enter one.
- **Database Queries:** None new for the send itself.
- **Supabase:** Not used — this is **not** a real WhatsApp API integration. It opens a `https://wa.me/<number>?text=<message>` link in a new browser tab, handing off to WhatsApp Web/the WhatsApp app on the user's own device. The user still has to press Send themselves inside WhatsApp.
- **Storage / Realtime:** Not used.
- **Other Apps:** Not used — this leaves the DeepFlow system entirely and goes through WhatsApp's own infrastructure.
- **Notifications:** A toast: "Opening WhatsApp…"
- **UI Update:** WhatsApp opens in a new tab/app with the message pre-filled.
- **Logs:** None automatic (there's no confirmation that the message was actually sent, since DeepFlow hands off control at this point).
- **Completion:** Message is ready in WhatsApp for the staff member to send manually.

#### A3.9 — Editing an Invoice Field Syncs Back to the Linked Job
- **User Action:** While viewing/editing a linked invoice, changes the description, address, date, or client name.
- **Frontend Process:** `_syncInvoiceFieldToJob()` runs automatically whenever one of a specific list of fields changes on an invoice that has a `linkedJobId`.
- **Validation:** Only applies to a fixed list of syncable fields; price changes are handled separately and more cautiously (see below).
- **Database Queries:** A `PATCH` on the linked `jobs` row, silently, for text fields. For a **price** change, `_syncInvoicePriceToJob()` runs: if it's a simple single-line-item invoice, it silently syncs and shows a toast; if there are multiple line items (so the "right" job price is ambiguous), it shows a non-blocking mismatch notice instead of forcing a decision.
- **Supabase:** Standard REST `PATCH`.
- **Storage:** Not used.
- **Realtime:** The job-side `PATCH` is pushed live (jobs table).
- **Other Apps:** Engineer app sees the updated job description/address on next poll.
- **Notifications:** Toast for price syncs; a banner (`_showInvJobSyncBanner`) for other mismatches.
- **UI Update:** The linked job's info panel reflects the new values.
- **Logs:** Activity entry.
- **Completion:** Job and invoice stay consistent with each other (for text fields); price mismatches are flagged for a human to resolve rather than auto-changed silently.

---

## A4. Certificates

#### A4.1 — Manually Add a Certificate (not via job completion)
- **User Action:** Opens the Certificates screen, clicks "Add Certificate," picks type, address, issue date, expiry date, certificate number, saves.
- **Frontend Process:** `createCertEntry(type, expiry, certNum, issueDate)` — same underlying function used by the automatic job-completion path (A2.5), just invoked manually with user-supplied values instead of auto-detected ones.
- **Validation:** Duplicate check — if a certificate for the same job + type already exists, it is not duplicated. Certificate number auto-generated if left blank (using the type's prefix + job number digits + a timestamp fragment).
- **Database Queries:** `POST` to `certs`.
- **Supabase:** Standard REST call.
- **Storage / Realtime:** Not used.
- **Other Apps:** Visible to Client Portal for that landlord/agency's properties.
- **Notifications:** Success toast.
- **UI Update:** New certificate appears in the Certificates dashboard/table.
- **Logs:** Activity entry.
- **Completion:** Certificate on file with a tracked expiry date.

#### A4.2 — View Certificate Expiry Status / Reminders
- **User Action:** Opens the Certificates dashboard, or views the "Expiring Certs" widget on the Dashboard.
- **Frontend Process:** Purely a read-and-calculate step — compares each certificate's `expiryDate` to today's date to bucket them into "active / expiring soon / expired."
- **Validation:** None (read-only).
- **Database Queries:** `GET` on `certs` (usually served from the in-memory cache rather than a fresh call each time).
- **Supabase / Storage / Realtime:** Not used for the display itself.
- **Other Apps:** Not applicable.
- **Notifications:** None from this screen directly (see A4.3 for the reminder-sending action). Note: there is also an optional, separately-installed database-side scheduled job (`send_cert_reminders`, described in the architecture document) that can log pending reminders once a day — but that is independent SQL, not something this on-screen view triggers.
- **UI Update:** Colour-coded badges (green/amber/red) per certificate.
- **Logs:** None.
- **Completion:** Office staff can see at a glance what needs renewing.

#### A4.3 — Send Bulk Certificate Renewal Reminders
- **User Action:** On the Certificates → Reminders tab, selects a set of expiring certificates and clicks a bulk WhatsApp reminder button.
- **Frontend Process:** Builds a reminder message per landlord using a settings template, opening a WhatsApp link for each.
- **Validation:** Requires a phone number on the linked landlord/person record.
- **Database Queries:** `GET` on `persons` to fetch phone numbers.
- **Supabase:** Not used for the send itself (same `wa.me` link pattern as A3.8 — no real API).
- **Storage / Realtime:** Not used.
- **Other Apps:** Leaves the system, goes through WhatsApp directly.
- **Notifications:** Toast(s) as each WhatsApp link opens.
- **UI Update:** None persistent (WhatsApp opens externally).
- **Logs:** None automatic.
- **Completion:** Reminder messages are queued up in WhatsApp for staff to send manually, one per landlord.

---

## A5. Directories (Persons / Agencies / Agents)

#### A5.1 — Add / Edit / Delete a Person (Landlord)
- **User Action:** From Directories, clicks "+ Add Person" (or edits/deletes an existing one) and fills in name, phone, email, address, WhatsApp number, notes.
- **Frontend Process:** `savePerson()` handles both create and edit through the same form; a delete button removes an existing record after confirmation.
- **Validation:** Name is required; duplicate-name/duplicate-phone checks may surface a warning (see A5.4) but don't hard-block saving.
- **Database Queries:** `POST` (create/edit, upsert-style) or `DELETE` on the `persons` table.
- **Supabase:** Standard REST calls.
- **Storage / Realtime:** Not used.
- **Other Apps:** Any Client Portal link already shared for this person keeps working after an edit (same ID); it stops working after a delete (the portal will show "Not Found").
- **Notifications:** Success toast.
- **UI Update:** Directory card list updates.
- **Logs:** Activity entry.
- **Completion:** Landlord/person record created, updated, or removed.

#### A5.2 — Add / Edit / Delete an Agency
- Identical pipeline to A5.1, but on the `agencies` table. Agencies additionally show a count of linked agents (see A5.3) on their card.

#### A5.3 — Add / Edit / Delete an Agent
- Identical pipeline to A5.1, but on the `agents` table, with an `agencyId` linking each agent to a parent agency.

#### A5.4 — Duplicate Phone Number Detected While Typing
- **User Action:** Types a landlord/agent/agency phone number into the job form (or a directory form).
- **Frontend Process:** `checkDuplicatePhone(val, context)` waits 600ms after typing stops (a "debounce," to avoid checking on every keystroke), then compares the cleaned number against existing `persons`/`agents`/`agencies` phone numbers.
- **Validation:** Purely advisory — if a match is found under a *different* name than what's currently typed, a popup appears; if the name matches, nothing happens (assumed to be the same person).
- **Database Queries:** `GET` (usually served from cache) on the relevant directory table.
- **Supabase / Storage / Realtime:** Not used.
- **Other Apps:** Not applicable.
- **Notifications:** An in-context popup (`showDupPopup`) offering to "use existing" or "update the existing record's name."
- **UI Update:** Popup appears under the phone field.
- **Logs:** None (unless the user acts on it, which then follows A5.1's logging).
- **Completion:** Staff either dismiss the warning, reuse the existing contact, or rename it — preventing accidental duplicate directory entries.

#### A5.5 — Merge Duplicate Directory Records
- **User Action:** Selects two or three person records believed to be duplicates, opens "Merge," picks which value to keep for each field (name/phone/email/etc.), confirms.
- **Frontend Process:** The merge modal shows each candidate side-by-side with the "most complete" value pre-selected as a default; the user can override per field.
- **Validation:** At least one "master" record must be chosen to survive the merge.
- **Database Queries:** A `PATCH`/`POST` updating the surviving master record with the chosen field values, followed by a full sweep across the `jobs` and `invoices` tables (and likely `certs`), rewriting every reference (`landlordName`, `landlordPhone`, `clientName`, `clientId`, etc.) that matched any of the merged records' old names/phones/emails so they now point at the single surviving record, and finally deleting the losing record(s).
- **Supabase:** Multiple sequential REST calls.
- **Storage / Realtime:** Not used.
- **Other Apps:** Any Client Portal link built from a now-deleted duplicate ID will stop working; the surviving record's link continues to work with the combined history.
- **Notifications:** Success toast once the merge completes.
- **UI Update:** Directory list shows one combined record instead of two/three.
- **Logs:** Activity entry describing the merge.
- **Completion:** Duplicate contacts are consolidated into a single, more complete record, with historical jobs/invoices correctly reattributed.

#### A5.6 — Client View (360° Lookup)
- **User Action:** Searches for a landlord or agency by name in the "Client View" screen.
- **Frontend Process:** `cvSearch()` searches cached `persons`/`agencies`; `cvLoadClient()` then pulls together every job, invoice, and certificate connected to that name (by text matching, as covered in the architecture document), plus a computed star rating.
- **Validation:** None (read-only lookup).
- **Database Queries:** `GET` on `jobs`, `invoices`, `certs`, `payments`, `agents` (loaded in parallel).
- **Supabase / Storage / Realtime:** Standard REST reads only.
- **Other Apps:** Not applicable — this is an internal reporting screen.
- **Notifications:** None.
- **UI Update:** A single combined profile page: hero card with star rating, KPI tiles (total jobs, paid amount, outstanding, certificates), and tabbed job/invoice/certificate history.
- **Logs:** None.
- **Completion:** Office staff get a full picture of one client without hunting across multiple screens.

---

## A6. Properties

#### A6.1 — Add / Edit / Delete a Property
- **User Action:** From the Properties screen, adds a new property address (optionally linking a landlord), or edits/deletes an existing one.
- **Frontend Process:** `saveProp()` / `deleteCurrentProp()`. Property "jobs" and "certificates" shown on a property's card are found by matching the first ~20 characters of the address against jobs/certs, not by a real database link.
- **Validation:** Address required.
- **Database Queries:** **None to a `properties` table — there isn't one.** Instead, the entire properties list is read from and written back to the single-row `app_settings` blob via `saveSetting('properties', ...)`.
- **Supabase:** A `PATCH`/`POST` on `app_settings`, re-saving the *entire* settings object even though only the properties list changed.
- **Storage / Realtime:** Not used.
- **Other Apps:** Property list is not directly exposed to the Client Portal or Engineer app as its own concept — they only see it indirectly through matching job addresses.
- **Notifications:** Success toast.
- **UI Update:** Property card grid updates.
- **Logs:** None dedicated.
- **Completion:** Property list updated inside the shared settings blob.

---

## A7. Workforce

#### A7.1 — View Live Maps (Engineer Locations)
- **User Action:** Opens the "Live Maps" screen.
- **Frontend Process:** Filters the loaded engineer list to those with a GPS position seen within the last hour, computes a map centre point, and either draws a static map image or a list with "Open in Maps" links.
- **Validation:** None (read-only).
- **Database Queries:** `GET` on `users` filtered to role `engineer`, selecting `last_lat`, `last_lng`, `last_seen`.
- **Supabase:** Standard REST read.
- **Storage:** Not used.
- **Realtime:** Not used — this is a snapshot, refreshed on the normal polling cycle, not a continuously live-streaming map.
- **Other Apps:** The *positions themselves* are written exclusively by the Engineer app (see B22) — Office only ever reads them here.
- **Notifications:** None.
- **UI Update:** Map/list of currently "live" engineers.
- **Logs:** None.
- **Completion:** Office can see roughly where each engineer currently is.

#### A7.2 — View Engineer Reports (list + deep report)
- **User Action:** Opens "Engineer Reports," optionally clicks into one engineer's name for a deep report.
- **Frontend Process:** `_computeEngStats()` aggregates that engineer's jobs/invoices/certs into today/week/month/lifetime figures; `openEngDeepReport()` builds a tabbed profile (jobs / certs / earnings / trend / activity) with a 6-month earnings bar chart and an online/offline indicator based on `last_seen`.
- **Validation:** None (read-only).
- **Database Queries:** `GET` on `jobs`, `invoices`, `certs` (already-cached data, filtered/aggregated client-side).
- **Supabase / Storage / Realtime:** Standard reads only; not used further.
- **Other Apps:** Not applicable.
- **Notifications:** None.
- **UI Update:** Full report screen/overlay.
- **Logs:** None.
- **Completion:** A complete performance picture for one engineer, or all engineers ranked against each other.

#### A7.3 — Download Engineer Payslip
- **User Action:** From the deep report, clicks "Download Payslip."
- **Frontend Process:** `downloadEngPayslip(engName)` calculates gross pay (day-rate × completed jobs this month, or hourly-rate × a flat 4-hours-per-job assumption when no logged hours exist), subtracts matching expense-category deductions, computes net pay.
- **Validation:** None beyond the engineer having at least some jobs/rate configured.
- **Database Queries:** `GET` on `jobs`, `expenses` filtered to that engineer and month.
- **Supabase:** Standard REST reads.
- **Storage / Realtime:** Not used.
- **Other Apps:** Not applicable (this document is never sent anywhere automatically).
- **Notifications:** None.
- **UI Update:** A new browser window/tab opens containing a formatted payslip document.
- **Logs:** None.
- **Completion:** Rather than generating a PDF file directly, this opens a print-ready HTML page and relies on the browser's own "Print → Save as PDF" feature to produce the final file.

#### A7.4 — Log Overtime / Absence
- **User Action:** Opens the Overtime modal for an engineer, picks a type (1-hour overtime, 2-hour overtime, custom, half-day absence, full-day absence), enters details, saves.
- **Frontend Process:** `saveOvertimeLog()` writes the entry directly — this is a **logging** action recorded as fact, not a request awaiting approval (that distinct workflow is B17, which comes from the Engineer app instead).
- **Validation:** A type and (for custom) an hour value are required.
- **Database Queries:** `POST` to the `overtime` table.
- **Supabase:** Standard REST call.
- **Storage / Realtime:** Not used.
- **Other Apps:** Not directly visible to the Engineer app as a separate item (it feeds into payslip/report calculations on the Office side).
- **Notifications:** Success toast.
- **UI Update:** Entry appears in that engineer's timesheet/overtime list.
- **Logs:** This *is* the log — stored permanently in the `overtime` table.
- **Completion:** Overtime/absence recorded for payroll purposes.

#### A7.5 — View Timesheets
- **User Action:** Opens the Timesheets screen, selects an engineer from the side list.
- **Frontend Process:** Pulls together that engineer's completed jobs and overtime entries into a simple table with a total at the bottom.
- **Validation:** None (read-only).
- **Database Queries:** `GET` on `jobs`, `overtime`.
- **Supabase / Storage / Realtime:** Standard reads only.
- **Other Apps:** Not applicable.
- **Notifications:** None.
- **UI Update:** Timesheet table renders for the selected engineer.
- **Logs:** None.
- **Completion:** A simple hours/earnings summary is visible per engineer.

---

## A8. Communication

#### A8.1 — Send a Broadcast Alert to Engineers
- **User Action:** Clicks the 📢 icon, writes a title/message, picks a severity (info/warning/urgent), picks a target (all engineers, or one specific engineer), clicks Send.
- **Frontend Process:** `openBroadcast()` / `sendBroadcast()`.
- **Validation:** Message text required.
- **Database Queries:** `POST` to `engineer_alerts` (with an automatic 1-hour expiry timestamp). If this is the very first broadcast ever sent and the table doesn't exist yet, `_ensureAlertsTable()` first tries to auto-create it via a Postgres RPC call, falling back to showing the admin the raw SQL to run manually if that fails.
- **Supabase:** Standard REST `POST`, plus the optional `rpc/exec_sql` self-repair call described above.
- **Storage / Realtime:** Not used (`engineer_alerts` is not on the Realtime-enabled table).
- **Other Apps:** The Engineer app picks this up by **polling** every 15 seconds — not instantly.
- **Notifications:** A confirmation toast in the Office app; on the Engineer side, a full-screen alert popup with vibration once it's received.
- **UI Update:** Broadcast modal closes.
- **Logs:** None dedicated beyond the `engineer_alerts` row itself.
- **Completion:** Message queued for delivery to the target engineer(s) within the next polling cycle.

#### A8.2 — In-App Notification Bell
- **User Action:** Various background events happen (new job request, job status change from another user, etc.); the user clicks the 🔔 bell to view them.
- **Frontend Process:** `_pushNotif()` adds an entry to an in-memory notification list (capped at 50) and, if the browser has granted permission, also fires a native browser `Notification` popup.
- **Validation:** None.
- **Database Queries:** None (the notifications themselves are not stored in the database — they're a client-side, in-memory feed built from other events like Realtime job changes and polling results).
- **Supabase / Storage:** Not used directly for the notification itself.
- **Realtime:** This feature is largely *fed by* the Realtime job-change events (A11.1) and by polling other tables.
- **Other Apps:** Not applicable.
- **Notifications:** This *is* the notification feature.
- **UI Update:** A red badge count appears on the bell; clicking it opens the dropdown list.
- **Logs:** None persistent — refreshing the page clears this feed (it is not saved anywhere).
- **Completion:** Staff stay aware of changes without needing to constantly refresh the page.

#### A8.3 — Job Requests Inbox
- **User Action:** Opens the "Job Requests" screen to review incoming requests from clients (via the portal) or overtime/leave requests from engineers.
- **Frontend Process:** Reads and lists all `engineer_requests` rows, distinguishing `type: 'portal_request'` (from clients) from overtime/leave types (from engineers), typically sorted with `pending` first.
- **Validation:** None for viewing; approving/responding may require typing a reply.
- **Database Queries:** `GET` on `engineer_requests`; approving/rejecting does a `PATCH` updating `status` and `office_reply`.
- **Supabase:** Standard REST calls.
- **Storage / Realtime:** Not used (this table is polled, not pushed live).
- **Other Apps:** The original requester (Engineer app or Client Portal) will see the status/reply update the next time they load their own "past requests" view.
- **Notifications:** New pending requests contribute to the notification bell (A8.2) via the polling cycle.
- **UI Update:** Request list updates; badge count on the "Job Requests" nav item reflects pending count.
- **Logs:** The request row itself is the record.
- **Completion:** Staff turn a client's request into a real scheduled job (going back to A2.1), or approve/reject an engineer's overtime/leave request.

#### A8.4 — Generate & Share a Client Portal Link
- **User Action:** From a person/agency/agent record, clicks "Share Portal Link."
- **Frontend Process:** `_buildPortalUrl(id, type, name)` builds a URL like `client-portal.html?id=<id>&type=landlord`; `shareClientPortal()`/`copyClientPortal()`/`showPortalLinkModal()` present it with copy/QR-code/WhatsApp/email share buttons; `_generateQR()` draws a scannable QR code for it.
- **Validation:** The record must have a valid ID (always true for a saved record).
- **Database Queries:** None new — uses the already-known record ID.
- **Supabase / Storage / Realtime:** Not used for generating the link itself.
- **Other Apps:** This link, once opened, *is* how the Client Portal app gets its identity (see C1) — this is the one deliberate, intentional bridge between the Office app and the Client Portal.
- **Notifications:** "Copied to clipboard" toast, or WhatsApp/email opens with the link pre-filled.
- **UI Update:** A styled "portal invite card" modal is shown with the QR code and share buttons.
- **Logs:** None.
- **Completion:** Client now has (or can be sent) a working link to their self-service portal.

---

## A9. Admin & Settings

#### A9.1 — Edit Company Settings
- **User Action:** Settings → Company tab: edits company name, address, VAT number, logo, bank details, payment terms.
- **Frontend Process:** Form fields bind directly to the in-memory `S` settings object; "Save" triggers `saveAllSettings()`.
- **Validation:** Minimal (mostly free text; logo upload checked for image file type).
- **Database Queries:** `PATCH`/`POST` on the single `app_settings` row, re-saving the whole settings blob.
- **Supabase:** Standard REST call.
- **Storage:** If a logo image is uploaded, it is stored as inline base64 image data inside the settings blob itself — **not** uploaded to the Storage bucket.
- **Realtime:** Not used.
- **Other Apps:** These settings (company name, bank details, VAT settings) directly affect what's shown on invoice PDFs seen by the Client Portal and printed for clients.
- **Notifications:** Success toast.
- **UI Update:** Company details reflected immediately across the app (e.g. invoice previews).
- **Logs:** None dedicated.
- **Completion:** Company profile updated system-wide.

#### A9.2 — Team Management: Sync, Add Login, Change Role, Revoke
- **User Action:** Settings → Team tab: clicks "Sync from Supabase" to refresh the list, types a name and picks a role for a Supabase Auth account not yet added, or changes an existing person's role, or clicks "Remove."
- **Frontend Process:** `loadTeam()` cross-references every Supabase Auth account against the `users` table; `teamAdd()` creates a profile row for an Auth account that doesn't have one yet (this is what actually gives someone real access — the Supabase Auth account itself must already exist, created separately in the Supabase dashboard or via the `create_confirmed_user` SQL helper); `teamChangeRole()` updates a role; `teamRevoke()` deactivates access.
- **Validation:** **Admin-only** — the whole screen refuses to run for any other role. A name is required before adding someone. The current logged-in user cannot change their own role or remove themselves.
- **Database Queries:** An Auth **RPC call** (`get_auth_users`, a custom SQL function) to list every Supabase Auth account; `GET` on `users`; `POST` (add), `PATCH` (role change), or a revoke-style update on `users`.
- **Supabase:** Uses a Postgres RPC function (not a normal table query) to read the Auth user list, since that data isn't otherwise exposed to the app.
- **Storage / Realtime:** Not used.
- **Other Apps:** A newly-added Office user can immediately log in via A1.1; a newly-added Engineer-role user can immediately log in to the Engineer app (B1).
- **Notifications:** Toast confirming the action (or an explanatory error if the required RPC function hasn't been installed yet, with the SQL to fix it shown inline).
- **UI Update:** Team list refreshes; `S.users`/`S.engineers` are refreshed and cached to `localStorage` for use in dropdowns elsewhere in the app.
- **Logs:** None dedicated.
- **Completion:** Staff/engineer access is granted, changed, or revoked.

#### A9.3 — Configure Per-Engineer Visibility Permissions
- **User Action:** Settings → Team (or a dedicated permissions panel): toggles checkboxes per engineer for what they can see (price, landlord details, tenant details, agent details, notes, invoice info).
- **Frontend Process:** `loadEngPerms()` renders the checkbox grid; `updateEngPerm(engId, field, val)` updates one flag at a time.
- **Validation:** None beyond a valid engineer ID.
- **Database Queries:** None to a dedicated table — like Properties (A6.1), this is stored inside the `app_settings` blob (`S.engPerms`, keyed by engineer ID) and saved via the same settings save call.
- **Supabase:** `PATCH`/`POST` on `app_settings`.
- **Storage / Realtime:** Not used.
- **Other Apps:** **Important gap:** although this is clearly designed to restrict what an engineer sees in the Engineer app, the Engineer app's code was checked and does **not** read `engPerms` anywhere — so, currently, changing these toggles has no actual effect on what an engineer sees in their app.
- **Notifications:** "Permission updated" toast.
- **UI Update:** Checkbox reflects the new state immediately.
- **Logs:** None.
- **Completion:** Setting is saved, but (as of this codebase) not enforced.

#### A9.4 — Configure Trades & Certificate Types
- **User Action:** Settings → Trades: adds/edits a trade (name, colour, default price) or a certificate type (name, validity period in months, reminder window, keyword list, colour, number prefix).
- **Frontend Process:** Directly edits the `S.trades` / `S.certTypes` arrays.
- **Validation:** Name required; validity/reminder expected to be numbers.
- **Database Queries:** `PATCH`/`POST` on `app_settings`.
- **Supabase:** Standard REST call.
- **Storage / Realtime:** Not used.
- **Other Apps:** These keyword lists directly power the automatic certificate-detection feature (A2.5/A4.1). The Engineer app has its own separate hardcoded default cert-type list and only picks up office-configured types if `localStorage` happens to already contain them on that same device (an unreliable cross-device mechanism, as noted in the architecture document).
- **Notifications:** Success toast.
- **UI Update:** New/changed trade or cert type available immediately in dropdowns and auto-detection.
- **Logs:** None dedicated.
- **Completion:** Trade/certificate catalogue updated.

#### A9.5 — Configure WhatsApp Message Templates
- **User Action:** Settings → WhatsApp: edits the template text used for job dispatch, invoices, tenant notices, landlord completion messages, using placeholders like `{client_name}`.
- **Frontend Process:** `saveNotifSettings()` / `renderNotifPreview()` shows a live preview of the message with sample data substituted in.
- **Validation:** None beyond free text.
- **Database Queries:** `PATCH`/`POST` on `app_settings`.
- **Supabase:** Standard REST call.
- **Storage / Realtime:** Not used.
- **Other Apps:** These templates are the exact text used whenever any WhatsApp-send button is clicked elsewhere in the Office app (A3.8, A4.3, job-dispatch messages).
- **Notifications:** Success toast.
- **UI Update:** Preview box updates as you type.
- **Logs:** None.
- **Completion:** Message wording updated for all future WhatsApp sends.

#### A9.6 — Configure Invoicing Rules
- **User Action:** Settings → Invoicing: toggles VAT on/off and rate, invoice number prefix/start number, what appears on the PDF (logo, bank details, VAT breakdown, terms), auto-invoice-on-completion on/off, sync behaviour between invoices and jobs.
- **Frontend Process:** Directly edits fields on `S` (e.g. `S.vatEnabled`, `S.vatRate`, `S.invPrefix`, `S.autoInvOnComplete`, `S.invSyncAmount`).
- **Validation:** VAT rate expected to be numeric.
- **Database Queries:** `PATCH`/`POST` on `app_settings`.
- **Supabase:** Standard REST call.
- **Storage / Realtime:** Not used.
- **Other Apps:** Directly controls whether A2.6 (auto-invoicing) happens at all, and what future invoice PDFs (A3.7) look like.
- **Notifications:** Success toast.
- **UI Update:** Immediate effect on invoice forms/PDF previews.
- **Logs:** None.
- **Completion:** Company-wide invoicing behaviour updated.

#### A9.7 — SQL / Database Admin Tools ("Guide & SQL" tab)
- **User Action:** Settings → Guide & SQL: clicks a pre-written SQL snippet to copy it, or clicks a one-click button like "Create All Required Tables Now" or "Check if pg_cron is active."
- **Frontend Process:** `renderSqlSnippets()` renders a fixed library of copy-paste SQL blocks (table creation, RLS fixes, useful queries); `copySql()` copies text to the clipboard; `createAllTables()` and `checkCronSetup()` attempt small automated checks/repairs by calling Supabase RPC endpoints.
- **Validation:** None (this is a developer/admin tool, gated to the Admin role by nav visibility).
- **Database Queries:** Test queries (e.g. `SELECT 1 FROM cert_reminder_log LIMIT 1`) to check whether a table exists; RPC calls attempting to run arbitrary SQL to create missing tables.
- **Supabase:** Uses the `rpc/exec_sql` endpoint directly with the app's own API key to attempt schema changes from the browser — a notable capability, since it means the key in use can, under the right server-side function, alter the database structure itself, not just its data.
- **Storage / Realtime:** Not used.
- **Other Apps:** None directly, though the tables this creates (e.g. `engineer_alerts`) are what other features (A8.1) depend on.
- **Notifications:** Toast confirming SQL copied, or a status message if a table check/creation succeeds or fails.
- **UI Update:** Status text updates inline.
- **Logs:** None.
- **Completion:** Admin has either copied SQL to run manually in the Supabase dashboard, or (for a few specific cases) triggered an automatic fix from inside the app itself.

#### A9.8 — Storage Usage Dashboard
- **User Action:** Settings → Data (Admin only): clicks "Refresh" on the Storage Usage panel.
- **Frontend Process:** `loadStorageDashboard()` lists the contents of the Storage bucket and totals up size/file count.
- **Validation:** Admin-only (panel hidden for other roles).
- **Database Queries:** A count query against what should be the certificates table — this was found to reference a table named `certificates`, while every other part of the app uses `certs`, meaning this specific count is likely always wrong/zero due to a naming mismatch bug.
- **Supabase:** A `GET` to the Storage API's `object/list/deepflow` endpoint.
- **Storage:** Yes — this feature exists specifically to inspect Storage usage.
- **Realtime:** Not used.
- **Other Apps:** Not applicable.
- **Notifications:** None beyond the panel refreshing.
- **UI Update:** File count / usage figures displayed.
- **Logs:** None.
- **Completion:** Admin can see how much storage the photo library is using.

#### A9.9 — Export / Import Full JSON Backup
- **User Action:** Settings → Data: clicks "Export Full JSON Backup" (downloads a file) or "Import Backup" (selects a previously exported file).
- **Frontend Process:** `exportBackup()` gathers jobs, persons, invoices, certs, overtime, payments, expenses, agencies, agents, and all settings into one JSON file and triggers a browser download. `importBackup()` reads a chosen file, asks for confirmation ("this will overwrite current data"), then re-saves every record from the file back into the database.
- **Validation:** Import requires a valid JSON file matching the expected shape; explicit confirmation required before overwriting.
- **Database Queries:** Export: multiple `GET` calls (one per table). Import: multiple `POST`/upsert calls, one per record in the file, plus a full settings re-save.
- **Supabase:** Standard REST calls, many in sequence.
- **Storage / Realtime:** Not used (attachments/photos are **not** included in this backup — only database rows).
- **Other Apps:** A large import would become visible to the Engineer app and Client Portal exactly as if all that data had just been entered normally.
- **Notifications:** Success toast; the page fully reloads after an import.
- **UI Update:** Whole app reloads with restored data (import) or a file is saved to disk (export).
- **Logs:** None dedicated.
- **Completion:** A portable backup of everything except photo files, that can restore the system to a known state.

#### A9.10 — View the Audit Log
- **User Action:** Opens the Audit Log screen (Admin only), optionally filters by staff member or action type.
- **Frontend Process:** `renderAuditLog()` fetches and displays entries.
- **Validation:** Admin-only — non-admins are shown an error and blocked.
- **Database Queries:** `GET` on `audit_log`, most recent 500, with optional filters.
- **Supabase / Storage / Realtime:** Standard REST read only.
- **Other Apps:** Not applicable.
- **Notifications:** None.
- **UI Update:** A table of who did what and when, showing before/after values for invoice amount changes.
- **Logs:** This screen *is* the log viewer — remember this only ever contains two kinds of entries: job deletions and invoice amount changes (A2.3/A2.10 and A3.9's price-sync path), not a general activity trail (that's the separate `activity` table/feed).
- **Completion:** Admin can review the small set of sensitive actions taken across the system.

---

## A10. Reporting

#### A10.1 — P&L (Profit & Loss) Dashboard
- **User Action:** Clicks "P&L Dashboard" in the sidebar (Admin only), picks a time period, switches between its six tabs (Overview, Cash Flow, Top Clients, Job Types, VAT, Reminders).
- **Frontend Process:** `renderPLDashboard()` fetches jobs/invoices/expenses/payments once, then each tab's own render function (`_renderPLOverview`, `_renderPLCashFlow`, etc.) does its own client-side maths — revenue from paid invoices, wage costs from a flat day/hour rate per job, expense totals by category, a forward 30-day cash-flow projection, top clients by revenue, job counts by type, and a UK VAT-quarter breakdown.
- **Validation:** None (read-only, calculated).
- **Database Queries:** `GET` on `jobs`, `invoices`, `expenses`, `payments`.
- **Supabase / Storage / Realtime:** Standard reads only.
- **Other Apps:** Not applicable — internal management tool only.
- **Notifications:** None.
- **UI Update:** Full-screen overlay with KPI tiles, bar charts, and ranked lists.
- **Logs:** None.
- **Completion:** Management gets a financial snapshot. (Note: the wage figures are an estimate based on a flat rate per job rather than actual logged hours, and the VAT tab currently only totals output VAT, not a true input/output reconciliation — both are worth knowing if this screen is used for real accounting decisions.)

#### A10.2 — Reports Page
- **User Action:** Opens the Reports screen.
- **Frontend Process:** `renderReports()` shows summary statistics/cards (broader, simpler than the P&L dashboard).
- **Validation:** None (read-only).
- **Database Queries:** `GET` on relevant tables.
- **Supabase / Storage / Realtime:** Standard reads only.
- **Other Apps:** Not applicable.
- **Notifications:** None.
- **UI Update:** Report cards render.
- **Logs:** None.
- **Completion:** A general-purpose reporting overview.

#### A10.3 — Statements Page
- **User Action:** Opens Statements, picks a client/landlord and a date range, applies filters.
- **Frontend Process:** `renderStmt()` builds a running statement (list of invoices/payments for that client over the period) with quick date-range shortcuts (`stmtQuickRange`) and per-row selection for exporting a subset.
- **Validation:** None (read-only view/selection).
- **Database Queries:** `GET` on `invoices`, `payments`, filtered client-side once loaded.
- **Supabase / Storage / Realtime:** Standard reads only.
- **Other Apps:** Not applicable (this is distinct from the Client Portal's own invoice view — this is the office-side statement builder, which can then be shared or printed).
- **Notifications:** None.
- **UI Update:** Statement table renders with running balance.
- **Logs:** None.
- **Completion:** A period statement is ready to review, print, or send to a client.

---

## A11. System-Wide Features

#### A11.1 — Realtime Job Sync (background, always running once logged in)
- **User Action:** None directly — this starts automatically right after login (A1.1) and keeps running silently in the background.
- **Frontend Process:** `startRealtimeSync()` opens a live channel; `handleRealtimeChange()` reacts to every insert/update/delete on the `jobs` table.
- **Validation:** Not applicable.
- **Database Queries:** None initiated by this feature directly — it *reacts* to changes made elsewhere.
- **Supabase:** Uses the **Realtime** service specifically (a WebSocket connection, separate from the normal REST calls used everywhere else).
- **Storage:** Not used.
- **Realtime:** This *is* the Realtime feature.
- **Other Apps:** Not directly — only the Office app subscribes to this feed; the Engineer app and Client Portal never receive push updates, only what they get by polling or reloading.
- **Notifications:** Feeds into the notification bell (A8.2) for status/priority changes made by other users.
- **UI Update:** Individual table rows update in place (colour, status, engineer, price) with a brief highlight animation, without needing a manual refresh; if the currently-open job in the edit modal was changed by someone else, a conflict warning appears.
- **Logs:** None (this is a live data-sync mechanism, not a logging feature).
- **Completion:** Never really "completes" — it runs continuously until the user logs out or closes the tab, reconnecting automatically every 10 seconds if the connection drops.

#### A11.2 — Command Palette / Global Search
- **User Action:** Presses a keyboard shortcut (or clicks a search icon) to open the command palette, types a search term.
- **Frontend Process:** `renderCmd(query)` first matches against a fixed list of quick actions ("New Job," "New Invoice," navigation shortcuts); for longer queries, it also searches jobs, persons, invoices (including line-item text), expenses, and certificates.
- **Validation:** None.
- **Database Queries:** `GET`/cache reads across `jobs`, `persons`, `invoices`, `expenses`, `certs` for the "deep search" portion (only triggered once the query is more than one character long).
- **Supabase / Storage / Realtime:** Standard reads only.
- **Other Apps:** Not applicable.
- **Notifications:** None.
- **UI Update:** A dropdown list of matches appears, navigable with arrow keys and Enter.
- **Logs:** None.
- **Completion:** Selecting a result immediately navigates to and opens that record.

#### A11.3 — Toggle Light / Dark Theme
- **User Action:** Clicks the theme toggle.
- **Frontend Process:** Switches a CSS class on the page body and saves the choice.
- **Validation:** None.
- **Database Queries:** None (or optionally saved to settings if the app is configured to sync theme across devices — otherwise it's local only).
- **Supabase:** Not used, or a lightweight settings save if theme is synced.
- **Storage / Realtime:** Not used.
- **Other Apps:** Not applicable (each app's theme is independent).
- **Notifications:** None.
- **UI Update:** Entire colour scheme switches instantly.
- **Logs:** None.
- **Completion:** Preference remembered for next visit via `localStorage`.

---

# PART B — Engineer App (`engineer.html`)

#### B1 — Engineer Log In
- **User Action:** Enters email + password, taps "Sign In →".
- **Frontend Process:** `doLogin()` — same two-step pattern as the Office app.
- **Validation:** Both fields required; after Supabase Auth succeeds, the app additionally checks the matched `users` profile has `role==='engineer'` **and** `active===true` — anyone else is rejected with an explanatory message.
- **Database Queries:** `GET` on `users` by `auth_id`, falling back to `email`.
- **Supabase:** `signInWithPassword()`.
- **Storage / Realtime:** Not used.
- **Other Apps:** None triggered directly by logging in.
- **Notifications:** None beyond the screen transition.
- **UI Update:** Login screen replaced by the main app (Today/Upcoming/Done tabs).
- **Logs:** None dedicated to login itself.
- **Completion:** Session saved to `localStorage` for **30 days** (a longer session than the Office app's browser-managed one, deliberately, since engineers shouldn't have to log in daily on their phone), and the app immediately starts loading jobs, requests, weather, and background location tracking.

#### B2 — Engineer Log Out
- Same pattern as A1.2 — clears the local session, calls Supabase `signOut()`, returns to the login screen. Also explicitly stops the background GPS watcher (see B22) and clears the engineer's last known position from the database (`last_lat`/`last_lng`/`last_seen` set to null) so they stop appearing as "live" on the Office map.

#### B3 — Engineer Password Reset
- Same pattern as A1.3, using Supabase Auth's reset-email flow.

#### B4 — View Today / Upcoming / Done Job Lists
- **User Action:** Opens the app or switches tabs (Today / Upcoming / Done).
- **Frontend Process:** `loadJobs()` runs three queries in parallel and renders each into its own tab; Upcoming jobs are grouped by date with headers.
- **Validation:** None (read-only).
- **Database Queries:** Three separate `GET`s on `jobs`: today's jobs for this engineer, upcoming jobs (next 30 days), and the last 60 completed/cannot-access/cancelled jobs — all filtered case-insensitively by engineer name.
- **Supabase:** Standard REST reads.
- **Storage / Realtime:** Not used (this app does not use Realtime at all).
- **Other Apps:** Reflects whatever the Office app has assigned/scheduled.
- **Notifications:** A badge count on the "Today" tab shows how many of today's jobs are still not completed.
- **UI Update:** Job cards render, colour-coded by status/priority.
- **Logs:** None.
- **Completion:** Engineer sees their full workload at a glance; this refreshes automatically every 30 seconds while the app is open and visible.

#### B5 — Sort Jobs by Distance
- **User Action:** Taps the sort toggle to switch from time-order to nearest-first.
- **Frontend Process:** Re-sorts the already-loaded "Today" list using the engineer's last known GPS position and a cached lookup of each job address's coordinates.
- **Validation:** Only available if GPS position and address coordinates are known; otherwise falls back gracefully.
- **Database Queries:** None new — uses cached geocoding results stored in `localStorage`.
- **Supabase / Storage / Realtime:** Not used for the sort itself (address coordinates were previously fetched via a public geocoding lookup, cached locally).
- **Other Apps:** Not applicable.
- **Notifications:** None.
- **UI Update:** List re-orders instantly.
- **Logs:** None.
- **Completion:** Engineer can plan their route by proximity instead of scheduled time.

#### B6 — Pull to Refresh
- **User Action:** Drags down on the job list past a threshold and releases.
- **Frontend Process:** A custom touch-gesture handler detects the pull and calls `refreshAll()`.
- **Validation:** None.
- **Database Queries:** Re-runs `loadJobs()` (and the dashboard/requests data if on those tabs).
- **Supabase / Storage / Realtime:** Standard reads only.
- **Other Apps:** Picks up anything changed on the Office side since the last load.
- **Notifications:** A toast: "✅ Jobs updated."
- **UI Update:** A pull indicator animates, then the list refreshes.
- **Logs:** None.
- **Completion:** Manual, on-demand refresh completes.

#### B7 — Open Job Detail
- **User Action:** Taps a job card.
- **Frontend Process:** `openJob(id)` fetches full job details plus attachments and renders a bottom-sheet modal with status buttons, contact info (respecting what the engineer is allowed to see), notes box, and photo section.
- **Validation:** None (read-only open).
- **Database Queries:** `GET` on the specific job and its `attachments`.
- **Supabase / Storage / Realtime:** Standard reads; photo URLs point at Supabase Storage.
- **Other Apps:** Not applicable.
- **Notifications:** None.
- **UI Update:** Job detail sheet slides up.
- **Logs:** None.
- **Completion:** Engineer has full context for the job before starting work.

#### B8 — Update Job Status
- **User Action:** Taps a status pill (Pending / In Progress / Completed / Cannot Access / Emergency) inside the job detail.
- **Frontend Process:** `updateStatus()` / `quickStatusUpdate()`; a small celebratory animation (`playStatusAnim`) plays on Completed.
- **Validation:** None beyond picking one of the fixed options.
- **Database Queries:** `PATCH` on the job's `status` and `modified` fields.
- **Supabase:** Standard REST call.
- **Storage:** Not used.
- **Realtime:** Not used on this side — but this exact change is what the Office app's Realtime connection picks up and pushes live (A11.1). This is the clearest example of how a Realtime feature that only "belongs" to one app is actually triggered by actions happening in a completely different app.
- **Other Apps:** Directly visible, live, in the Office app; and if the new status is "Completed," this is what actually kicks off the Office app's automatic certificate (A2.5) and invoice (A2.6) creation chain.
- **Notifications:** A local toast and, on Completed, a phone vibration pattern.
- **UI Update:** Status pill highlights; card colour/border updates.
- **Logs:** Job list refreshes to reflect the new status.
- **Completion:** Job status change recorded and instantly propagated to the office.

#### B9 — Save Job Notes
- **User Action:** Types in the notes box on a job, taps away (auto-saves) or an explicit Save button.
- **Frontend Process:** `saveNotes()`; notes are also protected by an auto-save-to-draft mechanism (`initAutoSave`) that stores unsaved text in `localStorage` in case the app closes before saving.
- **Validation:** None.
- **Database Queries:** `PATCH` on the job's `notes` field.
- **Supabase:** Standard REST call.
- **Storage / Realtime:** Not used.
- **Other Apps:** Notes become visible in the Office app's job view on next load.
- **Notifications:** Brief confirmation (silent or toast, depending on trigger).
- **UI Update:** None visually beyond the save confirmation.
- **Logs:** None dedicated.
- **Completion:** Notes stored against the job.

#### B10 — Save Logged Hours
- **User Action:** Enters hours worked on a job.
- **Frontend Process:** `saveHours()`.
- **Validation:** Must be a valid number.
- **Database Queries:** `PATCH` on the job's `hours` field.
- **Supabase:** Standard REST call.
- **Storage / Realtime:** Not used.
- **Other Apps:** These logged hours directly feed the Office app's automatic invoice line-item calculation (A2.6) and payslip calculation (A7.3) — this is one of the more consequential small actions in the whole system.
- **Notifications:** Confirmation toast.
- **UI Update:** Hours field reflects saved value.
- **Logs:** None dedicated.
- **Completion:** Hours recorded, ready to be billed and paid against.

#### B11 — Quick Notes Picker
- **User Action:** Taps a "quick notes" button, picks from categorised pre-written phrases (e.g. common access issues, common completion notes), taps Apply.
- **Frontend Process:** `openQN()` shows a bottom sheet with tabs (`_renderQNTabs`) and a checklist (`_toggleQN`); `applyQN()` inserts the selected phrases into the notes box.
- **Validation:** None.
- **Database Queries:** None until the notes are actually saved (B9).
- **Supabase / Storage / Realtime:** Not used.
- **Other Apps:** Not applicable directly (feeds into B9).
- **Notifications:** None.
- **UI Update:** Notes box is populated with the chosen text.
- **Logs:** None.
- **Completion:** Faster note-writing without typing everything by hand.

#### B12 — Upload a Standard Photo or Document
- **User Action:** Taps "Add Photo/Doc," picks a file from the camera or gallery.
- **Frontend Process:** `handleUpload(input, type)` — for photos: reads EXIF data, compresses (unless HD mode is on), stamps a visible watermark; for other file types, skips those photo-specific steps.
- **Validation:** A job must be currently open; multiple files can be queued and are processed one at a time with a progress toast per file.
- **Database Queries:** `POST` to `attachments` after each successful upload.
- **Supabase:** A direct `POST` to the Storage API (`storage/v1/object/deepflow/...`) with the raw file bytes, followed by a Database API `POST` for the metadata row.
- **Storage:** Yes — this is a core Storage-writing feature.
- **Realtime:** Not used.
- **Other Apps:** The photo becomes visible in the Office app's job view (A2.14) and, if certificate-related, the Client Portal, as soon as they next load that job.
- **Notifications:** Per-file progress toast, then a summary success toast (e.g. "✅ 3 photos uploaded").
- **UI Update:** New photo(s) appear in the job's photo grid.
- **Logs:** None dedicated (the `attachments` row is the record).
- **Completion:** Evidence photo/document safely stored and linked to the job.

#### B13 — Upload a Before/After Photo Pair
- **User Action:** Taps a "+" on a specific Before or After slot for a numbered photo pair, takes/picks the photo.
- **Frontend Process:** `_triggerBAUpload()` / `_handleBAUpload()` — functionally the same EXIF/compress/watermark/upload pipeline as B12, but the resulting `attachments` row additionally stores which numbered slot (`photo_slot`) and which side (`photo_role`: before/after) this photo belongs to, so the Office app can display them as matched pairs.
- **Validation:** A slot/role must be selected (by tapping that specific "+") before the file picker opens.
- **Database Queries / Supabase / Storage:** Identical mechanics to B12.
- **Realtime:** Not used.
- **Other Apps:** Same visibility as B12, but displayed as a clear before/after comparison in the Office UI.
- **Notifications:** Per-photo progress and success toast, labelled with its slot/role (e.g. "Photo 2 — After uploaded").
- **UI Update:** That specific slot in the before/after grid now shows the new photo with a delete button.
- **Logs:** None dedicated.
- **Completion:** A specific, labelled before/after comparison photo is on file — commonly used as proof of work for compliance jobs.

#### B14 — Delete a Photo
- **User Action:** Taps the ✕ on a photo thumbnail (standard or before/after), confirms.
- **Frontend Process:** `_deleteBAPhoto()` (or the standard-photo equivalent).
- **Validation:** Confirmation prompt required.
- **Database Queries:** `DELETE` on the `attachments` row.
- **Supabase:** Database API `DELETE`, plus a `DELETE` call to the Storage API to remove the actual file.
- **Storage:** Yes.
- **Realtime:** Not used.
- **Other Apps:** Photo disappears from the Office app and Client Portal.
- **Notifications:** "Photo deleted" toast.
- **UI Update:** Thumbnail removed from the grid.
- **Logs:** None.
- **Completion:** File permanently removed.

#### B15 — Add a New Job (from the Engineer app)
- **User Action:** Taps the "+" floating button, fills in a short job form (address, description, etc.), submits.
- **Frontend Process:** `openAddJobModal()` / `submitAddJob()`.
- **Validation:** Address required at minimum.
- **Database Queries:** A job-numbering call, then `POST` to `jobs`.
- **Supabase:** Standard REST call.
- **Storage / Realtime:** Not used directly (though the insert is on the Realtime-enabled table, so it's pushed live to the Office app).
- **Other Apps:** Immediately visible in the Office app's job list (live, via Realtime).
- **Notifications:** Success toast.
- **UI Update:** New job appears in the engineer's own "Today"/"Upcoming" list.
- **Logs:** None dedicated.
- **Completion:** Engineers can log an ad-hoc job themselves (e.g. a job they were given verbally on-site) without needing to call the office.

#### B16 — Send an "On My Way" (OMW) Message
- **User Action:** Taps "On My Way" on a job, chooses to notify the client and/or the office, reviews the preview, sends.
- **Frontend Process:** `updateOmwPreview()` / `_getEtaTime()` composes a message with an estimated arrival time; `sendOmwClient()` / `sendOmwOffice()` open the corresponding WhatsApp link.
- **Validation:** A phone number must exist for whichever recipient is chosen.
- **Database Queries:** None (message content is built entirely from already-loaded job/settings data).
- **Supabase:** Not used — same `wa.me` deep-link pattern as the Office app's WhatsApp sends; no real API call.
- **Storage / Realtime:** Not used.
- **Other Apps:** Leaves the DeepFlow system, handled by WhatsApp directly.
- **Notifications:** None beyond WhatsApp opening.
- **UI Update:** WhatsApp opens with the pre-filled message.
- **Logs:** None.
- **Completion:** Client/office informed the engineer is en route, message sent manually by the engineer inside WhatsApp.

#### B17 — Submit an Overtime Request
- **User Action:** Taps "Request Overtime," fills in date/hours/rate/job reference/notes, submits.
- **Frontend Process:** `openOvertimeForm()` / `submitOvertimeRequest()`.
- **Validation:** Hours/date expected.
- **Database Queries:** `POST` to `engineer_requests` with `type:'overtime'`, `status:'pending'`.
- **Supabase:** Standard REST call.
- **Storage / Realtime:** Not used.
- **Other Apps:** Appears in the Office app's Job Requests inbox (A8.3) for approval — this is a **request awaiting a decision**, unlike the Office-side direct overtime logging in A7.4 which is recorded immediately as fact.
- **Notifications:** Confirmation toast to the engineer; contributes to the Office notification bell once the office polls/loads the requests list.
- **UI Update:** Request appears in the engineer's own "past requests" list, marked Pending.
- **Logs:** The request row itself is the record.
- **Completion:** Request sent, awaiting office approval/rejection.

#### B18 — Submit a Leave Request
- Same pipeline as B17, but `openLeaveForm()` / `submitLeaveRequest()`, with `type:'leave'` and a leave-type/date-range instead of hours.

#### B19 — View Past Requests
- **User Action:** Opens the Requests tab.
- **Frontend Process:** `loadRequests()` fetches this engineer's own submitted requests and their current status/office reply.
- **Validation:** None (read-only).
- **Database Queries:** `GET` on `engineer_requests` filtered to this engineer's name.
- **Supabase / Storage / Realtime:** Standard reads only.
- **Other Apps:** Reflects whatever the Office has approved/rejected/replied to.
- **Notifications:** None.
- **UI Update:** List of past requests with status badges (Pending/Approved/Rejected) and any office reply text.
- **Logs:** None.
- **Completion:** Engineer can track the outcome of everything they've submitted.

#### B20 — Receive a Broadcast Alert
- **User Action:** None directly — happens automatically while the app is open.
- **Frontend Process:** `checkBroadcastAlerts()` polls every 15 seconds for new, unexpired, targeted-to-them-or-everyone alerts; `showBroadcastAlert()` displays the first unseen one as a full-screen popup.
- **Validation:** Filters out alerts already shown before (tracked in `localStorage`) and alerts not targeted at this engineer specifically (if a target other than "all" was set).
- **Database Queries:** `GET` on `engineer_alerts`.
- **Supabase / Storage:** Standard REST read; not used for Storage.
- **Realtime:** Not used — this is polling, confirmed not push-based.
- **Other Apps:** Originates from the Office app's Broadcast feature (A8.1).
- **Notifications:** Full-screen popup with icon/colour matched to severity, plus a phone vibration pattern.
- **UI Update:** Alert overlay appears until dismissed.
- **Logs:** The dismissed alert's ID is remembered locally so it won't show again.
- **Completion:** Engineer has seen and acknowledged the office's message.

#### B21 — New Job Push Notification
- **User Action:** Grants notification permission when first prompted (a one-time setup step); afterwards, purely automatic.
- **Frontend Process:** `_initPush()` requests browser Notification permission; on every 30-second job refresh, `_checkForNewJobs()` compares the current job ID list against the previous one and fires a native browser notification for any job that's new.
- **Validation:** Requires the browser Notification permission to have been granted.
- **Database Queries:** Uses the results already fetched by the normal job-list poll (B4) — no separate query.
- **Supabase / Storage / Realtime:** Not used directly.
- **Other Apps:** Triggered by a job being newly assigned in the Office app.
- **Notifications:** A native OS-level browser notification, which opens the job detail if tapped.
- **UI Update:** None beyond the notification itself.
- **Logs:** None.
- **Completion:** Engineer is alerted to a new job even if they're not actively looking at the app.

#### B22 — Background GPS Location Tracking
- **User Action:** None directly — starts automatically as soon as the engineer is logged in, for as long as the app is open (and the browser/device allows background location).
- **Frontend Process:** `_startLocationSilent()` starts the browser's Geolocation "watch" mode; `_onGPS()` fires every time the position changes meaningfully.
- **Validation:** Only runs if the browser has been granted location permission.
- **Database Queries:** A `PATCH` on this engineer's own `users` row, updating `last_lat`, `last_lng`, `last_seen`, `last_accuracy`.
- **Supabase:** Standard REST call, repeated on every position update.
- **Storage:** Not used.
- **Realtime:** Not used on this table for pushing — the Office app's Live Maps screen reads this data as a normal, on-demand query (A7.1), not a live stream.
- **Other Apps:** This is the **sole source** of the location data the Office app's Live Maps feature displays.
- **Notifications:** None (this runs silently, with no user-facing indication beyond the browser's own "this site knows your location" icon).
- **UI Update:** None in the Engineer app itself.
- **Logs:** None (only the current position is kept — there's no location history table).
- **Completion:** Never "completes" while logged in — it continuously updates until logout (B2), which also explicitly clears the stored position.

#### B23 — View the In-App Map
- **User Action:** Opens the Map tab, picks a view mode (e.g. today's jobs, or route).
- **Frontend Process:** `setMapView()` loads the Leaflet.js mapping library (only at this point, not on every app load) and plots pins.
- **Validation:** None.
- **Database Queries:** Uses already-loaded job data; may call `geocodeAddress()` for any address not yet geocoded, and `_getRoute()` for a route line between stops.
- **Supabase:** Not used for the map itself — `geocodeAddress`/`fetchWeather`/`fetchLandRegistry` call **external, non-Supabase, public web services** to look up coordinates, weather, and UK Land Registry property data.
- **Storage / Realtime:** Not used.
- **Other Apps:** Not applicable — this is the engineer's personal working map, separate from the Office's Live Maps feature.
- **Notifications:** None.
- **UI Update:** Interactive map renders with markers.
- **Logs:** None (geocoding results are cached locally to avoid repeat lookups).
- **Completion:** Engineer can visually plan their day's route.

#### B24 — Volt Drop Calculator
- **User Action:** Opens the built-in electrician tools, enters cable length, current, voltage, cable size.
- **Frontend Process:** `calcVD()` performs the calculation using standard electrical formulas, entirely offline, in JavaScript.
- **Validation:** Inputs must be valid numbers.
- **Database Queries / Supabase / Storage / Realtime / Other Apps:** None — this is a pure, self-contained calculator with no connection to the database at all.
- **Notifications:** None.
- **UI Update:** Result displayed instantly on screen.
- **Logs:** None.
- **Completion:** A quick on-site reference calculation, not saved anywhere.

#### B25 — Earth Fault Loop Impedance (Zs) Calculator
- Same pattern as B24 (`calcZs()`) — a standalone, offline electrical calculation tool with no database interaction.

#### B26 — Conduit Fill Calculator
- **User Action:** Adds wires of different sizes (`addWire()`), sees a live visual diagram of how full the conduit is (`renderConduit()`), can clear and start again.
- Same pattern as B24/B25 — a purely local, offline visual calculator tool with no database interaction whatsoever.

#### B27 — Dashboard (Engineer's own stats)
- **User Action:** Opens the Dashboard tab.
- **Frontend Process:** `loadDash()` shows a greeting, today/week job counts, recent completed jobs, and current weather (fetched using the engineer's GPS position, or London as a fallback).
- **Validation:** None (read-only).
- **Database Queries:** Uses already-loaded job data; a separate external weather-service call for the weather widget.
- **Supabase:** Standard reads for job data only.
- **Storage / Realtime:** Not used.
- **Other Apps:** Not applicable.
- **Notifications:** None.
- **UI Update:** Dashboard cards render.
- **Logs:** None.
- **Completion:** Engineer gets a quick personal overview when opening the app.

#### B28 — Toggle Light / Dark Theme
- Same pattern as A11.3 — a local, `localStorage`-only preference, independent of the other two apps.

#### B29 — Auto-Save Draft Notes
- **User Action:** None directly — happens automatically while typing in certain fields.
- **Frontend Process:** `initAutoSave()` periodically saves in-progress, not-yet-submitted text (like job notes) into `localStorage` as a safety net.
- **Validation:** None.
- **Database Queries:** None — this is purely local, protecting against the app closing or crashing before a real save happens.
- **Supabase / Storage / Realtime / Other Apps:** Not used.
- **Notifications:** None.
- **UI Update:** None visible.
- **Logs:** None.
- **Completion:** If the engineer navigates away and comes back, their unsaved text is still there.

---

# PART C — Client Portal (`client-portal.html`)

#### C1 — Open the Portal via a Personal Link
- **User Action:** Clicks a link previously sent by the office (e.g. `client-portal.html?id=<id>&type=landlord`).
- **Frontend Process:** `init()` reads `id` and `type` straight from the page's own web address (no login form is ever shown). If there's no ID at all in the link, a friendly "you need your personal link" screen is shown instead of an error.
- **Validation:** **None in the security sense** — there is no password, no code, nothing to prove the visitor is really that client. The only "check" is whether a record with that exact ID exists in the database.
- **Database Queries:** A `GET` on `app_settings` (to load company branding/settings for the header), then a `GET` on `persons` (landlord), `agencies`, or (for an agent) uses the name passed directly in the link, depending on `type`.
- **Supabase:** Standard REST reads, using the same public "anon" key embedded in every DeepFlow app.
- **Storage / Realtime:** Not used at this stage.
- **Other Apps:** This link was generated by the Office app (A8.4) — this is the one deliberate connection point between the two.
- **Notifications:** None.
- **UI Update:** If found, the full portal loads with that client's name and branding; if not found, an "invalid or expired link" message is shown (though links do not actually expire in the code — that wording is aspirational, not enforced).
- **Logs:** None — visits are not tracked or recorded anywhere.
- **Completion:** Client is looking at their personalised portal.

#### C2 — View Overview Tab
- **User Action:** Default tab shown on load, or tapped explicitly.
- **Frontend Process:** `vOverview()` shows a compliance score (calculated from certificate status), recent job activity, and quick stats.
- **Validation:** None (read-only).
- **Database Queries:** Uses data already loaded during C1 (jobs, certs, invoices, attachments, ratings all fetched together right after the client record is found).
- **Supabase / Storage / Realtime:** Standard reads only.
- **Other Apps:** Reflects whatever the Office has entered.
- **Notifications:** None.
- **UI Update:** Overview cards render.
- **Logs:** None.
- **Completion:** Client gets an at-a-glance summary.

#### C3 — View Jobs Tab
- **User Action:** Taps the Jobs tab.
- **Frontend Process:** `vJobs()` lists every job matched to this client (by name, as covered in the architecture document), each showing a status badge, mini compliance ring, and any linked certificates.
- **Validation:** None (read-only).
- **Database Queries:** Already-loaded data (from `fetchJobs()` during C1).
- **Supabase / Storage / Realtime:** Not used further.
- **Other Apps:** Not applicable.
- **Notifications:** None.
- **UI Update:** Job cards render.
- **Logs:** None.
- **Completion:** Client can see every job done at their property/properties.

#### C4 — View / Download / Share a Certificate
- **User Action:** Taps the Certificates tab; taps a certificate to preview it; taps Download or Share.
- **Frontend Process:** `vCerts()` / `certCard()` render the list, sortable (`sortCerts`) by expiry/type; `shareCert()` uses the device's native Share function if available, or opens a WhatsApp link with the certificate's file URL.
- **Validation:** None.
- **Database Queries:** Already-loaded `certs` and `attachments` data.
- **Supabase:** The certificate file itself is served directly from the Supabase Storage public URL.
- **Storage:** Yes — reading a file from the `deepflow` bucket.
- **Realtime:** Not used.
- **Other Apps:** The certificate file was originally created and uploaded via the Office/Engineer workflow (A4.1/B12).
- **Notifications:** None (or a native share sheet, which is an OS feature, not an in-app notification).
- **UI Update:** Certificate preview or download begins.
- **Logs:** None.
- **Completion:** Client has their compliance paperwork.

#### C5 — View / Preview / Download an Invoice PDF
- **User Action:** Taps the Invoices tab, taps an invoice to preview it, taps Download.
- **Frontend Process:** `vInvoices()` lists invoices with status badges; `previewInv()` shows the full invoice inline; `downloadInvPDF()` builds a PDF client-side (same jsPDF approach as the Office app, run independently here).
- **Validation:** None.
- **Database Queries:** Already-loaded `invoices` data (fetched by matching client name during C1).
- **Supabase / Storage / Realtime:** Not used for the PDF itself (built entirely in the browser).
- **Other Apps:** The invoice was created by the Office app (A2.6/A3.1, etc.).
- **Notifications:** None.
- **UI Update:** PDF preview modal, or a file download.
- **Logs:** None.
- **Completion:** Client has a copy of their invoice for their own records.

#### C6 — View Payment / Bank Details
- **User Action:** Taps the Payments tab.
- **Frontend Process:** `bankCard()` displays the company's bank details (from `app_settings`) with a "copy to clipboard" button (`copyToClipboard`) for each field, plus a summary of what's owed/paid.
- **Validation:** None.
- **Database Queries:** Already-loaded settings and invoice/payment data.
- **Supabase / Storage / Realtime:** Not used.
- **Other Apps:** Reflects payments recorded by the Office app (A3.5).
- **Notifications:** "Copied!" confirmation on copy.
- **UI Update:** Bank details card, outstanding balance summary.
- **Logs:** None.
- **Completion:** Client has what they need to pay by bank transfer.

#### C7 — View Documents Tab
- **User Action:** Taps the Documents tab.
- **Frontend Process:** `vDocs()` lists any non-photo attachments (PDFs, etc.) linked to this client's jobs.
- **Validation:** None.
- **Database Queries:** Already-loaded `attachments` data.
- **Supabase / Storage:** File URLs point at Supabase Storage.
- **Realtime:** Not used.
- **Other Apps:** These documents originate from Office/Engineer uploads.
- **Notifications:** None.
- **UI Update:** Document list with download links.
- **Logs:** None.
- **Completion:** Client can access any additional paperwork.

#### C8 — Submit a New Job Request
- **User Action:** Taps "Request a Job," fills in a short wizard (property address, service type, preferred date, access instructions, priority, notes, optionally attaches a file), taps Submit.
- **Frontend Process:** `vRequest()`/`renderWizard()` builds the form; `handleFiles()` stages any attached file names; `submitReq()` runs on submit.
- **Validation:** Address is required and must be a reasonably full address (a minimum length check); a service type must be selected; if a preferred date is chosen, it cannot be in the past.
- **Database Queries:** A `GET` on `engineer_requests` to work out the next sequential `CR-####` reference number (by scanning existing ones for the highest number used so far), then a `POST` to create the request, plus a second `POST` to the `activity` table logging the request text for the office feed.
- **Supabase:** Standard REST calls, using the same public key as every other read on this page (this is a genuinely public, unauthenticated write to the database).
- **Storage:** Not used — despite the form allowing a file to be attached, the file itself does not appear to actually be uploaded to Storage in this flow; only the count of attached files is mentioned in the request text.
- **Realtime:** Not used (`engineer_requests` is polled by the Office/Engineer apps, not pushed).
- **Other Apps:** Lands directly in the Office app's Job Requests inbox (A8.3).
- **Notifications:** A confirmation screen with the reference number, plus a "copy reference" button.
- **UI Update:** The request form is replaced by a success screen ("what happens next" steps).
- **Logs:** The `engineer_requests` row and the `activity` row together form the record.
- **Completion:** Client has a reference number to track their request; office has a new item to review and convert into a real job (A2.1).

#### C9 — View Past Requests
- **User Action:** Scrolls down within the Request tab, or taps a "past requests" section.
- **Frontend Process:** `loadPastRequests()` fetches this client's own previously submitted requests and their current status.
- **Validation:** None (read-only).
- **Database Queries:** `GET` on `engineer_requests` filtered to this client's name.
- **Supabase / Storage / Realtime:** Standard reads only.
- **Other Apps:** Reflects office approvals/replies.
- **Notifications:** None.
- **UI Update:** Expandable list (`toggleReqDetail`) of past requests with status.
- **Logs:** None.
- **Completion:** Client can check on the status of something they asked for previously.

#### C10 — Search Within the Portal
- **User Action:** Taps the search icon, types a query.
- **Frontend Process:** `openSearch()` / `performSearch()` searches across this client's own already-loaded jobs/invoices/certs.
- **Validation:** None.
- **Database Queries:** None new (client-side search over already-loaded data).
- **Supabase / Storage / Realtime:** Not used.
- **Other Apps:** Not applicable.
- **Notifications:** None.
- **UI Update:** Dropdown of matching results.
- **Logs:** None.
- **Completion:** Client quickly finds a specific job/invoice/certificate within their own history.

#### C11 — Export Data as CSV
- **User Action:** Taps "Export CSV" on the Invoices, Jobs, or Certificates tab.
- **Frontend Process:** `exportCSV(type)` builds a plain-text CSV file from already-loaded data and triggers a browser download.
- **Validation:** None.
- **Database Queries:** None new.
- **Supabase / Storage / Realtime:** Not used.
- **Other Apps:** Not applicable.
- **Notifications:** "CSV exported" toast.
- **UI Update:** File download triggered.
- **Logs:** None.
- **Completion:** Client has a spreadsheet-friendly copy of their data.

#### C12 — Toggle Light / Dark Theme
- Same local, independent, `localStorage`-only pattern as A11.3 and B28.

#### C13 — Pre-Fill a Certificate Renewal Request
- **User Action:** From an expiring/expired certificate card, taps "Request Renewal."
- **Frontend Process:** `preFillRenewal(c)` jumps to the Request tab (C8) with the service type and address fields already filled in based on that certificate's details.
- **Validation:** Same as C8 once the form is actually submitted.
- **Database Queries:** None extra at this step (only the read of the certificate already in memory).
- **Supabase / Storage / Realtime:** Not used at this step.
- **Other Apps:** Feeds directly into C8's submission flow.
- **Notifications:** None at this step.
- **UI Update:** Request form opens pre-filled.
- **Logs:** None at this step.
- **Completion:** Client only has to review and submit, rather than typing everything from scratch — reduces friction for the most common type of request (renewing a certificate about to expire).

---

*This document was produced by a full manual review of every relevant function in all four files. No code was modified while producing it. Where a stage genuinely does not apply to a feature, this is stated explicitly rather than omitted, so nothing has been silently skipped.*
