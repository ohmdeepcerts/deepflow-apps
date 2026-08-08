# 01 — System Architecture

DeepFlow is three browser-only single-page apps (Office, Engineer, Client Portal) built by Vite from a monorepo of `apps/*` + shared `packages/*`, talking directly to one Supabase project over REST/RPC and Realtime. There is no backend server of DeepFlow's own — Supabase (Postgres + PostgREST + Auth + Realtime + Storage + a handful of Edge Functions) is the entire middle tier. Output is static files, deployed to GitHub Pages.

This replaced an earlier architecture (three monolithic HTML files, no build step, no shared code) via a full migration completed across July–August 2026. That history is summarized in §9; this document describes what is true **now**.

Deep dives (written separately, not duplicated here): [02-office-app.md](02-office-app.md), [03-engineer-app.md](03-engineer-app.md), [04-client-portal.md](04-client-portal.md), [05-database.md](05-database.md), [06-supabase.md](06-supabase.md), [../ops/19-deployment.md](../ops/19-deployment.md).

---

## 1. Shape, at a glance

```
                     ┌───────────────────────────────────────────┐
                     │              Supabase (only backend)       │
                     │  Postgres · PostgREST · Auth · Realtime ·  │
                     │  Storage · 5 Edge Functions                │
                     └───────────────────────────────────────────┘
                                  ▲        ▲        ▲
                         REST/RPC │        │Realtime│ REST/RPC
                         + WSS    │        │(jobs)  │
                     ┌────────────┴──┐ ┌───┴──────┐ ┌┴───────────┐
                     │  apps/office   │ │apps/     │ │apps/portal │
                     │  (staff, full  │ │engineer  │ │(client,    │
                     │  CRUD, Auth)   │ │(field,   │ │token+PIN,  │
                     │                │ │ Auth)    │ │no Auth)    │
                     └───────┬────────┘ └────┬─────┘ └─────┬──────┘
                              \                │              /
                               \               │             /
                                ▼               ▼            ▼
                     ┌─────────────────────────────────────────────┐
                     │   packages/*  (shared, no publishing —       │
                     │   imported directly via Vite aliases)        │
                     │   @core  @data  @business  @ui  @offline     │
                     │   @auth (placeholder)  @pdf (placeholder)    │
                     └─────────────────────────────────────────────┘
```

The three apps never talk to each other directly. All cross-app interaction happens through the shared database — either pushed live via Supabase Realtime (today: the Office App's `jobs` table subscription only) or picked up the next time another app loads/polls. See [10_Synchronization.md](../10_Synchronization.md) for the full mechanism (not re-derived here).

---

## 2. Build system (`vite.config.js`)

Read in full — the whole file is 40 lines. Key facts:

- **`root: 'apps'`** — Vite's project root is `apps/`, not the repo root. This also makes `apps/public/` Vite's conventional `publicDir`: anything in there (currently just `apps/public/index.html`, a static GitHub Pages landing page linking to the three apps) is copied verbatim to the output root.
- **Multi-page build** — `build.rollupOptions.input` declares three independent entry points, one per app:
  ```js
  office:   apps/office/index.html
  engineer: apps/engineer/index.html
  portal:   apps/portal/index.html
  ```
  This is why the output is three separate static sites sharing one build, not one SPA with client-side routing — there is no router in any app; each is its own HTML document.
- **`build.outDir: '../dist'`**, `emptyOutDir: true` — output lands in `dist/` at the repo root (gitignored), wiped and rebuilt each time.
- **Base path is opt-in via `GH_PAGES`**: `base: process.env.GH_PAGES ? '/deepflow-apps/' : '/'`. The production GitHub Pages deploy is a *project* site (`<org>.github.io/deepflow-apps/`, repo is `ohmdeepcerts/deepflow-apps`), so every emitted asset URL needs that path prefix there. But local dev/preview and the CI `build-and-test` job (including the Playwright suite, which serves the build on `localhost:4175` and navigates root-relative paths) assume the site is served from `/`. The env var is set **only** in the deploy job's build step (see §7) — never for local builds or the test job. Getting this wrong once already broke CI (see the commit history on this file: an unconditional `/deepflow-apps/` base 404'd every Playwright asset request until this was made opt-in).
- **Path aliases** (`resolve.alias`), each pointing at a `packages/*` directory: `@core`, `@data`, `@auth`, `@business`, `@ui`, `@pdf`, `@offline`. Apps import shared code as `import { STATUS } from '@business'` etc. — never relative paths like `../../packages/business`.
- **No custom Vite plugins.** The config has no `plugins:` array at all — everything above is Vite's built-in behavior (multi-page `rollupOptions.input`, the default `publicDir` convention, alias resolution). There is *no* plugin that copies `sw.js` (the Client Portal's push-notification service worker, which lives at the repo root) into `dist/portal/`. A stale local `dist/` can appear to have `dist/portal/sw.js` from a manual copy done outside the build — a clean `npm run build` does **not** produce it. This is a real, currently-unaddressed gap: `apps/portal/main.js` registers `./sw.js` at runtime, but nothing in the documented build/deploy pipeline places that file in the portal's deployed output. Worth confirming against the live GitHub Pages output before relying on portal push notifications.

