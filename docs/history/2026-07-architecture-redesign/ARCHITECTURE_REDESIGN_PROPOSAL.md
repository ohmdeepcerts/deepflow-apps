# DeepFlow — Architecture Analysis & Redesign Proposal

**Role:** Chief Software Architect review
**Status:** 🟡 Awaiting approval — no implementation has started. Nothing in this document has been applied to the codebase.
**Grounded in:** live inspection of `index.html`, `engineer.html`, `client-portal.html`, the live Supabase schema (22 tables, 41 RLS policies, 31 functions, 0 triggers, 7 tracked migrations), and the existing documentation set (`ARCHITECTURE.md`, `AUDIT.md`, `SECURITY_AUDIT.md`, `PERFORMANCE_AUDIT.md`, `/docs/00`–`20`, `JOBS_CTO_*`, `JOBS_AUDIT_*`) plus roughly 90 real, verified bug fixes made across this codebase in the sessions immediately preceding this report — those fixes are used throughout as *evidence*, not anecdote.

This document has five parts, matching what was asked for: **(1)** Architecture Analysis Report, **(2)** Proposed Architecture, **(3)** Local Development Workflow, **(4)** Testing Strategy, **(5)** Migration Roadmap. Read in order — each part depends on the one before it.

---

## Part 1 — Architecture Analysis Report

### 1.1 Current architecture, precisely

DeepFlow is a **3-tier system with no middle tier of its own code**. Three static HTML files talk directly to one Supabase project over HTTPS/WebSocket; there is no server, no API layer, and no build step anywhere in the pipeline.

| App | File | Lines | Size | Auth model |
|---|---|---|---|---|
| Office App | `index.html` | 24,039 | 1.38 MB | Supabase Auth (email+password) + PIN lock |
| Employee App | `engineer.html` | 3,888 | 219 KB | Supabase Auth (email+password), 30-day resume |
| Client Portal | `client-portal.html` | 2,470 | 160 KB | URL token + PIN (no Supabase Auth) |

Each file is internally identical in shape: `<head>` (fonts, CDN libraries) → one giant `<style>` block → all markup for every screen and every modal, present at once and toggled with CSS → one giant `<script>` block containing every function the app has. There is no router (one URL, JS shows/hides "pages"), no component model, and no module system — `index.html`'s script is functionally **one 19,000-line function-scope**, held together by section-header comments (`// ═══ JOBS ═══`, `// ═══ INVOICES ═══`, etc.) rather than real boundaries. I extracted the comment map directly — there are **~85 such sections** in `index.html` alone, covering Jobs, Invoices, Certificates, Directories, Settings, Reports, Timesheets, Maps, Credit Notes, Expenses, Statements, and more. That map is important: it means the *domain boundaries already exist conceptually* in this codebase. They were never promoted to file boundaries. That is the single most useful fact for everything that follows — this is not a redesign from nothing, it's a redesign that formalizes a structure that's already implicitly there.

The database: 22 tables, 41 RLS policies, 31 Postgres functions, 0 triggers, live data currently in single digits to low tens of rows per table (the business is small today — this matters for the migration risk calculus in Part 5, not for the target design, which is sized for the 5–10 year horizon you asked for).

One telling piece of evidence: `engineer.html` line 1095 carries the comment *"CONFIG — inlined core (no external deepflow-core.js dependency)"*. Someone already reached for a shared module once, and backed away from it — almost certainly because there was no build step to bundle it, so "one file, paste the logic in" was the only option that kept the site deployable to GitHub Pages with zero tooling. That decision was reasonable at the time. It is the direct cause of several of the worst bugs found in this codebase (Section 1.6).

### 1.2 Current problems

**No shared code layer, by construction, not by oversight.** Each app has its own independent copy of: the Supabase connection (URL, anon key, fetch wrapper), the camelCase-JS ↔ snake_case-DB field mapping, escaping helpers, date/currency formatting, toast/modal primitives, and large chunks of business logic (invoice status colors, status enums, permission logic). This is already-documented drift, not a hypothetical: `docs/18_Known_Issues.md` records the Employee App reading a different, wrong settings table than the Office App uses, and two independently-maintained invoice-status color maps that have visibly diverged. Three copies of the same logic don't fail the same way twice — they fail differently, silently, in whichever copy nobody happened to fix.

