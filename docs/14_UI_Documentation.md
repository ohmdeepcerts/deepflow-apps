# 14 — UI Documentation

A component-level reference across all three applications. Per-screen feature descriptions live in [02_Office_App.md](02_Office_App.md)–[04_Client_Portal.md](04_Client_Portal.md); this document catalogues the actual reusable visual components each app is built from, and how they behave.

## 1. Shared UI Conventions (patterns common to all three apps, independently reimplemented in each — see [01_System_Architecture.md](01_System_Architecture.md) Section 3 for why they're not literally shared code)

| Component | Purpose | Behaviour |
|---|---|---|
| **Toast notifications** | Success/error/info/warning feedback | Bottom-corner, colour-coded by type, auto-dismissing, stacking if multiple fire in quick succession |
| **Modal / overlay dialogs** | Forms, confirmations, detail views | A semi-transparent backdrop plus a centred (desktop) or bottom-sheet (mobile, Employee App) panel; closed by an explicit close button, clicking the backdrop, or (Office App) Escape |
| **Skeleton loaders** | Loading state placeholders | Animated grey blocks shaped like the content about to appear, shown while the initial data fetch is in flight |
| **Empty states** | "There's nothing here yet" | A large icon, a bold one-line title, and a short explanatory sentence — used consistently across every list/table in every app |
| **Badges / status pills** | Compact status indicators | Colour-coded, rounded-pill labels (e.g. job status, invoice status, certificate expiry state) |
| **Theme toggle** | Light/dark mode | A single button switching a CSS class on `<body>`/`<html>`; preference saved to `localStorage`, independently per app (no shared preference between apps) |

## 2. Office App (`index.html`) — Component Inventory

