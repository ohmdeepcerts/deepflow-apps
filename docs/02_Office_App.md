# 02 — Office App (`index.html`)

## 1. Purpose

The Office App is the operational and financial control centre of DeepFlow. It is where every job is scheduled, every certificate and invoice is tracked, every client relationship is managed, and every report is generated. It is the only one of the three apps with a full administrative surface (user management, company settings, database tooling).

## 2. Target Users

Office-based staff, in five roles: **Admin** (full access), **Manager** (everything except user management and the most sensitive admin tools), **Finance** (money-focused: invoices, statements, reports — jobs are read-only), **Staff** (day-to-day operational access, no Settings), and **Viewer** (intended as read-only, but currently broken — see Section 10 and [18_Known_Issues.md](18_Known_Issues.md)). Full permission matrix: [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md).

## 3. Navigation & Menu Structure

A fixed left sidebar, grouped into sections, each item toggling a "page" `<div>` (no URL routing — this is one HTML document with many hidden/shown sections):

- **Workspace:** Dashboard, Jobs
- **Finance:** Invoices, Statements, Job Requests, P&L Dashboard (opens as a full-screen overlay, not a sidebar page)
- **Records:** Directories (Persons/Agencies/Agents sub-tabs), Properties, Certificates, Client View
- **Maps & Tracking:** Live Maps
- **Workforce:** Engineer Reports (Admin-only), Audit Log (Admin-only)
- A settings gear (not in the main list) opens **Settings**, itself a further ten-tab sub-navigation.

Which of these a given user sees at all is entirely role-driven — full detail in [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md).

## 4. Pages, Screen by Screen

For every page: purpose, its main components, the forms/modals it opens, the business logic it runs, and which database tables it touches. (Database table names use their lowercase, live-database spelling — see [05_Database.md](05_Database.md) for the full column-level reference.)