**No compile-time or test-time contract between JavaScript objects and database columns.** This is the single most consequential finding from the recent bug-fixing work, so it's worth stating precisely: JavaScript object literals are written by hand to match database column names by hand, in three separate files, with no shared source of truth and nothing that checks agreement. When they drift, PostgREST doesn't warn — it silently drops fields it doesn't recognize on some paths and hard-rejects the *entire write* on others. Two real, previously invisible production bugs were found this way in the last session alone:

- `saveCreditNote()` wrote three fields (`isCreditNote`, `linkedInvId`, `reason`) that had no matching columns at all. The write had no error handling. **The Credit Note feature had never worked, at any point, for as long as it existed** — every attempt threw an uncaught exception with no user-visible error.
- The auto-invoice flow's job-status-sync PATCH sent `linkedInvId` where the real column was `linkedinvid`. PostgREST rejects the *entire* PATCH when one key doesn't match — so every auto-created invoice, from every job ever auto-invoiced, left its originating job silently stuck on "Completed" instead of "Invoiced."

These are not one-off typos. They are the structurally predictable output of an architecture where the same fact (what fields does an invoice have?) is asserted independently in at least four places — the DB schema, and each of three apps' hand-written JS — with nothing that keeps them consistent and no test that would catch drift before it reaches production. Any new field added to any workflow has a real chance of repeating this exact failure mode, indefinitely, until the architecture itself removes the opportunity.

**No automated tests of any kind.** Confirmed in `docs/17_Testing_and_QA.md` and unchanged since — zero unit tests, zero integration tests, zero E2E tests, across all three apps. Every verification this project has ever had has been manual: reload the page, click through, read the console. That does not scale past the size this project is today, let alone 5×.

**No build pipeline, no CI, no migration history alongside the code.** `docs/01_System_Architecture.md` §13 records that no `.github/` folder or CI configuration exists at all. Supabase itself now has a real migration history (7 tracked migrations as of this report, all applied through this engagement) — but that history lives only inside Supabase, not as version-controlled files in this repository. If the Supabase project were lost or a second environment (staging) were ever needed, there is currently no reliable way to reproduce the schema from source control.

**Client-side-only business logic and authorization.** Every business rule — invoice totals, auto-invoice eligibility, permission checks, status transitions — runs as JavaScript in the browser. The only enforcement that can't be bypassed by disabling JavaScript or opening dev tools is whatever RLS policy actually exists on a table, and RLS coverage has been inconsistent (this engagement closed a real gap: a catch-all `df_access` policy across six tables was found and tightened). This is a viable model for a small trusted team. It stops being viable the moment "multiple companies" and "hundreds of employees" enters the picture, because at that point the browser is not a trust boundary you can afford to rely on.

**Massive per-file surface area with no test coverage compounds every future change.** A 24,039-line single-scope script means: any function can accidentally shadow or collide with any other (two real duplicate-`id` HTML collisions were found and fixed this session — `s-vat` and `pf-notes` — where the second element silently never worked because `getElementById` always resolved to the first); any global variable can be mutated from anywhere; and there is no way for two developers to work on unrelated features in this file without a guaranteed merge conflict. At 5× the size (~120,000 lines in one file), this stops being merely uncomfortable and becomes actively unworkable — no editor performs well on a single 6 MB JS payload, no code reviewer can meaningfully review a diff against a file that size, and the "which of the 85 sections does this belong to" question becomes a real onboarding barrier rather than a minor annoyance.

### 1.3 Future risks (assuming 5× growth + multi-company ambition)

Two different kinds of "bigger" are in play here, and they have different architectural consequences — it's worth separating them explicitly:

1. **More data, same business shape** (the scenario `JOBS_CTO_SCALABILITY_ESTIMATE.md` already analyzed in detail for the Jobs page specifically): unscoped full-table fetches and un-virtualized DOM rendering hit a real wall around 10,000–50,000 rows. That analysis is correct and its conclusions (server-side query scoping, DOM virtualization) still apply — this document doesn't repeat it, it *inherits* it as a requirement for the redesigned Jobs module specifically.
2. **Multiple companies** — this is a qualitatively different requirement, not just "more of the same data." It means: tenant isolation (one company must never be able to see another's jobs, invoices, or client data — today there is a single flat set of tables with no tenant concept at all), per-tenant configuration (today's single-row JSON settings blob has no tenant dimension), and almost certainly per-tenant billing/usage tracking. Retrofitting tenant isolation onto a schema and RLS policy set that was never designed for it is one of the highest-risk migrations a system can undertake — every single RLS policy and every query needs a `tenant_id` predicate added and *verified*, because a single missed predicate is a cross-tenant data leak, not a cosmetic bug.

**The specific recommendation here (and this is a judgment call, stated plainly): do not build multi-tenancy now.** Design so it is *addable later without a rewrite*, but do not spend effort on it today — that would be exactly the over-engineering the brief warned against, for a company that currently has single-digit rows in most tables. What the redesign in Part 2 does instead is remove the things that would make multi-tenancy *hard* to retrofit later: the single JSON settings blob (replace with real, queryable tables — a `tenant_id` column is trivial to add to a table, much harder to add to a blob), and the fact that business rules currently live in client JS with no single enforcement point (a future `tenant_id` check is far safer added once, in a Postgres RLS policy or a server-side function, than copy-pasted into three client apps' worth of query call sites).

Beyond multi-tenancy specifically, at genuine scale (hundreds of thousands of jobs, per the brief) the current architecture has three concrete failure points, all already partially documented and now reinforced by this session's findings:

- **No server-side query scoping** — `dAll()` fetches entire tables; already flagged as the #1 scalability risk in `JOBS_CTO_SCALABILITY_ESTIMATE.md`.
- **The settings blob** — every settings change rewrites one entire JSON row; the Properties list living inside it cannot be paginated or indexed. This gets worse, not better, as data grows.
- **Name-matched relationships** — most core links (job → landlord, job → agency) are matched by text name, not foreign key. `docs/19_Future_Roadmap.md` (M4) already correctly identifies this as a data-integrity risk that *compounds* with client count. At 5× scale with real duplicate/renamed client names, this stops being theoretical.

### 1.4 Maintainability issues

Beyond what's covered above: **2,308 inline `style=` attributes** in the Office App alone (per `PERFORMANCE_AUDIT.md` §3.2) mean a single visual design change requires a find-and-replace sweep across the entire file rather than editing one stylesheet rule. **The same CSS block is duplicated 7 times** in the Employee App. Neither is a bug today; both are direct multipliers on the cost of every future UI change, and both get strictly worse as the file grows.

### 1.5 Performance concerns

Already comprehensively documented in `PERFORMANCE_AUDIT.md` and `JOBS_CTO_SCALABILITY_ESTIMATE.md`; this report doesn't re-derive them, but the redesign in Part 2 is built to directly enable their recommended fixes (a real shared cache layer per table, DOM virtualization for the Jobs list, a debounced Command Palette) rather than working against them. The one performance-relevant fact worth adding here: none of these are fixable *incrementally and safely* inside the current single-file structure without extreme care, because there is no test suite to prove a caching or virtualization change hasn't silently broken a screen elsewhere in the same 24,000-line file. Testing infrastructure (Part 4) is therefore a prerequisite for the performance work, not a parallel track.

### 1.6 Files that are becoming too large

Already stated in the table above, but concretely: `index.html` at 24,039 lines is already past the point where any single human holds its full structure in working memory — this entire engagement has depended on `grep`-driven navigation, not "reading the file." At 5× growth this becomes ~120,000 lines — not a "large file," a genuinely unmanageable one, regardless of who is maintaining it or how experienced they are.

### 1.7 What must stay together vs. what should split

This is the actual design judgment the brief asked for — not "split because large," but split by responsibility, with reasoning:

**Must stay together (do not fragment further, even during the redesign):**
- **The Jobs rendering pipeline** (`renderJobs`, the dual job cache, drag-and-drop reordering, the realtime patch handler, the column system). This is already flagged by the earlier CTO task force as having a specific, fragile invariant — drag-and-drop's "poll immunity" depends on exact cache-update ordering. This should become **one cohesive module**, not several, because splitting a tightly-coupled, already-fragile subsystem purely to satisfy a file-size target is exactly the kind of harmful over-splitting the brief warned against. It's the single largest module in the new design, and that's correct.
- **The invoice numbering + auto-invoice decision logic**, as one unit. Job status, invoice numbering series (landlord vs. agency), and the "does this job already have an invoice" check are three facts that must always be evaluated together and consistently — this session found and fixed exactly the bug that results from evaluating them inconsistently in different call sites.

**Should split, along the boundary that already exists in the section comments:**
- Jobs / Invoices / Certificates / Directories (Persons, Agencies, Agents) / Settings / Reports & Statements / Timesheets & Payroll / Maps & Engineer Tracking / Credit Notes & Expenses — each becomes its own module per app, because each is independently understandable, independently testable, and today is already logically self-contained (confirmed by the fact that this session was able to reason about and fix each in isolation without needing to touch the others).

### 1.8 Business logic: shared vs. local

**Must become shared** (identical rules today, independently reimplemented — the actual source of the drift bugs already documented):
- Supabase client + fetch wrapper (`_sb`/`sb`)
- The camelCase↔snake_case field mapping (`_TO_DB`/`_FROM_DB`) — today three independent copies; per `docs/01_System_Architecture.md`, already the *documented* single biggest drift risk in the whole codebase
- `STATUS` and other domain enums, invoice numbering, auto-invoice eligibility rules, VAT/total calculation
- Permission/role checking logic (the *rules*, not necessarily the UI that reflects them — see below)
- Formatting: currency, dates, phone numbers
- XSS-safe HTML escaping (`escHtml`) — currently present and used correctly in the Office App; per `AUDIT.md`, **undefined anywhere in the Employee App at all**
- PDF generation primitives (jsPDF wrappers) — used independently by Office App and Client Portal today
- The offline write-queue pattern — built once for the Employee App, partially and separately ported to the Office App this session; should be one implementation, not two

**Should stay local** (genuinely different per app, and forcing a shared abstraction here would be the over-engineering the brief warned against):
- **Authentication itself.** Office/Employee use real Supabase Auth; the Client Portal uses a URL token + PIN. These are different identity models solving different problems, not the same logic written twice. Share the *session/permission-checking primitives* that consume an identity; do not force a fake unification of how identity is established.
- Office App's dense operational UI: the Jobs board, Kanban, Command Palette, drag-and-drop — no equivalent exists or should exist in the other two apps.
- Employee App's field-specific concerns: GPS/location tracking, photo capture/compression/EXIF stamping, weather/map/geocoding integrations, push notification registration.
- Client Portal's read-mostly, aggregation-heavy views and its request wizard.

### 1.9 Circular dependencies and breaking points

No circular dependencies exist today, for the simple reason that nothing is modular enough yet to form a cycle — but the redesign must actively prevent them from appearing as shared packages are introduced. The rule adopted in Part 2 is a strict one-directional dependency graph: `ui` depends on nothing else shared; `core` (Supabase client) depends on nothing else shared; `data` (repositories, field mapping) depends only on `core`; `business` (rules) depends only on `core` + `data`; apps depend on any/all of the above, never the reverse. This is stated explicitly now because it is far cheaper to declare and lint for than to untangle after the fact.

Concrete breaking points to protect deliberately during migration (not hypothetical — each is a real, already-identified fragile mechanism):
- The realtime `jobs` channel + dual cache + drag-and-drop ordering (Section 1.7).
- The field-mapping unification itself — touches every read and write in the system simultaneously; the highest-blast-radius single change in the whole roadmap, and the reason Part 5 sequences it early, in isolation, behind full regression coverage, rather than folding it into a larger change.
- The offline queue — a data-loss bug here (silently dropping a field technician's logged hours) is worse than almost any other failure mode in the system.

---

## Part 2 — Proposed Architecture

### 2.1 Design response to the analysis

Every recommendation below traces to a specific finding in Part 1. Nothing here is introduced "because it's best practice" in the abstract — the brief was explicit about avoiding that, and it's the right instinct for a system this size.

### 2.2 Proposed folder structure

```
/apps
  /office/            (was index.html)
    /src
      /jobs/            /invoices/          /certs/
      /directory/        /settings/          /reports/
      /credit-notes/     /expenses/          /maps/
      /statements/       /audit-trail/
      main.js  (entry point — wires modules together, was the bottom of the old <script>)
    index.html          (thin shell: <head>, mount point, <script src="main.js">)
  /engineer/          (was engineer.html)
    /src
      /jobs/  /photos/  /location/  /requests/  /offline/
      main.js
    index.html
  /portal/            (was client-portal.html)
    /src
      /overview/  /jobs/  /invoices/  /certs/  /requests/  /pin-gate/
      main.js
    index.html

/packages                      (shared, versionless — imported directly, no publishing needed)
  /core        — Supabase client, fetch wrapper, env/config
  /data        — _TO_DB/_FROM_DB mapping, per-table repository functions (dGet/dAll/dPut/dDel), realtime helpers
  /auth        — session handling, role/permission primitives (NOT identity establishment — see 1.8)
  /business    — STATUS + other enums, invoice numbering, auto-invoice rules, VAT/total calc, status-transition rules
  /ui          — toast, modal, escHtml, design tokens/CSS variables, date & currency formatting
  /pdf         — jsPDF wrappers, shared invoice/report templates
  /offline     — the write-queue pattern, one implementation

/supabase
  /migrations           — every schema change from here on, version-controlled (see 5.1)
  /functions             — Edge Functions, only if/when Part 1's "move critical logic server-side" recommendation is acted on

/tests
  /unit          /integration          /e2e

/docs                    (existing — kept, updated as the redesign lands, not replaced)
```

**Why packages, not a monorepo of publishable npm packages:** no publishing, no versioning overhead, no artificial API surface — just directories imported by relative path, bundled by the build tool (2.4). This is the simplest structure that actually achieves "share code without duplicating it," and nothing more. A real internal package registry would be over-engineering at this company's current size; if this project is ever genuinely spun out to serve multiple independent companies as a product, promoting `/packages` to real versioned packages is a mechanical, low-risk *future* step — not something to build now.

### 2.3 Why each shared package earns its existence

- **`core`** exists because the connection layer is *identical* across apps today and is the most security-sensitive shared fact (the Supabase URL and anon key). One definition, one place a key rotation touches.
- **`data`** exists because the field-mapping drift is a documented, already-realized source of production bugs (Section 1.2). This package's mapping table becomes the *only* place a JS↔DB field name is ever declared, and every write in every app goes through it — which structurally prevents the exact bug class that broke Credit Notes.
- **`business`** is separated from `data` deliberately: `data` knows nothing about what a "Draft" invoice or an "Urgent" priority means; `business` does. This separation is what makes `business` logic unit-testable in isolation (Part 4) without needing a live Supabase connection.
- **`auth`** holds permission *checking*, not identity *establishment*, precisely because Section 1.8 found those are legitimately different per app. Sharing the wrong half of "auth" would be a real modeling mistake, not a simplification.
- **`ui`** is deliberately dependency-free (no imports from `data`/`business`) so it can be tested and reasoned about with zero database context — a toast notification does not need to know what an invoice is.
- **`pdf`** and **`offline`** are separated out because each is already duplicated or partially duplicated in practice (Section 1.8), and each is self-contained enough to test independently of everything else.

### 2.4 Build tooling recommendation: Vite, static output, GitHub Pages unchanged

**Recommendation: Vite**, in multi-page-app mode (three entry HTML files, one per app), building to a static `dist/` folder.

Why Vite specifically, against the realistic alternatives:
- **Static output only, exactly like today.** Vite's production build is plain HTML/JS/CSS with no server required — GitHub Pages hosting doesn't change at all. This is a hard requirement from the brief ("simple deployment to GitHub Pages when changes are complete"), and Vite satisfies it natively rather than as a workaround.
- **Multi-page app support is built in**, not bolted on — exactly the three-entry-point shape this project has.
- **Genuinely fast local dev with instant refresh (HMR)** — directly answers "run everything locally, instant refresh, fast builds."
- **Zero required migration to TypeScript, JSX, or any framework.** The existing plain-JS, template-literal-driven code style can be imported and bundled as-is; adopting TypeScript later (recommended eventually, for exactly the "no contract between JS objects and DB columns" problem in Section 1.2 — a typed `Invoice` interface would have caught the Credit Note bug at edit time) becomes a gradual, file-by-file option, never a forced rewrite.
- Rejected alternatives: **esbuild directly** is faster but requires hand-rolling the multi-page dev-server/HMR setup Vite already provides; **Webpack** is unnecessary configuration weight for a project this size with no exotic bundling needs; **Parcel** is comparably zero-config but has a smaller ecosystem and less predictable multi-page-app behavior. None of these change the recommendation meaningfully — Vite is simply the least-friction path to every stated goal.

### 2.5 What is explicitly *not* being recommended (avoiding over-engineering)

Stated explicitly because the brief asked for it directly:
- **No framework adoption (React/Vue/Svelte) as part of this redesign.** The current template-literal rendering approach works, is well understood by whoever maintains this code today, and rewriting the render layer is a completely separate, much larger and riskier decision than the file/module reorganization actually being asked for here. If it's ever wanted, it's a future decision made on its own merits — not a side effect of this restructuring.
- **No multi-tenancy implementation now** (Section 1.3) — designed to be addable, not built.
- **No backend/API server introduced wholesale.** The recommendation in Part 1 is narrower and more targeted: migrate the *specific* integrity-critical operations (invoice numbering, auto-invoice creation, status transitions) into Postgres functions over time — which this project already has a working pattern for (`next_inv_num`/`next_agn_num`, the `portal_*` RPC functions built during the Client Portal security hardening). That is an extension of an existing, proven pattern, not a new architectural layer.
- **No premature micro-splitting.** Section 1.7's "must stay together" list exists specifically to prevent this.

---

## Part 3 — Local Development Workflow

**Today:** no local dev loop exists at all — per the brief, GitHub Pages itself is being used as the development environment, meaning every change requires a real deploy to see its effect.

**Proposed:**
1. `npm install` once.
2. `npm run dev` — Vite's dev server, all three apps served locally (e.g. `localhost:5173/office/`, `/engineer/`, `/portal/`) with instant HMR on every save. Points at the *same* live Supabase project via environment variables (`.env.local`, git-ignored) — no local database needed, since Supabase already is the backend and there's nothing to stand up locally for it.
3. `npm run build` — produces `dist/`, the exact static output GitHub Pages serves today, just built rather than hand-maintained.
4. `npm run preview` — serves the production build locally, for a final check before deploying.
5. **Deployment:** a GitHub Actions workflow (new — none exists today, per Section 1.4) that runs `npm run build` and publishes `dist/` to the `gh-pages` branch/Pages source on every push to `main`. This replaces manual file upload with a one-command (`git push`), zero-manual-steps deploy — directly satisfying "simple deployment... minimal manual work."

This workflow requires no change to the Supabase project, no new environments, and no change to how the business currently accesses the deployed apps — it only changes *how the files that get deployed are built*.

---

## Part 4 — Testing Strategy

Zero tests exist today (Section 1.4/1.9), and this document's own migration plan (Part 5) depends on that changing *before* restructuring begins — the roadmap is written so that tests come first, specifically so the redesign itself can be verified not to change behavior, per the brief's hard requirement.

**Priority order, driven directly by this session's real bug findings (the best available evidence for "where does this codebase actually break"):**

1. **Business-critical logic unit tests** (the `business` package, once extracted) — invoice numbering (landlord vs. agency series), auto-invoice eligibility, VAT/total calculation, status-transition rules, permission checks. These are pure functions once separated from the DOM, and are exactly the category of logic that produced the Credit Note and auto-invoice-status bugs — the highest-value place to put a test suite first.
2. **Data-layer integration tests** (the `data` package) — every table's field mapping round-trips correctly (JS object → DB row → JS object, unchanged), run against a real (or Supabase-local) database. This is the direct, permanent fix for the entire bug *class* found this session, not just the two specific instances of it.
3. **Critical-workflow end-to-end tests** (Playwright, against a running local build): login (both auth models), create a job, mark a job complete → verify auto-invoice fires and the job's own status updates correctly, create and send an invoice, record a payment → verify auto-marked-Paid, create a credit note, submit a Client Portal request, engineer photo upload. Each of these is a real workflow this engagement found broken or silently failing at least once — they are not arbitrary choices.
4. **Regression baseline, captured before any file is moved.** Before Part 5 Phase 0 begins, the E2E suite above is run and recorded against the *current, unmodified* production files. Every subsequent migration phase re-runs the identical suite — a phase is not considered complete until it passes unchanged. This is the literal mechanism that satisfies "the restructuring must not change behaviour."

---

## Part 5 — Implementation Roadmap

Every phase below is independently testable, independently reversible (old files untouched until the phase is verified and only removed at the very end), and keeps all three apps fully deployable throughout — no phase requires downtime or a "big bang" cutover.

| Phase | Scope | Risk | Reversibility |
|---|---|---|---|
| **0 — Safety net** | Introduce Vite + `/packages` skeleton (empty). Write the E2E regression baseline (Part 4.4) against today's unmodified apps. No application code moves yet. | None — purely additive | Trivial (delete new folders) |
| **1 — Extract zero-risk pure utilities** | `ui` (escHtml, formatting) and `core` (Supabase client/fetch wrapper) into `/packages`, re-exported into all three apps *without changing call sites' behavior*. Lowest-risk possible first move. | Low | High — old inline code stays as a fallback until this phase's tests pass |
| **2 — Unify the field mapping** | `data` package becomes the single `_TO_DB`/`_FROM_DB` source for all three apps, closing the drift risk from Section 1.2/1.8. Highest blast-radius single change — done in isolation, behind full data-layer integration tests (Part 4.2), before anything else depends on it. | Medium (blast radius), Low (well-tested) | Old copies kept dormant until every call site is verified |
| **3 — Extract `business` rules** | Invoice numbering, auto-invoice, status transitions, permissions — with the unit tests from Part 4.1 written *first*, against the extracted functions, proving today's actual behavior (bugs and all — this phase does not fix behavior, only relocates it; Section "Rules" was explicit about this). | Medium | High |
| **4 — Extract `pdf` and `offline`** | Consolidate the duplicated/partially-duplicated PDF generation and offline-queue implementations into one each. | Medium (offline queue is a real breaking point, Section 1.9) | High |
| **5 — Split each app's remaining monolith into feature modules** | Following the section map already documented in Section 1.7/1.8 — Jobs, Invoices, Certs, Directory, Settings, Reports, per app. The Jobs pipeline moves as one unit, per Section 1.7. | Medium, spread across many small independently-testable moves | High per module |
| **6 — Wire up CI/CD** | GitHub Actions build+deploy (Part 3.5); confirm `dist/` output is byte-for-byte functionally identical to the hand-maintained files it replaces. | Low | Trivial |
| **7 — Retire the old files** | Only after every phase above has passed full regression, for a full deployed cycle. `index.html`/`engineer.html`/`client-portal.html` at the repo root are removed once `/apps/*/dist` is the confirmed, sole source of the deployed site. | Low, by this point | N/A — this is the completion step |

None of these phases touch Supabase's schema, RLS policies, or the `jobs` Realtime publication — this is a frontend/code-organization migration; the backend does not change, so nothing here can break Supabase synchronization, and each app keeps working normally for its users throughout every phase.

---

## What happens next

This document is the analysis, design, and roadmap the brief asked for. **No code has been moved, no files have been split, and no build tooling has been installed.** Implementation begins with Phase 0 only once you've reviewed this and either approve it as-is or redirect any part of it — including, if you'd like, approving it phase-by-phase rather than all at once.
