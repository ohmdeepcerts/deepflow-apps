# 03 — Employee (Engineer) App (`engineer.html`)

## 1. Purpose

A mobile-first Progressive Web App (installable to a phone's home screen, works full-screen, no app-store distribution) for field engineers to manage their own workday: see assigned jobs, update status, log hours, capture photo evidence, and communicate with the office — without needing any part of the Office App's much larger interface.

## 2. Target Users

Field engineers only. Login is refused to anyone whose `users` profile role isn't exactly `engineer`, or whose account isn't marked active. Full detail: [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md).

## 3. Navigation & Menu Structure

A bottom tab bar (mobile app convention) with five destinations: **Today**, **Upcoming**, **Done**, **Map**, **More** (which itself contains the Dashboard, Requests, electrical calculators, Guide, and account/theme controls). A floating "+" action button opens the Add-Job form. A top bar shows the engineer's name, today's date, a manual refresh button, and a "still connected to the office?" indicator.

## 4. Pages, Screen by Screen

### 4.1 Today
**Purpose:** the day's actual workload. **Components:** job cards (colour-coded by status/priority), a sort toggle (time vs. nearest-first, using GPS), pull-to-refresh, a badge showing how many of today's jobs are still incomplete. **Tables read:** `jobs` (filtered to `date = today AND engineer ILIKE <name>`). **Business logic:** [13_Business_Rules.md](13_Business_Rules.md) Section 3.

### 4.2 Upcoming
**Purpose:** the next 30 days, grouped by date. **Components:** date-grouped job cards. **Tables read:** `jobs` (`date > today AND date <= today+30`).

### 4.3 Done
**Purpose:** job history — the last 60 completed/cannot-access/cancelled jobs. **Components:** a flat, most-recent-first list.

### 4.4 Job Detail (opened from any list, a bottom-sheet modal, not a separate tab)
**Purpose:** everything about one job. **Components:** a status-pill selector (Pending/In Progress/Completed/Cannot Access/Emergency — tapping one is an immediate save, no separate confirm step), contact/access-instruction display (subject to what the engineer is permitted to see — though see the caveat in Section 6 below), quick-action buttons (call, WhatsApp, map, Waze, email, an "On My Way" composer), a notes box with autosave-to-draft, an hours field, a photo section (standard grid or before/after paired mode), a quick-notes picker (pre-written phrase library). **Tables read/written:** `jobs`, `attachments`. **Storage:** this is the app's one Storage-writing surface — see [09_Storage.md](09_Storage.md). **Business logic:** [13_Business_Rules.md](13_Business_Rules.md) Sections 3, 12.

### 4.5 Add Job
**Purpose:** let an engineer log an ad-hoc job themselves (e.g. one given verbally on-site). **Components:** a short form (address, description, etc.). **Tables written:** `jobs`. **Note:** jobs created here get a different ID format than Office-created jobs (`job-eng-<timestamp>-<random>` vs. a random UUID) — confirmed by inspecting real Storage folder names; see [05_Database.md](05_Database.md).

### 4.6 Map
**Purpose:** a personal working map of the day's jobs (distinct from, and not the same feature as, the Office App's Live Maps screen). **Components:** a toolbar (view mode switcher), an embedded Leaflet.js map (loaded only when this tab is opened, not on app startup), a legend. **External APIs used (all free, keyless):** postcodes.io and Nominatim/OpenStreetMap for geocoding, Open-Meteo for weather, UK Land Registry open data for price-paid lookups. Full detail: [11_APIs.md](11_APIs.md).

### 4.7 Dashboard (under "More")
**Purpose:** a personal at-a-glance summary. **Components:** a greeting, today/week job-count stats, recent completed jobs, a weather widget.

### 4.8 Requests (under "More")
**Purpose:** submit and track overtime/leave requests. **Components:** an Overtime request form, a Leave request form, a past-requests list with status badges. **Tables written:** `engineer_requests` (`type: 'overtime'` or `'leave'`, `status: 'pending'`). **Connected apps:** lands in the Office App's Job Requests inbox — see [10_Synchronization.md](10_Synchronization.md).