| Component class(es) | Where used | Notes |
|---|---|---|
| `.kpi`, `.kpi-tile` | Dashboard, Invoices, P&L | Large-number summary cards with an icon, a value, a label, and (Dashboard) a small progress bar |
| `.jtable` | Jobs screen | The dense, custom-column data table — column widths are user-resizable and user-configurable via a "Columns" manager panel (`.col-mgr-panel`) |
| `.kanban-col`, `.kanban-card` | Jobs and Invoices (alternate views) | Drag-and-drop status columns |
| `.dir-card-v2`, `.agency-card`, `.agent-card` | Directories | Card-grid layout with avatar-initials, contact details, and quick-action buttons per card |
| `.inv-card` | Invoices | List-item cards with an accent colour bar, status pill, and quick actions (mark sent/paid) |
| `.cert-card`, `.ctbl` (certificate table), `.cdash-*` (certificate dashboard) | Certificates | Three different presentations of the same underlying data (dashboard tiles, sortable table, card list) |
| `.modal`, `.mo-box`, `.overlay` | Every form in the app | ~25 separate named modals (job, person, agency, agent, invoice, cert, cert-expiry, gas, confirm, key-safe, WhatsApp, invoice-send, audit, property-certs, overtime, payment, property, engineer-directory, credit note, proforma, disposable invoice, expense, quick-engineer, broadcast) |
| `.cmd-overlay`, `.cmd-item` | Command Palette | A keyboard-navigable global search/action launcher — see the debounce issue noted in [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) |
| `.eng-kpi-card`, `.eng-deep-*`, `.eng-chart-*` | Engineer Reports | Stat cards plus a hand-drawn CSS bar chart (no charting library is used anywhere in this project — every chart is built from styled `<div>` bars) |
| `.pl-kpi`, `.pl-chart-bar`, `.pl-tab` | P&L Dashboard | Same hand-drawn-bar-chart pattern |
| `#ctx-menu`, `.ctx-item` | Right-click context menus | A custom-built context menu (not the browser's native one) on job rows |
| `.dup-popup`, `.merge-modal` | Directory duplicate detection & merge | A field-by-field comparison UI, unique to the merge feature |
| `.notif-panel`, `#notif-bell-wrap` | Top bar | The in-app notification dropdown (Section 1 of [../AUDIT.md](../AUDIT.md) covers what feeds it) |

**Forms:** every create/edit screen in the app is a modal form, not a separate page — there are roughly 25 distinct modal forms in this single file. **Filters:** date-range chips, engineer/status/priority dropdowns (Jobs), a saved-views sidebar (Invoices), type/status filters (Certificates). **Charts:** all hand-drawn CSS bar charts and a compliance "ring" (a CSS conic-gradient circle) — no JavaScript charting library is used anywhere in this project.

## 3. Employee App (`engineer.html`) — Component Inventory

| Component class(es) | Where used | Notes |
|---|---|---|
| `.job-card` (with `.s-pending`/`.s-progress`/`.s-completed`/`.s-emergency`/`.s-noaccess` modifiers) | Today/Upcoming/Done lists | Colour-tinted by status; the "In Progress" variant has a pulsing animated border |
| `.status-pill`, `.sp-btn` | Job detail | The tap-to-change status selector |
| `.ba-slot`, `.ba-pair`, `.photo-grid` | Job detail, photo section | Two distinct upload UIs: paired before/after slots, or a plain grid — user-togglable per job |
| `.cta`, `.cta-call`/`.cta-wa`/`.cta-map`/`.cta-waze`/`.cta-email` | Job detail | Quick-action buttons, each opening a different external protocol (`tel:`, `wa.me`, Google Maps, Waze, `mailto:`) |
| `.kpi-card`, `.bar-row` | Dashboard | Stat tiles and horizontal bar-chart rows (again, hand-drawn CSS, no library) |
| `.qn-sheet`, `.qn-item` | Quick Notes picker | A bottom-sheet checklist of pre-written note phrases |
| `.map-toolbar`, `.map-tool-btn` | Map tab | View-mode switcher for the embedded Leaflet map |
| `.req-card`, `.rb-pending`/`.rb-approved`/`.rb-rejected` | Requests | Overtime/leave request cards with status badges |
| `.guide-section` | Guide (under More) | Expandable accordion-style help sections |

**A confirmed, literal code-quality note relevant to this inventory:** the CSS block defining `.job-quick-row`/`.jq-btn`/`.jq-green`/`.jq-blue`/`.jq-red`/`.jq-map`/`.ptr-spinner` is repeated verbatim **seven times** in this file's stylesheet (once per status-colour variant) instead of being written once — see [../AUDIT.md](../AUDIT.md) Section 5.2. **Forms:** Add Job, Overtime request, Leave request, plus the inline notes/hours fields on the job detail sheet. **Filters:** a time-vs-nearest sort toggle on Today's list. **Dialogs:** the Job detail sheet itself is the app's primary dialog pattern (a bottom sheet, not a centred modal, matching the mobile-first design).

## 4. Client Portal (`client-portal.html`) — Component Inventory

| Component class(es) | Where used | Notes |
|---|---|---|
| `.hero`, `.hero-inner` | Overview | An animated canvas-background hero card (the same animated-network visual style as the Office/Employee apps' login screens) |
| `.tab`, `.nav` | Top navigation | Horizontal, icon-plus-label tabs that collapse to icon-only on narrow viewports |
| `.jbadge` (`.bp`/`.bi`/`.bd`/`.bv`/`.bc`) | Jobs, Invoices | Status badges, styled distinctly from (though conceptually equivalent to) the Office App's `.badge` classes |
| `.notif-panel`, `.search-overlay` | Top bar | A notification dropdown and a full-screen search overlay |
| `.skeleton`, `.sk-hero`/`.sk-card`/`.sk-row` | Every tab | Loading placeholders shaped to match the content about to load |
| Lucide `<i data-lucide="...">` icons | Throughout | The one app of the three that uses a real icon library instead of emoji characters |

**Forms:** the Request wizard is the only data-entry form in this app (Section 5.7 of [04_Client_Portal.md](04_Client_Portal.md)). **Charts:** a compliance-score ring (CSS conic-gradient, same technique as the Office App). **Dialogs:** a lightbox (`openLb`/`closeLb`) for viewing photos/certificates full-screen, an invoice preview modal.

## 5. Accessibility — Consolidated Finding

🔴 Across all three applications, no explicit `aria-*` attributes, semantic landmark roles (`<nav>`, `<main>`, etc. used for their accessibility semantics rather than just as CSS hooks), or documented screen-reader support were confirmed in the markup reviewed, beyond the Office App's Command Palette having arrow-key navigation. This is a consistent, cross-cutting gap, not specific to any one screen — see [18_Known_Issues.md](18_Known_Issues.md) and [19_Future_Roadmap.md](19_Future_Roadmap.md).

## 6. Responsive Behaviour — Consolidated Finding

The three apps take three different approaches, matching their different audiences: the Office App is desktop-first with no confirmed mobile breakpoints for its densest screens (the Jobs table, the 3-column job modal); the Employee App is mobile-first by design (bottom tab bar, safe-area padding, large touch targets); the Client Portal sits in between, built card-based and responsive with a collapsing tab bar, reflecting that it's the one app used most by non-technical people on arbitrary devices. Full detail per app: Section 5.5/6.5 of [02_Office_App.md](02_Office_App.md)/[03_Employee_App.md](03_Employee_App.md)/[04_Client_Portal.md](04_Client_Portal.md).

## 7. Charting Approach — Consolidated Finding

**No charting library is used anywhere in this project.** Every bar chart, progress bar, and compliance ring across all three apps is hand-built from styled `<div>` elements (bar height set via inline `style="height:...%"`) or CSS `conic-gradient` circles. This keeps the apps dependency-light but means every chart is bespoke, non-interactive (no hover tooltips, no zoom/pan), and would need to be individually rebuilt if the project ever adopted a real charting library.
