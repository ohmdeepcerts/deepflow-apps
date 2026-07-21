# 04 — Client Portal (`client-portal.html`)

## 1. Purpose

A self-service web page that lets a landlord, letting agency, or individual agent view their own jobs, compliance certificates, and invoices, and raise a new job request — without ever needing an account, a password, or any interaction with office staff to get started.

## 2. Target Users

External clients: landlords (`persons` records), agencies (`agencies` records), and individual agents (`agents` records). There is no internal-staff use of this page.

## 3. Navigation & Menu Structure

A sticky top header (company branding, a notification bell, search) and a horizontal tab bar: **Overview**, **Jobs**, **Certificates**, **Invoices**, **Payments**, **Documents**, **Request**. No sidebar, no bottom bar — a single-row tab layout suited to both desktop and mobile.

## 4. How a Client Gets Here (Identity Model)

There is no login screen. The page reads two values directly from its own URL — `id` (a database ID) and `type` (`landlord` / `agency` / `agent`) — and looks up the matching record. If the URL has no `id` at all, the page shows a branded "you need your personal link" screen instead of an error. If the ID doesn't match any real record, it shows a "Not Found — this link is invalid or has expired" message (the "expired" wording is not actually backed by any real expiry logic — see [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md) and [15_Security.md](15_Security.md)). This link is generated and shared by office staff from the Office App's Directory screens — see [10_Synchronization.md](10_Synchronization.md) Section 2 ("who starts each sync").

## 5. Pages, Screen by Screen

### 5.1 Overview
**Purpose:** an at-a-glance summary. **Components:** a compliance-score ring, recent activity, quick stats. **Tables read:** `jobs`, `certs`, `invoices` (all fetched once, on initial page load, and filtered to this client by name-matching — see [05_Database.md](05_Database.md) for the relationship model).

### 5.2 Jobs
**Purpose:** every job done at this client's property/properties. **Components:** job cards with status badges and a mini compliance ring per job; for an agency, an agent filter bar.

### 5.3 Certificates
**Purpose:** view, download, and share compliance certificates. **Components:** a sortable list/grid, a "Request Renewal" quick action on expiring/expired certificates that pre-fills the Request tab. **Storage:** certificate files are served directly from the Supabase Storage bucket's public URLs — see [09_Storage.md](09_Storage.md).

### 5.4 Invoices
**Purpose:** view and download invoices. **Components:** an invoice list, a full preview panel, a client-side-generated PDF download (built fresh in the browser with jsPDF, independent of and using different code from the Office App's own PDF generator), a CSV export.

### 5.5 Payments
**Purpose:** show the company's bank details and this client's current balance. **Components:** a bank-details card with per-field "copy to clipboard" buttons, an outstanding-balance summary.

### 5.6 Documents
**Purpose:** any non-photo attachments (e.g. PDFs) linked to this client's jobs.

### 5.7 Request
**Purpose:** raise a new job request. **Components:** a form (property address, service type, preferred date, access notes, priority, free-text notes, an optional file attachment field), a past-requests list. **Tables written:** `engineer_requests` (`type: 'portal_request'`), `activity`. **Business logic:** the `CR-####` reference-number generation, and the exact validation rules (address ≥ 5 characters, a service type required, no past dates) — [13_Business_Rules.md](13_Business_Rules.md) Sections 8.3–8.4. **Important, live-confirmed issue:** direct testing of the live database (documented in [15_Security.md](15_Security.md), Section 3.2) found that anonymous `INSERT` into `engineer_requests` is currently **rejected** by the database — meaning this specific feature is very likely failing for real clients right now, independent of anything in the application code itself. This should be verified against the live app and treated as a priority fix, separate from any security hardening.

## 6. Cross-Cutting Behaviour

### 6.1 Loading, Empty, Success, and Error States
Skeleton loaders on initial load; the branded "invalid link" and "no personal link" full-page states described in Section 4; a toast-style confirmation after submitting a request (which also shows the generated reference number prominently, with a copy button); a "Not Found" empty state per section if a client genuinely has no jobs/certs/invoices yet.

### 6.2 Forms & Validation
The Request form is the only place this app writes data, and it's the most carefully validated form across all three apps for genuinely good reason — it's the one point where the public, unauthenticated app accepts input. Full detail: [13_Business_Rules.md](13_Business_Rules.md) Section 8.4.

### 6.3 Dependencies
- **Third-party libraries:** jsPDF + jsPDF-AutoTable (its own independent invoice-PDF generator), Lucide icon library (loaded in full, on every page load), Google Fonts ("Inter").
- **Connected APIs:** Supabase REST only — no Auth (there is no login), no Realtime, no Storage *writes* (reads only).
- **Connected database tables:** `app_settings` (branding), `persons`/`agencies`/`agents` (identity), `jobs`, `certs`, `invoices`, `attachments`, `ratings` (this last one is confirmed **not to exist** in the live database — the ratings feature silently shows nothing; see [05_Database.md](05_Database.md) and [18_Known_Issues.md](18_Known_Issues.md)), `engineer_requests`, `activity` (writes).
- **Connected applications:** receives its identity from a link generated by the Office App; writes requests that the Office App's Job Requests inbox reads. No connection of any kind to the Employee App.

### 6.4 Permissions & Role Restrictions
None — there is no role system in this app. Access control is entirely "do you have the link," discussed at length (as a security finding, not just an architectural note) in [15_Security.md](15_Security.md).

### 6.5 Responsive Behaviour & Accessibility
Built with a modern, card-based, mobile-friendly layout (the tab bar collapses to icon-only on narrow viewports) — of the three apps, this one shows the most evident attention to cross-device presentation, consistent with it being the one app external, non-technical people will use, often on a phone. 🔴 No explicit accessibility (`aria-*`) attributes were confirmed in the markup reviewed, same caveat as the other two apps.

### 6.6 Performance Considerations
Everything loads once, in parallel, on page entry — there's no ongoing performance concern from repeated polling (this app doesn't poll at all), but see [10_Synchronization.md](10_Synchronization.md) for the corresponding downside: nothing here ever updates without a manual page reload.

## 7. Known Issues Specific to This App

(Full list: [18_Known_Issues.md](18_Known_Issues.md).) No authentication of any kind (Section 4); the `ratings` feature reads a table that doesn't exist in the live database, so it never shows anything; the Request form's write path is currently blocked by database policy (Section 5.7) and needs to be checked against the live app as a functional priority.

## 8. Future Improvements

App-specific highlights from [19_Future_Roadmap.md](19_Future_Roadmap.md): add a lightweight identity-verification step appropriate to the sensitivity of what's shown (Sections 4, and [15_Security.md](15_Security.md) Recommendation 7); fix or remove the `ratings` feature; resolve the Request-form write-permission issue; consider a "your data may be out of date, refresh to check" indicator given this app never auto-updates.