---

## 3. Tooling (`package.json`)

```json
"scripts": {
  "dev":             "vite",
  "build":           "vite build",
  "preview":         "vite preview",
  "test:unit":       "vitest run tests/unit",
  "test:integration":"vitest run tests/integration",
  "test:e2e":        "playwright test"
}
```

- **Runtime dependency:** `@supabase/supabase-js` (`^2.110.7`) — the only production dependency. Everything else the apps use at runtime (jsPDF, jsPDF-AutoTable, html2canvas, Lucide icons, SheetJS) is loaded via CDN `<script>` tags directly in each app's `index.html`, not bundled by Vite — those libraries are consumed as `window` globals (e.g. `window.jspdf.jsPDF`), not ES imports. Only first-party code and the Supabase client go through Vite's module graph.
- **Dev dependencies:** `vite` (`^8.1.5`), `vitest` (`^4.1.10`) + `jsdom` (test environment), `@playwright/test` (`^1.61.1`).
- **Vitest is configured separately** (`vitest.config.js`, not `vite.config.js`) specifically because `vite.config.js` sets `root: 'apps'`, which is wrong for discovering `tests/` and `packages/` at the repo root. Vitest runs `tests/unit/**` and `tests/integration/**` under `jsdom`.
- **Playwright** (`playwright.config.js`) drives its own dev server: `npm run build && npm run preview -- --port 4175`, then runs `tests/e2e/apps.spec.js` against `http://localhost:4175`.
- Package manager is plain npm (`package-lock.json` present, no workspaces field — the "monorepo" here is a shared Vite alias graph, not an npm/pnpm workspaces setup).

---

## 4. Repository layout

```
apps/
  office/     index.html + main.js + 12 extracted feature modules
  engineer/   index.html + main.js + 8 extracted feature modules
  portal/     index.html + main.js + 5 extracted feature modules
  public/     index.html  (GH Pages landing page — Vite's publicDir, not a 4th app)
packages/
  core/       Supabase client + fetch primitive
  data/       field mapping + repository (dGet/dAll/dPut/dDel)
  business/   STATUS enum, invoice totals, date helpers
  ui/         escaping, network-canvas animation, invoice/PAT PDF rendering
  offline/    offline write-queue
  auth/       placeholder — not yet populated
  pdf/        placeholder — not yet populated (real PDF code lives in @ui)
supabase/
  migrations/ 9 tracked SQL migrations (+ README)
  functions/  5 Edge Functions (Deno/TS)
tests/
  unit/, integration/, e2e/
docs/
  architecture/   this document + per-app/DB deep dives (being written)
  ops/            deployment, runbooks (being written)
  (legacy docs/00_..20_*.md — being superseded by docs/architecture + docs/ops)
dist/           build output (gitignored)
sw.js           Client Portal push-notification service worker (see §2 gap)
vite.config.js, vitest.config.js, playwright.config.js, package.json
```

