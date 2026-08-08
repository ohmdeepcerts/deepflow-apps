# 23 — Developer Onboarding

An older version of this document claimed *"there is no `npm install`, no build command, and no local dev server required."* That was true of DeepFlow's pre-Vite architecture (three standalone HTML files) and is **no longer true**. DeepFlow is a Vite monorepo now (see [01-system-architecture.md](../architecture/01-system-architecture.md)): it has real dependencies, a real build, and a real dev server, and this document walks through all of them, verified directly against the current `package.json`, `vite.config.js`, and source tree rather than assumed.

This document does two different jobs — read the one you actually need:

- **[Part A](#part-a--working-on-this-project)** — onboarding for a developer joining *this* project, working against the existing, live GB Electrical Supabase project.
- **[Part B](#part-b--standing-up-a-fresh-instance-for-a-new-company)** — a completely honest account of what it actually takes, today, to stand up DeepFlow for a *different* company. Short version: it's a developer-assisted fork-and-redeploy process, not a self-serve product. Nothing below pretends otherwise.

See [docs/README.md](../README.md) for the full documentation map. If you haven't yet, read [10-business-rules.md](../business/10-business-rules.md) and [01-system-architecture.md](../architecture/01-system-architecture.md) before this page — this one is about *running the code*, not what it does.

---

## Part A — working on this project

### A1. What you're working with

- **Repo:** `ohmdeepcerts/deepflow-apps` — one Vite monorepo, three static single-page apps (`apps/office`, `apps/engineer`, `apps/portal`), shared code in `packages/*`, built and deployed together to GitHub Pages by `.github/workflows/ci.yml`.
- **Backend:** one live Supabase project (Postgres + PostgREST + Auth + Realtime + Storage + Edge Functions). No application server of DeepFlow's own — every app talks to Supabase directly from the browser.
- **Package manager / runtime:** npm, Node. `package.json` doesn't pin an `engines` field, but CI (`.github/workflows/ci.yml`) runs on **Node 24** — match that locally to avoid surprises.

### A2. Clone and install

```
git clone https://github.com/ohmdeepcerts/deepflow-apps.git
cd deepflow-apps
npm install
```

Real dependencies, read directly from `package.json`:

| | Package | Version |
|---|---|---|
| dependency | `@supabase/supabase-js` | `^2.110.7` |
| devDependency | `vite` | `^8.1.5` |
| devDependency | `vitest` | `^4.1.10` |
| devDependency | `@playwright/test` | `^1.61.1` |
| devDependency | `jsdom` | `^29.1.1` |

That's the entire dependency tree — no framework, no CSS toolchain, no state-management library. `npm install` is a normal, necessary step; skipping it means `npm run dev`/`build`/`test:*` all fail immediately.

### A3. Running the dev server

```
npm run dev
```

runs `vite`, which starts a dev server at `http://localhost:5173`. `vite.config.js` sets `root: 'apps'` with three separate build entry points (`rollupOptions.input`: `apps/office/index.html`, `apps/engineer/index.html`, `apps/portal/index.html`) — this is a genuine multi-page app, not one SPA with client-side routing. In dev mode, Vite serves each app at the path matching its location under `root`. **Confirmed directly** by starting the dev server and requesting each path:

| Path | Result |
|---|---|
| `http://localhost:5173/` | **404** — there is nothing at the bare root |
| `http://localhost:5173/office/` | 200 — Office App |
| `http://localhost:5173/engineer/` | 200 — Engineer App |
| `http://localhost:5173/portal/` | 200 — Client Portal |

So: open all three of those URLs (not just `localhost:5173`) while developing. Edits to any file under `apps/` or `packages/` hot-reload; no manual refresh loop.

### A4. Building and previewing a production build

```
npm run build      # vite build → outputs to ../dist (i.e. dist/ at repo root), one dist/office, dist/engineer, dist/portal, plus dist/ root from apps/public
npm run preview     # serves the dist/ build locally, for a final check before deploy
```

`vite.config.js`'s `base` is conditional on a `GH_PAGES` env var (`process.env.GH_PAGES ? '/deepflow-apps/' : '/'`), set only by the CI deploy step — local builds and `preview` always use root-relative paths, matching how Playwright's e2e suite expects to find the build.

### A5. The Supabase connection: hardcoded, not env-var-driven

This is the single most important fact in this document, so it gets stated plainly and then shown verbatim.

`packages/core/supabase.js` (the *only* place the connection is declared — imported by all three apps via the `@core` alias) contains:

```js
export const SB_URL = 'https://dzqyqpuhxdrrpipbehpk.supabase.co';
export const SB_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6cXlxcHVoeGRycnBpcGJlaHBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NzYzMjksImV4cCI6MjA4ODQ1MjMyOX0.7ObsuqKv5gNX5r7Pz1x1gyGgugcX2W0zw3d9hC6osvI';
```

Both are **string literals, checked directly into source control** — not read from `import.meta.env`, not from a `.env` file, not from any build-time substitution. A repo-wide search for `import.meta.env` and any `VITE_`-prefixed variable found none; there is no runtime or build-time configuration mechanism for the Supabase connection at all today. `.gitignore` does list `.env`/`.env.local`/`.env.*.local`, but no such files exist in the repo and nothing reads them — that's unused boilerplate, not an active config path. This is precisely the fact Part B below depends on.

**What this means for you, joining this project:** you do **not** create your own Supabase project or generate your own credentials. `npm install && npm run dev` connects you to the real, live `dzqyqpuhxdrrpipbehpk` Supabase project (internally named "JobManagement") — the same one GB Electrical's office staff use — the moment any app makes its first request. There is no separate dev/staging database.

**Is it safe that this key is public?** The value above is the Supabase **anon** key, which is meant to be public (it ships to every browser that loads the app regardless) — its safety depends entirely on Row Level Security being correctly enforced server-side, not on the key being secret. `docs/architecture/06-supabase.md` doesn't exist yet to point to for the full policy inventory, so this was checked directly instead: running Supabase's own security-advisor against project `dzqyqpuhxdrrpipbehpk` returned **zero `rls_disabled_in_public` findings** — every table in the `public` schema has RLS switched on, no exceptions. The one RLS-related note it did return is `push_subscriptions` having RLS enabled with *no* policies at all — that's a fully-closed table (nothing reachable via the anon/authenticated REST surface; it's written only through `SECURITY DEFINER` RPCs and the service role), not a gap. The advisor's remaining findings are expected `SECURITY DEFINER` functions callable by `anon`/`authenticated` (`portal_get_*`, `engineer_pin_*`, `is_office`, etc.) — that's the deliberate mechanism the Client Portal's token+PIN sessions and the Engineer App's PIN sessions use instead of direct table grants, documented in its own right in `supabase/migrations/20260720142205_tighten_df_access_catchall_rls_policies.sql`. So: yes, the assumption holds, verified rather than taken on faith.

That said, this is still **live production data** for a real business. There's no destructive-testing sandbox — be deliberate with delete/bulk-delete actions and anything that sends real email/push/Stripe traffic (see Edge Functions in Part B) while developing, the same way you'd be careful in any admin panel connected to a real customer's data.

### A6. Running the tests

| Command | Runs | Confirmed result (this session) |
|---|---|---|
| `npm run test:unit` | `vitest run tests/unit` | 4 files, **50 tests passed**, ~1.3s |
| `npm run test:integration` | `vitest run tests/integration` | 1 file, **9 tests passed**, ~1.8s |
| `npm run test:e2e` | `playwright test` | 4 tests across Office/Engineer/Portal, **all passed**, ~5.7s |

`vitest.config.js` is deliberately separate from `vite.config.js` (its own comment explains why: the app build's `root: 'apps'` isn't appropriate for discovering tests under `/tests` and `/packages`). `playwright.config.js`'s `webServer` runs `npm run build && npm run preview -- --port 4175 --strictPort` automatically before the e2e suite — you don't need to build/preview by hand first, `npm run test:e2e` does it for you (this makes it the slowest of the three by a wide margin). One thing you may see and can ignore: the build step logs a `parse5` HTML-parsing warning about an inline attribute in `apps/office/index.html`'s Settings tab — pre-existing, cosmetic, doesn't fail the build or any test.

That's the clean baseline as of this writing: all three suites green, in that order. `.github/workflows/ci.yml` runs the same three commands (unit → integration → `playwright install --with-deps chromium` → e2e) on every push and PR, and only deploys to GitHub Pages (a separate `deploy` job, push-to-`main` only) after all of them pass. See [ops/20-testing-and-qa.md](../ops/20-testing-and-qa.md) and [ops/19-deployment.md](../ops/19-deployment.md) for more detail on each, once written.

### A7. Coding conventions actually observed here

Not a style guide someone wrote down — this is what's actually in the code, spot-checked across several files in different apps and packages:

- **No linter or formatter is configured.** There's no `.eslintrc*`, `eslint.config.*`, or `.prettierrc*` anywhere in the repo, and nothing in `package.json`'s scripts or dependencies runs one. Consistency is maintained by convention and review, not tooling — don't assume a `lint` script exists.
- **Module header comments.** Nearly every extracted module opens with a multi-paragraph comment explaining what the file is, why it was extracted, and what phase of the migration it came from — e.g. `apps/office/certs.js` opens with a comment describing its domain, that it was "Extracted from main.js verbatim (Phase 5 of the architecture migration...)", and explicitly calling out the two functions that moved elsewhere instead. `packages/data/repository.js` and `packages/business/status.js` do the same for their own history and design decisions (e.g. why `ENGINEER_COMPLETED` is a distinct status, why the read cache has a 30s TTL and not an indefinite one). Expect to write this kind of comment, not skip it, when you extract or meaningfully restructure something.
- **Tagged `console.warn`/`console.error` calls.** A real, repo-wide convention of bracket-tagging console output by subsystem, e.g. `console.warn('[DeepFlow] ...')`, `console.warn('[Push] ...')`, `console.warn('[Portal] ...')`, `console.warn('[Audit] ...')`, `console.warn('[OfflineQueue] ...')`, `console.warn('[NotifWebhook] ...')`, `console.error('[CreditCheck] ...')`. Follow it for any new warning/error you add — it's what makes browser console output attributable to a subsystem instead of anonymous noise.
- **The bidirectional cross-module import pattern.** `main.js` and its extracted feature modules import from each other in both directions in every app (e.g. `apps/office/main.js` imports from `certs.js`, and `certs.js` imports back from `main.js`). This is deliberate, not an accident to "fix" — it's explained in full in [01-system-architecture.md §6](../architecture/01-system-architecture.md#6-the-bidirectional-import-pattern-read-this-before-fixing-it), read that before touching import structure in any extracted module.
- **Comment density inside function bodies is low, and purposeful, not narrative.** Spot-checking `packages/data/repository.js`, `packages/business/status.js`, and `apps/engineer/calc-tools.js`: code is not walked through line-by-line in comments. Inline comments show up specifically to explain a *non-obvious decision* (why a cache TTL is short, why a status is treated as "not yet completed" in every revenue calculation) rather than to restate what a line of code already says. No formal style guide enforces this — it's just the consistent pattern actually present.

### A8. Making your first change

Follow [docs/README.md](../README.md)'s "If you're new here, read in this order" list rather than a separate list here — it already points to the right architecture docs before code. Practically: pick the app you're changing (`apps/office`, `apps/engineer`, or `apps/portal`), read that app's architecture doc, run `npm run dev`, open the matching `/office/`, `/engineer/`, or `/portal/` URL from A3, make your change, and confirm `npm run test:unit`, `test:integration`, and (if you touched app-level behavior) `test:e2e` are still green before opening a PR — CI enforces exactly that same bar.

---

## Part B — standing up a fresh instance for a new company

**Read this whole section before starting.** DeepFlow today is a **single-tenant** system serving one company (GB Electrical) from one hardcoded Supabase project. There is no admin UI, setup wizard, or runtime configuration that provisions a new customer. "Deploying DeepFlow for a new company" currently means: a developer forks the repo, creates a brand-new Supabase project, manually reconstructs the schema on it, edits two hardcoded constants, and rebuilds and redeploys under new hosting. It is a **developer-assisted process**, not a self-serve product, and genuine multi-tenant support doesn't exist — if [22-future-roadmap.md](22-future-roadmap.md) lists it, that's where it belongs, as planned future work, not something to imply already works.

### B1. Step 1 — create a new Supabase project

Standard Supabase project creation (new organization/project, note the project ref, region, and the auto-generated `anon` key from Project Settings → API). Nothing DeepFlow-specific about this step.

### B2. Step 2 — schema: a real, confirmed gap

`supabase/migrations/` currently holds 9 SQL files (plus its own `README.md`). That `README.md` says exactly what these are:

> "These 7 files are the exact SQL Supabase has recorded as already applied to the live project (`dzqyqpuhxdrrpipbehpk`), pulled directly from `supabase_migrations.schema_migrations` and committed here for the first time."

That's the key fact: this migration history was **captured from an already-running database**, not authored as a from-scratch schema. Reading the files confirms it — every single one is an `ALTER TABLE`, `CREATE INDEX`, `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`, or `DROP` against tables (`jobs`, `users`, `attachments`, `app_settings`, `invoices`, `persons`, …) that the migration assumes **already exist**. For example, the oldest migration is:

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS postcode text;
...
CREATE INDEX IF NOT EXISTS jobs_postcode_idx ON jobs(postcode);
```

There is no `CREATE TABLE jobs (...)` anywhere in `supabase/migrations/` — not for `jobs`, not for `users`, not for any base table. **Running these 9 files in order against a genuinely empty, fresh Supabase project will fail on the very first one**, because `jobs` doesn't exist yet to `ALTER`.

This is a real gap, not a misunderstanding of intent: there is no committed "initial schema" migration or SQL dump anywhere in this repository today. The full base schema only exists as (a) the live `dzqyqpuhxdrrpipbehpk` project itself, and (b) its description in prose/table form in [05-database.md](../architecture/05-database.md). Until someone fixes this, standing up a new project's schema means either:

- Manually reconstructing every table, index, function, and policy by reading [05-database.md](../architecture/05-database.md) and the 9 existing migrations (error-prone, easy to miss something), or
- Running `supabase db dump --schema public` (or the equivalent via the Supabase dashboard) against the *existing* live project to produce a real baseline schema file, committing that as a new `supabase/migrations/0000_initial_schema.sql` ahead of the 9 files that already exist, and only then replaying the full migration set against the new project.

The second option is the only way to make this genuinely repeatable, and doesn't exist yet — treat it as the first real task for anyone actually doing this, not an already-solved problem.

### B3. Step 3 — Storage

The apps expect exactly **one Storage bucket, named `deepflow`** — confirmed by grep across `apps/office/certs.js`, `apps/office/main.js`, `apps/engineer/main.js`, and `apps/engineer/photos.js`, all of which hit `${SB_URL}/storage/v1/object/deepflow/<path>` (uploads/deletes) and `${SB_URL}/storage/v1/object/public/deepflow/<path>` (public reads — certificate PDFs and job photos are served this way, directly in `<img>`/PDF-link URLs, no extra auth). Create a bucket named `deepflow` on the new project, and set its access policy to match what [06-supabase.md](../architecture/06-supabase.md) documents once written — at minimum, public read on object paths and authenticated/token-gated write, matching the pattern above.

### B4. Step 4 — RLS policies

There's no single "run this file to apply all RLS" script either — like the schema itself, policies are defined incrementally across `supabase/migrations/`, layered on top of a base set of policies that (per B2) isn't captured anywhere in the repo. `supabase/migrations/20260720142205_tighten_df_access_catchall_rls_policies.sql` is the most complete single artifact — its own extensive header comments explain the full role model (office/admin/engineer-token/portal-token) in more depth than a typical migration, and it's the closest thing today to a policies reference. The authoritative, organized version of this belongs in [06-supabase.md](../architecture/06-supabase.md); until it exists, that migration file plus [05-database.md](../architecture/05-database.md) are the real sources of truth.

### B5. Step 5 — Edge Functions

`supabase/functions/` contains 5 function directories. The live project actually has **6 active Edge Functions** — confirmed by querying the project directly: `send-push` is deployed and `ACTIVE` (version 5) on `dzqyqpuhxdrrpipbehpk`, but **its source is not committed anywhere in this repository**. `apps/engineer/main.js` calls it (`fetch(SB_URL+'/functions/v1/send-push', ...)`) and `apps/portal/main.js` holds a hardcoded VAPID public key to subscribe to it, so it's a real, load-bearing function — just one whose code only exists on the live project and in a historical planning writeup at the repo root, `PHASE6B_PUSH_EDGE_FUNCTION.md` (which is implementation notes/instructions, not source you can deploy as-is). A fresh instance needs `send-push` either pulled from the original project (`supabase functions download send-push`, if you have CLI access to it) or rewritten from that planning doc before Web Push works at all.

| Function | Committed in repo? | Live & ACTIVE? | Secrets it reads (`Deno.env.get`) |
|---|---|---|---|
| `create-checkout-session` | Yes | Yes | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (both auto-injected by Supabase), `STRIPE_SECRET_KEY`, `PORTAL_ORIGIN` (defaults to `https://ohmdeepcerts.github.io/deepflow-apps/portal/` if unset — **must be overridden for a new instance**) |
| `stripe-webhook` | Yes | Yes | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_WEBHOOK_SECRET` |
| `send-email` | Yes | Yes | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EMAIL_PROVIDER` (`resend` or `sendgrid`, defaults to `resend`), `RESEND_API_KEY`, `RESEND_FROM`, `SENDGRID_API_KEY`, `SENDGRID_FROM` |
| `extract-cert-data` | Yes | Yes | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `OCR_SPACE_API_KEY` |
| `rewrite-notes` | Yes | Yes | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` |
| `send-push` | **No** — live-only, source not in repo | Yes | (per `PHASE6B_PUSH_EDGE_FUNCTION.md`) `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically by Supabase to every Edge Function at runtime — nothing to set for those specifically. Every other secret in the table above needs setting per-project (`supabase secrets set ...` or the dashboard) before that function will work on a new instance; a function missing a required secret fails at first invocation, not at deploy time, so test each one.

### B6. Step 6 — point the code at the new project

Edit the two literal constants in `packages/core/supabase.js` (`SB_URL`, `SB_KEY`) to the new project's URL and anon key. This is genuinely the entire "configuration" step for the app-to-database connection — there is no `.env` file, no build flag, no runtime toggle. (Edge Function secrets from B5 are separate and configured on the Supabase side, not in this file.)

### B7. Step 7 — rebuild and redeploy

```
npm run build            # local hosting / a custom domain root
GH_PAGES=true npm run build   # only if deploying to a GitHub Pages *project* site, to get the /deepflow-apps/-style base path right
```

then deploy `dist/` wherever the new instance will actually be hosted — GitHub Pages via a workflow modeled on `.github/workflows/ci.yml`, or any other static host, since the build output is plain static files. See [ops/19-deployment.md](../ops/19-deployment.md) for the existing pipeline this would be adapted from.

### B8. What does not exist today (stated plainly, not as a criticism)

- No first-time setup wizard in the Office app — nothing walks a new company through configuring their own instance.
- No runtime, environment-variable-driven Supabase configuration — B6 above (editing a source file and rebuilding) is the only mechanism.
- No per-customer branding storage beyond the single `app_settings` row (confirmed: `app_settings` holds exactly **one row** — see [05-database.md §3.15](../architecture/05-database.md), "the single-row configuration store") — there's no concept of more than one company's settings coexisting.
- No automated schema-provisioning script or CLI — B2 above is manual today, and the underlying baseline-schema gap (no committed `CREATE TABLE` migration) needs fixing before it even could be automated.
- No genuine multi-tenant data isolation — this is one Supabase project per company, full stop, not row-level tenant scoping inside a shared project.

Real, planned multi-tenant/self-serve support (if scoped) belongs in [22-future-roadmap.md](22-future-roadmap.md) as future work — not implied to exist by this document.

---

## See also

- [docs/README.md](../README.md) — documentation map and reading order
- [01-system-architecture.md](../architecture/01-system-architecture.md) — the monorepo shape and the bidirectional-import pattern (§6)
- [06-supabase.md](../architecture/06-supabase.md) — full Supabase configuration, Auth, Storage, and RLS detail (once written)
- [07-sql-migrations.md](../architecture/07-sql-migrations.md) — migration history and conventions (once written)
- [ops/19-deployment.md](../ops/19-deployment.md) — build/deploy pipeline and CI (once written)
- [ops/20-testing-and-qa.md](../ops/20-testing-and-qa.md) — the test suites in more depth (once written)
- [22-future-roadmap.md](22-future-roadmap.md) — where real multi-tenant/self-serve support belongs as planned work (once written)