### 4.9 Electrical Calculators (under "More")
Three self-contained, offline, no-database-interaction reference tools: **Volt Drop**, **Earth Fault Loop Impedance (Zs)**, and **Conduit Fill** (with a live visual fill diagram). These exist purely as an on-site convenience for engineers and touch no part of the DeepFlow data model.

### 4.10 Guide (under "More")
**Purpose:** an in-app help/how-to-use reference, rendered from a hardcoded content list in the JavaScript — not fetched from anywhere.

## 5. Cross-Cutting Behaviour

### 5.1 Loading, Empty, Success, and Error States
Same toast-notification pattern as the Office App (see [02_Office_App.md](02_Office_App.md) Section 5.2), plus: a pull-to-refresh visual indicator, a spinning refresh icon during manual refresh, a full-screen broadcast-alert overlay (with a phone vibration pattern) for incoming office alerts, and native browser push notifications for new jobs (only while the app tab is open — there is no background/service-worker push).

### 5.2 Forms & Validation
The Add Job form requires an address at minimum; photo upload requires a job to be currently open; everything else follows the same "light validation, trust the user" pattern as the Office App. Full detail: [13_Business_Rules.md](13_Business_Rules.md) Section 14.

### 5.3 Dependencies
- **Third-party libraries:** `@supabase/supabase-js` v2 (Auth only — this app has no Realtime subscription at all), Leaflet.js 1.9.4 (loaded on demand for the Map tab only), Google Fonts ("DM Sans," "JetBrains Mono," "Orbitron").
- **Connected APIs:** Supabase REST, Supabase Auth, Supabase Storage, plus the three free public geodata/weather APIs listed in Section 4.6.
- **Connected database tables:** `jobs`, `users` (own profile + GPS write), `attachments`, `engineer_requests`, `engineer_alerts`. A **second, separate, essentially unused** `settings` table is also queried here — this is a confirmed bug, not a real dependency; see Section 6.
- **Connected Storage:** the only app that uploads to the `deepflow` bucket.
- **Connected applications:** no direct connection to the Office App or Client Portal — everything flows through the shared database, per [10_Synchronization.md](10_Synchronization.md).

### 5.4 Permissions & Role Restrictions
There is only one effective role in this app (`engineer`) — no further internal permission tiers exist. The Office App's per-engineer field-visibility configuration (`engPerms`) is **not enforced here at all** — a confirmed, live bug (Section 6).

### 5.5 Responsive Behaviour & Accessibility
Built mobile-first by design (bottom tab bar, large touch targets, safe-area padding for notched devices, haptic vibration feedback on key actions) — the opposite emphasis from the Office App. 🔴 No explicit accessibility (`aria-*`, screen-reader) attributes were confirmed in the markup reviewed.

### 5.6 Performance Considerations
Photo capture does real, on-device work (EXIF parsing, canvas-based compression and watermarking) before every upload — on an older or lower-powered phone, this is where any noticeable delay in the upload flow would actually come from. Full detail: [PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) Section 9.

## 6. Known Issues Specific to This App

(Full list: [18_Known_Issues.md](18_Known_Issues.md).) The two most important, both confirmed by direct testing/inspection: **(1)** this app looks up the office's WhatsApp contact number from a table literally named `settings`, which is always empty — the real configuration lives in `app_settings`, which this app never queries, so the "message the office" button always uses a hardcoded placeholder number instead of the real one. **(2)** the per-engineer field-visibility permissions configured in the Office App's Settings screen have zero effect here — this app contains no code that reads that configuration at all.

## 7. Future Improvements

App-specific highlights from [19_Future_Roadmap.md](19_Future_Roadmap.md): fix the `settings`/`app_settings` table mismatch (a one-line, high-value fix), actually enforce the per-engineer permission flags (or remove the illusion of the setting from the Office App if it will never be honoured here), and consider whether this app should also receive Realtime updates for its own job list rather than relying solely on the 30-second poll.