`sites/gbelectricals/` also exists at the repo root — a separate static marketing page, outside the Vite build (`root: 'apps'` doesn't reach it) and outside the scope of this document.

---

## 5. The three apps

| App | Entry | `main.js` | Extracted modules | Auth model |
|---|---|---|---|---|
| Office (`apps/office`) | `index.html` (5,043 lines of markup) | 14,539 lines | 12 | Supabase Auth (email+password) + PIN lock |
| Engineer (`apps/engineer`) | `index.html` (927 lines) | 1,874 lines | 8 | Supabase Auth, 30-day session resume |
| Client Portal (`apps/portal`) | `index.html` (560 lines) | 1,244 lines | 5 | URL token + PIN (no Supabase Auth) |

Each `index.html` is **not** a thin shell — it still carries the full markup for every screen/modal in that app (same pattern as the pre-migration monolith), with a single `<script type="module" src="./main.js">` at the bottom. What moved during the migration was JavaScript logic, not markup. Third-party rendering libraries (jsPDF, html2canvas, Lucide) are loaded as CDN `<script>` tags in the `<head>` of `index.html`, ahead of the module script.

Full per-app breakdowns belong in the linked deep-dive docs; the module lists below are for orientation only.

### apps/office — 12 extracted modules
`certs.js` (certificates dashboard/CRUD/PDF/PAT), `directory.js` (landlords/agencies/agents/engineers CRUD), `audit.js` (audit log + notification dispatch), `maps.js` (live engineer location tracking), `engineer-reports.js` (per-engineer analytics + payslips), `statements.js` (landlord/agency statement PDFs), `expenses.js` (per-job expense tracking), `credit-notes.js` (credit note issuance), `invoice-custom-text.js` (reusable invoice text blocks), `sql-guide.js` (Settings SQL snippets), `master-xlsx-export.js` (multi-sheet Excel export), `backup-diagnostics.js` (compliance backup + diagnostics).

`main.js` retains Jobs and Invoices in full — deliberately not split further (see §6).

*Note:* a 13th module, `timesheets.js`, was extracted during Phase 5 but the hourly-billing/timesheets feature it supported was later removed entirely (jobs are priced per-job, payroll is contract-based) — the file no longer exists. Anything that says "13 modules" is describing a since-superseded state.

### apps/engineer — 8 extracted modules
`geo-weather.js` (geocoding + weather + Land Registry lookup), `calc-tools.js` (voltage drop / max-Zs / conduit-fill calculators), `quick-notes.js` (defect-phrase picker), `requests.js` (overtime/leave requests), `guide.js` (in-app help), `photos.js` (before/after photo capture, compression, EXIF/GPS stamping), `map.js` (Leaflet job map + OSRM route), `on-my-way.js` (WhatsApp ETA messages).

`main.js` retains auth/session, Jobs load & render, job detail, push notifications, and app bootstrap.

### apps/portal — 5 extracted modules
`hero-canvas.js` (banner animation), `request-wizard.js` (new-job request form), `invoice-pdf.js` (invoice preview + download), `properties.js` (jobs/certs grouped by address), `certs.js` (certificates list/calendar + PDF preview).

`main.js` retains routing/orchestration (tab dispatch, search, notifications, PIN gate) and the domain-aggregation views (overview, jobs, invoices, payments) that read across `_d.jobs`/`_d.certs`/`_d.invoices` simultaneously.

---

## 6. The bidirectional-import pattern (read this before "fixing" it)

Inside each app, `main.js` and its extracted modules **import from each other in both directions** — e.g. `apps/office/main.js` imports `logAudit` from `./audit.js`, and `audit.js` imports `toast`/`_sb`/`getAppUser` back from `./main.js`. The same shape exists for `certs.js`, `directory.js`, `maps.js`, `engineer-reports.js`, `statements.js`, `expenses.js`, `credit-notes.js`, and every other extracted module in all three apps.

**This is deliberate, not a circular-dependency bug.** Every one of these cross-module references is used only *inside function bodies* (called at runtime, when a user does something), never evaluated at module-load time (top-level code, default parameter values, class field initializers). ES module circularity is only a real problem when evaluation order matters — i.e. when module A needs a *value* from module B before B has finished running. Here, by the time any of these functions actually executes, both modules have already fully loaded; a function body reading `import { toast } from './main.js'` just needs `toast` to exist by the time it's *called*, not by the time it's *imported*. Every module's header comment states this explicitly (e.g. `certs.js`: *"safe because every cross-module reference is used only inside function bodies, never at module-evaluation time"*), and it holds because the split was done by literally relocating cohesive blocks of the original single-file app apart, not by redesigning the control flow — functions that called each other before the split still call each other after it, just across a file boundary.

Why the split stopped where it did: Jobs and Invoices were deliberately **not** further split in any of the three apps. In the Office App, ~150 functions hub through a single `renderJobs()` and a shared mutable-state block (`editJid`, `selJobs`, `jDate`, `curInvId`, `invItems`, etc.); auto-invoice creation is physically defined inside the Jobs section, not Invoices. That's one interwoven system without a safe seam, not two domains that happen to share a file — forcing a split there would trade a well-understood pattern for a fragile one. The same shape of finding applies to Engineer's and Portal's own Jobs-adjacent cores. Each app's `main.js` is the stopping point of this migration, not an oversight.

New code in any of these apps should follow the same pattern: extracted feature modules import shared state and utilities from `main.js` via named imports, and `main.js` imports the feature's public functions back — as long as nothing on either side is *used* before both modules finish loading, this is safe.

---

## 7. Shared packages (`packages/*`)

| Package | Status | What it actually contains | Imported by |
|---|---|---|---|
| `@core` | populated | `SB_URL`, `SB_KEY`, `restFetch()` — the Supabase URL/anon-key and a shared low-level fetch primitive (URL construction, headers, JSON parsing only; auth-token resolution and error formatting stay per-app) | office, engineer (via its own `sb()`), portal, `@data`... in principle (see note below) |
| `@data` | populated | `TO_DB`/`FROM_DB` camelCase↔snake_case field mapping (single source of truth — previously three drifting copies, the root cause of at least two real production bugs), `createRepository()` → `dGet`/`dAll`/`dPut`/`dDel` with a read cache | office, portal |
| `@business` | populated | `STATUS` enum, `calcLineItemsTotal()` + per-app VAT-rate resolution, date helpers (`daysDiff`, `formatDateUK`, `localDateStr`) | office, engineer, portal |
| `@ui` | partially populated | `escHtml`/`escAttr`/`escText` (XSS-safe escaping), `initNetworkCanvas` (shared login/hero background animation), and — despite the package name suggesting only UI chrome — the actual PDF rendering: `renderInvoicePDF` (vector jsPDF invoice), `renderPatCertificatePDF`/`buildPatCertificatePages` (PAT certificate, rendered via html2canvas to match a legacy app pixel-for-pixel), `buildMastheadHTML` | office, engineer (escaping only), portal |
| `@offline` | populated | `isNetworkError()`, `createOfflineQueue()` — the offline write-queue pattern (originally built for Engineer, ported to Office); takes the caller's own fetch function and localStorage key as parameters rather than importing them | office, engineer |
| `@auth` | **placeholder** — `export {}` only | Nothing yet. Intended for session/permission-checking primitives shared across apps (not identity establishment — Office/Engineer use Supabase Auth, Portal uses a URL token + PIN, and those stay genuinely separate). No app currently imports from `@auth`. | none |
| `@pdf` | **placeholder** — `export {}` only | Nothing, and not currently planned to be populated. Investigated directly: Office's and Portal's invoice PDFs were compared and found to be genuinely different documents (different branding, different fields), not duplicated logic — merging them would be a visible product/design decision, not a safe refactor. Real PDF code lives in `@ui` instead (see above). | none |

**Dependency direction** (declared rule, enforced by convention not tooling): `@core` depends on nothing shared; `@data` depends on `@core`; `@business` depends on `@core` + `@data`; `@ui` and `@offline` depend on nothing shared; apps may depend on any/all packages; packages never import from apps. In practice today, `@business`'s and `@offline`'s actual code has **zero** `import` statements from other packages — both are pure functions that take their collaborators (a fetch function, a VAT rate) as parameters rather than importing them directly, so the declared dependency direction is closer to "allowed, not yet exercised" for those two.

Each package has its own `README.md` (`packages/<name>/README.md`) explaining scope and what's deliberately *not* included yet — read those before assuming a gap is an oversight.

---

## 8. Data flow and backend

There is no DeepFlow-owned server. All three apps call Supabase directly from the browser:

- **REST/RPC** — every data read/write goes through PostgREST via `@core`'s `restFetch()` (or each app's thin wrapper around it), hitting Supabase's auto-generated REST API and Postgres functions (RPCs) directly. Row-Level Security policies on the Postgres tables are the actual authorization boundary — not app code.
- **Realtime** — the Office App subscribes to Postgres change events on the `jobs` table (`apps/office/main.js`, `.channel('jobs-realtime').on('postgres_changes', ...)`) to keep the Jobs board live-synced across open sessions without polling. This is the only Realtime channel in the system today; Engineer and Portal pick up changes on their own load/refresh/poll cycles instead.
- **Auth** — Supabase Auth (email + password) for Office and Engineer; Client Portal has no Supabase Auth session at all and instead authenticates via a URL token + PIN checked against the database.
- **Storage** — Supabase Storage holds uploaded files (certificate PDFs, job photos, company logos).
- **Edge Functions** (`supabase/functions/`) — the one place server-side code genuinely exists, and it runs on Supabase's infrastructure, not a server DeepFlow operates: `create-checkout-session` and `stripe-webhook` (payment processing — needs a secret Stripe key, can't live in browser code), `send-email`, `extract-cert-data`, `rewrite-notes` (AI-assisted note rewriting). These are the only pieces of this system that aren't static files served to a browser.
- **Migrations** — `supabase/migrations/` (9 tracked SQL files) is the version-controlled source of truth for schema changes, applied to the live Supabase project.