### 4.1 Dashboard
**Purpose:** the daily "what needs my attention" landing screen. **Components:** five KPI tiles (today's jobs, this-week earnings, awaiting-payment total, expiring certificates, a fifth financial tile), a 7-day revenue bar chart, a "pending today" job list panel, an "expiring certificates" panel, an "outstanding invoices" panel, a smart banner (offers to bulk-create invoices for completed-but-unbilled jobs). **Tables read:** `jobs`, `invoices`, `certs`. **Business logic:** every figure is computed client-side from data already loaded/cached — see [13_Business_Rules.md](13_Business_Rules.md) Sections 4–5 for the exact thresholds (e.g. "expiring soon" = within 30 days by default).

### 4.2 Jobs
**Purpose:** the core day-to-day scheduling screen. **Components:** a date navigator, a search box (debounced, 200ms), engineer/status/priority filter chips, a dense custom-column data table (columns are user-configurable via a "Columns" manager), a mini calendar pane, an "unassigned jobs" toggle, a kanban board alternate view, a bulk-selection action bar, and a comments slide-down panel per row. **Forms/Modals:** the Job modal (a 3-column form: job details / landlord+agency+agent details / certificate & extra info), a key-safe-code modal, a WhatsApp-send modal. **Tables read/written:** `jobs`, `persons`, `agencies`, `agents`, `job_comments`, `attachments` (view only). **Business logic:** job creation/editing, status transitions (no restrictions — any status can follow any other), the automatic certificate+invoice chain on completion, duplicate-phone detection while typing, fuzzy address autocomplete. Full workflow detail: [12_Workflows.md](12_Workflows.md) Section A2.

### 4.3 Invoices
**Purpose:** create, review, send, and track every billing document (invoices, proformas, disposable invoices, credit notes — all one underlying data type, see [05_Database.md](05_Database.md)). **Components:** a left sidebar of saved views/filters, KPI cards (draft/awaiting/paid/overdue totals), a two-column layout (invoice list cards on the left, detail/preview on the right), a Kanban-style alternate invoice-status view, an aging-buckets report (0–30/31–60/61–90/90+ days overdue), a Credit Notes admin sub-view. **Forms/Modals:** the Invoice modal, Proforma modal, Disposable Invoice modal, Credit Note modal, Payment-recording modal, Send-invoice (WhatsApp/email) modal. **Tables read/written:** `invoices`, `payments`, `jobs` (for sync-back), `persons`/`agencies` (for client lookups). **Business logic:** the full numbering/VAT/line-item/status/sync-back rule set — [13_Business_Rules.md](13_Business_Rules.md) Section 5.

### 4.4 Statements
**Purpose:** build a running account statement (invoices + payments over a date range) for one client, for printing/sending. **Components:** client picker, date-range quick filters, a selectable transaction table with a running balance. **Tables read:** `invoices`, `payments`.

### 4.5 Job Requests
**Purpose:** the shared inbox for two different incoming request types — engineer overtime/leave requests, and client-submitted job requests from the Client Portal — told apart by a `type` field. **Components:** a filterable list, status badges (pending/approved/rejected), an approve/reject action with a reply-note field. **Tables read/written:** `engineer_requests`. **Connected apps:** this is one of the two deliberate cross-app data bridges — see [10_Synchronization.md](10_Synchronization.md).

### 4.6 P&L Dashboard (overlay, not a sidebar page)
**Purpose:** financial reporting. **Components:** a period selector, six tabs (Overview, Cash Flow, Top Clients, Job Types, VAT, Reminders), KPI tiles, bar charts, ranked lists. **Tables read:** `jobs`, `invoices`, `expenses`, `payments`. **Business logic and known limitations:** wage costs are a flat rate per job (not actual hours), and the VAT tab only totals output VAT — see [13_Business_Rules.md](13_Business_Rules.md) Section 10 and [18_Known_Issues.md](18_Known_Issues.md).

### 4.7 Directories (Persons / Agencies / Agents)
**Purpose:** the client/contact database. **Components:** three sub-tabs, card-grid layouts, a search/filter toolbar, bulk-selection checkboxes, a Merge modal (side-by-side field-by-field comparison). **Tables read/written:** `persons`, `agencies`, `agents`. **Business logic:** duplicate-phone detection (600ms debounce, 7-digit minimum), "most complete field wins" merge defaults, client star-rating calculation — [13_Business_Rules.md](13_Business_Rules.md) Section 6.

### 4.8 Properties
**Purpose:** a register of managed properties. **Components:** a card grid, add/edit form. **Important:** this is **not backed by a real database table** — the entire list lives inside the single settings JSON blob (`app_settings`). See [05_Database.md](05_Database.md) Section on `app_settings`.

### 4.9 Certificates
**Purpose:** compliance certificate tracking. **Components:** a dashboard sub-view (KPI tiles, type-compliance bars), a filterable/sortable table sub-view, an add/edit form, a reminders sub-view (bulk WhatsApp reminder composer), a statistics sub-view. **Tables read/written:** `certs`. **Business logic:** the full certificate-type/validity/reminder table — [13_Business_Rules.md](13_Business_Rules.md) Section 4.

### 4.10 Client View (360°)
**Purpose:** a single combined profile for one client — every job, invoice, and certificate they've ever had, plus their star rating. **Components:** a search picker, a hero card, KPI tiles, tabbed job/invoice/certificate/agent panels. **Tables read:** `jobs`, `invoices`, `certs`, `payments`, `agents` (all fetched fully, then filtered client-side to the one client — a performance note, see [PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md)).

### 4.11 Live Maps
**Purpose:** show which engineers are currently "live" (seen within the last hour) and roughly where. **Components:** a map image (or list fallback), a legend. **Tables read:** `users` (`last_lat`/`last_lng`/`last_seen` columns, written exclusively by the Employee App). **Not real-time** — this is a snapshot, refreshed only when the screen is opened or the general poll cycle runs.

### 4.12 Engineer Reports (Admin-only)
**Purpose:** per-engineer performance analytics and payslips. **Components:** a leaderboard/ranking table, per-engineer deep-report overlay (stats cards, a 6-month earnings bar chart, tabbed jobs/certs/earnings/trend/activity views), a payslip generator (opens a print-ready window, not a PDF download). **Tables read:** `jobs`, `invoices`, `certs`, `expenses`, `overtime`.

### 4.13 Audit Log (Admin-only)
**Purpose:** a strict, narrow trail of exactly two sensitive action types: job deletions and invoice-amount changes. **Components:** a filterable table (by staff member, by action type). **Table:** `audit_log`. Not to be confused with the much broader, general-purpose `activity` feed used elsewhere in the app.

### 4.14 Settings (ten sub-tabs, visibility varies by role — see [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md))
Company details; Appearance (theme); Team (Supabase-Auth-account-to-DeepFlow-profile linking, role assignment); Trades & certificate types; Invoicing rules (VAT, numbering, PDF content toggles); WhatsApp message templates; Job-related config; Notifications; Data (JSON backup export/import, admin-only Storage usage dashboard, "clear all data" tool); Guide & SQL (a library of copy-paste setup/fix SQL snippets and a few self-service admin buttons — full detail in [07_SQL_Migrations.md](07_SQL_Migrations.md)).

## 5. Cross-Cutting Behaviour (applies across every page above)

### 5.1 Forms & Validation
Validation is deliberately light throughout — most forms have no hard required-field enforcement, favouring "save now, fill in details later" over blocking staff. The exceptions are documented precisely in [13_Business_Rules.md](13_Business_Rules.md) Section 14. All validation is client-side JavaScript; nothing is re-checked by the server.

### 5.2 Loading, Empty, Success, and Error States
- **Loading:** skeleton-loader placeholder blocks (`.skeleton` CSS class) on most data-heavy screens while the initial fetch is in flight; simple "Loading…" text on smaller panels.
- **Empty states:** a consistent pattern of a large icon, a bold title, and a one-line explanation (e.g. "🎉 No jobs today").
- **Success:** toast notifications (bottom-right, colour-coded, auto-dismissing), plus a "✓ Synced" flash on the top-bar sync badge after every successful save.
- **Error/failure:** toast notifications (longer-lived, red-bordered), an "Offline" state on the sync badge when the browser has no connection, and a `beforeunload` browser warning if the user tries to close the tab while a save is still in flight. Full detail: [10_Synchronization.md](10_Synchronization.md) Section 7.

### 5.3 Dependencies
- **Third-party libraries:** `@supabase/supabase-js` v2 (Auth + Realtime only — not used for normal data reads/writes, which use a hand-written `fetch()` wrapper), jsPDF + jsPDF-AutoTable (PDF generation), Google Fonts ("Familjen Grotesk," "JetBrains Mono").
- **Connected APIs:** Supabase REST (PostgREST), Supabase Auth, Supabase Storage, Supabase Realtime. Full detail: [11_APIs.md](11_APIs.md).
- **Connected database tables:** effectively all of them — `jobs`, `users`, `persons`, `agencies`, `agents`, `invoices`, `certs`, `payments`, `expenses`, `overtime`, `job_comments`, `activity`, `attachments`, `engineer_requests`, `engineer_alerts`, `audit_log`, `cert_reminder_log`, `app_settings`. Full column-level reference: [05_Database.md](05_Database.md).
- **Connected Storage:** reads and deletes files in the `deepflow` bucket; never uploads.
- **Connected applications:** shares the database with the Employee App and Client Portal (no direct connection to either); generates the personal links that give the Client Portal its identity.

### 5.4 Permissions & Role Restrictions
Full detail in [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md). In brief: every page and every Settings tab is individually shown/hidden per role; Finance's Jobs page is rendered read-only; a per-user set of "can see this field" flags (landlord name, landlord phone, agent, contact, price) further restricts what a Staff-role user sees on the Jobs and Directory screens even when the page itself is visible to them.

### 5.5 Responsive Behaviour & Accessibility
🟡 The Office App is built and evidently intended as a **desktop-first, wide-screen application** — the sidebar-plus-main-content layout, dense multi-column job table, and 3-column job modal do not have confirmed mobile-optimised breakpoints in the CSS reviewed. No `aria-*` attributes, semantic landmark roles, or a documented keyboard-navigation model beyond the Command Palette's arrow-key support were found in the markup reviewed — accessibility was not evidently a design priority for this app. This is flagged as a genuine gap in [18_Known_Issues.md](18_Known_Issues.md) and [19_Future_Roadmap.md](19_Future_Roadmap.md).

### 5.6 Performance Considerations
Full detail in [PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md). The two most consequential findings for this app specifically: the Command Palette re-fetches five entire tables on every keystroke with no debounce, and most screens (P&L, Client View, Engineer Reports) load full tables and filter client-side rather than asking the database to filter — both currently invisible at the project's small live data scale, both worth fixing before the business's data grows meaningfully.

## 6. Admin-Specific Workflows

Distinct from normal staff workflows: Team management (linking a Supabase Auth account to a DeepFlow role — [12_Workflows.md](12_Workflows.md) A9.2), the Guide & SQL database-admin tools ([07_SQL_Migrations.md](07_SQL_Migrations.md)), full JSON backup export/import, the "Clear All Data" destructive tool, and the Audit Log — all gated to Admin only, most with no Manager fallback even though Managers can otherwise see most of Settings.

## 7. Future Improvements

Consolidated in [19_Future_Roadmap.md](19_Future_Roadmap.md); the app-specific highlights: fix the broken `Viewer` role, enforce (or remove) the per-engineer visibility permission toggles, add a debounce to the Command Palette, introduce a shared data cache instead of the current one-cache-for-jobs-only pattern, and give this app genuine mobile/accessibility support if office staff are ever expected to use it away from a desktop.