Full schema, RLS policy, and Realtime detail: [05-database.md](05-database.md) and [06-supabase.md](06-supabase.md).

---

## 9. Why this shape (brief)

Until July 2026, DeepFlow was three independent monolithic HTML files (`index.html`, `engineer.html`, `client-portal.html`) with no build step, no shared code, and no automated tests. That produced real, shipped bugs from independently-maintained duplicate logic — most concretely, three separately hand-written copies of the JS↔database field mapping drifting apart, which twice caused silent data-loss/write failures in production (a Credit Notes feature that never worked at all, and an auto-invoice flow that silently left jobs stuck in the wrong status).

The rationale, options considered, and phased migration plan are recorded in **`ARCHITECTURE_REDESIGN_PROPOSAL.md`** (repo root — not archived; kept as the historical record of *why*, referenced by comments throughout the current codebase). Read it for the "why"; it is not a live proposal — every phase it describes (Vite scaffold, `@core`, `@data` field-mapping unification, `@business`, module extraction, CI/CD to GitHub Pages) has been executed, and this document describes the result. Two notable deviations from that original plan, both explained in their own sections above: the proposal's per-app `src/<domain>/` subdirectory structure wasn't adopted (modules sit flat in each `apps/<name>/` directory instead), and `@pdf` was investigated and deliberately left empty rather than populated (§7).

The explicit non-goal, stated in that proposal and still true: **no multi-tenancy**, and no change to the deployment target — static output to GitHub Pages, Supabase as the only backend, unchanged throughout.

---

## 10. Deployment (brief — see [../ops/19-deployment.md](../ops/19-deployment.md) for detail)

CI/CD is `.github/workflows/ci.yml`, two jobs:

- **`build-and-test`** — runs on every push and pull request. `npm ci` → `npm run build` (base `/`) → `npm run test:unit` → `npm run test:integration` → install Playwright's Chromium → `npm run test:e2e`. Nothing broken reaches the next job.
- **`deploy`** — runs only on a push to `main`, only after `build-and-test` passes. Rebuilds with `GH_PAGES=true` (so the `/deepflow-apps/` base path is baked into the output this time), then publishes `dist/` to GitHub Pages via `actions/upload-pages-artifact` + `actions/deploy-pages`.

Live site: a GitHub Pages *project* site at `ohmdeepcerts.github.io/deepflow-apps/`, with `/office/`, `/engineer/`, `/portal/` as the three app paths and the landing page (`apps/public/index.html`) at the root.

---

## Related documents

- [02-office-app.md](02-office-app.md), [03-engineer-app.md](03-engineer-app.md), [04-client-portal.md](04-client-portal.md) — per-app deep dives
- [05-database.md](05-database.md), [06-supabase.md](06-supabase.md) — schema, RLS, migrations, Realtime in full
- [../ops/19-deployment.md](../ops/19-deployment.md) — CI/CD and deployment deep dive
- `ARCHITECTURE_REDESIGN_PROPOSAL.md` (repo root) — the original migration rationale and roadmap, now executed history
- [../10_Synchronization.md](../10_Synchronization.md) — cross-app data synchronization mechanics
