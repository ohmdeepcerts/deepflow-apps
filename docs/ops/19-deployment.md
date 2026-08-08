# 19 — Build & Deploy Pipeline

DeepFlow ships as three static, Vite-built single-page apps (Office, Engineer, Client Portal) plus a static landing page, deployed to a GitHub Pages *project* site out of the `ohmdeepcerts/deepflow-apps` repo. This document covers the build configuration, the CI/CD pipeline, the local dev workflow, and the actual current branch/deploy state as of this writing.

**Methodology:** every fact below came from reading `vite.config.js` and `.github/workflows/ci.yml` in full, running `npm run` scripts out of `package.json`, and running `git log`/`git branch -a`/`git merge-base`/`git show <ref>:vite.config.js` directly against this repo's real history — not carried over from `ARCHITECTURE_REDESIGN_PROPOSAL.md` or assumed from the plan it describes. Test-suite detail (what runs, what it covers, what it doesn't) is deliberately not duplicated here — see [20-testing-and-qa.md](20-testing-and-qa.md), which this document only points to for that. Architecture-level framing of the same build/deploy facts also appears in [../architecture/01-system-architecture.md](../architecture/01-system-architecture.md) §2 and §10; this document is the fuller version.

---

## 1. Build configuration — `vite.config.js`

Full file, 32 lines, no plugins on `main` as of the current HEAD (`cec7d2a`):

```js
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'apps',
  base: process.env.GH_PAGES ? '/deepflow-apps/' : '/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        office: resolve(__dirname, 'apps/office/index.html'),
        engineer: resolve(__dirname, 'apps/engineer/index.html'),
        portal: resolve(__dirname, 'apps/portal/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'packages/core'),
      '@data': resolve(__dirname, 'packages/data'),
      '@auth': resolve(__dirname, 'packages/auth'),
      '@business': resolve(__dirname, 'packages/business'),
      '@ui': resolve(__dirname, 'packages/ui'),
      '@pdf': resolve(__dirname, 'packages/pdf'),
      '@offline': resolve(__dirname, 'packages/offline'),
    },
  },
});
```

Key facts:

- **`root: 'apps'`** — Vite's project root is `apps/`, not the repo root. This makes `apps/public/` Vite's conventional `publicDir`: its one file, `apps/public/index.html` (the marketing/landing page — hero, feature grid, FAQ, and three cards linking to `office/`, `engineer/`, `portal/`), is copied verbatim to the output root by Vite's built-in `publicDir` handling, not by a custom plugin.
- **Multi-page build** — three independent HTML entry points in `build.rollupOptions.input`, one per app. This is why the deployed output is three separate static sites sharing one build and one `dist/`, not one SPA with client-side routing — there is no router in any app.
- **`base` is opt-in via the `GH_PAGES` env var**, straight from the file's own comment: the production build is served from a GitHub Pages *project* site (`<org>.github.io/deepflow-apps/`), so every asset URL Vite emits needs that `/deepflow-apps/` prefix there or it 404s. Local dev/preview and the CI `build-and-test` job — including the Playwright suite, which serves the build on `localhost:4175` and navigates root-relative paths — all assume the site is served from `/`. `GH_PAGES` is set to `true` in exactly one place: the `deploy` job's build step (§2). Getting this wrong once already broke CI — see the commit history on this file (`59a90b3`, "make the GitHub Pages base path opt-in via GH_PAGES, not unconditional"): an earlier, unconditional `/deepflow-apps/` base 404'd every Playwright asset request during `build-and-test`.
- **`build.outDir: '../dist'`, `emptyOutDir: true`** — output lands in `dist/` at the repo root (gitignored), wiped and rebuilt on every build.
- **Path aliases** (`resolve.alias`) — `@core`, `@data`, `@auth`, `@business`, `@ui`, `@pdf`, `@offline`, each pointing at a `packages/*` directory. Apps import shared code as `import { STATUS } from '@business'`, never a relative path into `packages/`.
- **No plugins on `main`.** The `plugins:` array does not exist in this file as it stands on `main` right now. This matters specifically for `apps/portal/main.js`, which registers a service worker at runtime via `navigator.serviceWorker.register('./sw.js')` — but nothing in the current `main` build pipeline copies `apps/portal/sw.js` into `dist/portal/sw.js`. A stale local `dist/` can appear to have it from a manual copy done outside the build; a clean `npm run build` on `main` today does not produce it. **A fix exists but is not merged** — see §5.

---

## 2. CI/CD pipeline — `.github/workflows/ci.yml`

One workflow file, two jobs.

**Triggers** (`on:`):
- `push` to `main`
- every `pull_request`

### `build-and-test`

Runs on every push and every PR. Steps, in exact order:

| # | Step | Command |
|---|---|---|
| 1 | Checkout | `actions/checkout@v4` |
| 2 | Node setup | `actions/setup-node@v4`, Node 24, npm cache |
| 3 | Install | `npm ci` |
| 4 | Build | `npm run build` (no `GH_PAGES` set → base `/`) |
| 5 | Unit tests | `npm run test:unit` |
| 6 | Integration tests | `npm run test:integration` |
| 7 | Install browser | `npx playwright install --with-deps chromium` |
| 8 | E2E tests | `npm run test:e2e` |

Any failure in any of steps 4–8 fails the job. See [20-testing-and-qa.md](20-testing-and-qa.md) for what each test tier actually covers, how many tests, and known gaps — not repeated here.

### `deploy`

```yaml
if: github.event_name == 'push' && github.ref == 'refs/heads/main'
needs: build-and-test
```

Only runs on a direct push to `main`, and only after `build-and-test` passes — a PR, or a push to any other branch, never reaches this job, and a failing test tier blocks it even on `main`. Steps:

1. Checkout, Node 24 setup, `npm ci` (same as above, run fresh — this job does not reuse `build-and-test`'s build output).
2. `npm run build` with **`GH_PAGES: true`** set — this is the one place in the whole pipeline where that env var is set, baking in the `/deepflow-apps/` base path.
3. `actions/configure-pages@v5`
4. `actions/upload-pages-artifact@v3`, path `dist`
5. `actions/deploy-pages@v4`

This is a native GitHub Pages Actions deployment (the `pages: write` / `id-token: write` permissions block and `environment: github-pages` at the top of the workflow confirm this) — there is no `gh-pages` branch and no separate publish step outside this workflow. `concurrency: { group: pages, cancel-in-progress: false }` at the workflow level serializes deploys so two pushes to `main` in quick succession don't race each other's Pages publish.

**No Supabase step anywhere in this workflow.** A direct search of `.github/workflows/ci.yml` for `supabase` (case-insensitive) returns nothing — confirmed by grep, not inferred. See §6.

---

## 3. Deploy target

| | |
|---|---|
| Repo | `ohmdeepcerts/deepflow-apps` |
| Site type | GitHub Pages *project* site (not a custom domain — no `CNAME` file anywhere in the repo) |
| Live URL | `ohmdeepcerts.github.io/deepflow-apps/` |
| Office App | `.../deepflow-apps/office/` |
| Engineer App | `.../deepflow-apps/engineer/` |
| Client Portal | `.../deepflow-apps/portal/` |
| Landing page | `.../deepflow-apps/` (dist root — `apps/public/index.html`, see §1) |

The `base: '/deepflow-apps/'` value in `vite.config.js` and this URL structure are the same fact stated twice — get one wrong and the other breaks. There is no staging/preview deploy target; `deploy` publishes straight to the live Pages environment on every qualifying push to `main`.

---

## 4. Local dev workflow

From `package.json`:

| Script | Command | What it does |
|---|---|---|
| `npm run dev` | `vite` | Dev server, base path `/` (unset `GH_PAGES`), all three apps' entry HTML served live with HMR |
| `npm run build` | `vite build` | Production build into `dist/`, base path `/` unless `GH_PAGES=true` is set in the environment |
| `npm run preview` | `vite preview` | Serves the already-built `dist/` locally — this is what Playwright's `webServer` drives (see [20-testing-and-qa.md](20-testing-and-qa.md) §3) |

**The one environment difference that matters:** locally — `dev`, `build`, and `preview` alike — `GH_PAGES` is never set, so every local build/serve uses base path `/`. Production is the only context where `GH_PAGES=true` is set (§2, deploy job step 2), producing base path `/deepflow-apps/`. A developer testing a production-shaped build locally (`GH_PAGES=true npm run build && npm run preview`) would need to serve it from a `/deepflow-apps/` sub-path to see correct asset resolution — `vite preview`'s default root-relative serving does not do this automatically, which is exactly why the CI `build-and-test` job deliberately builds *without* `GH_PAGES` (§2, step 4) rather than trying to preview a `/deepflow-apps/`-based build locally.

No `.env` file or secret is required for any of `dev`/`build`/`preview`/the test suites — see [20-testing-and-qa.md](20-testing-and-qa.md) §1 for why (the Supabase anon key is a public, embedded constant, not a runtime secret).

---

## 5. Current branch / merge state

Checked directly, not assumed. As of this writing:

```
git rev-parse main         → cec7d2a
git rev-parse origin/main  → 9604cdb
```

**Local `main` is 8 commits ahead of `origin/main`, unpushed.** The live GitHub Pages deployment currently reflects `origin/main` (`9604cdb`, "Fix portal timeline status mapping, stop fabricating cert expiry dates, rebuild Supabase usage dashboard") — none of the 8 local commits since then (including this documentation work) have reached the `deploy` job yet, because `deploy` only triggers on an actual `push` to `main` on GitHub.

Two long-running feature branches exist, both **still unmerged**:

| Branch | Ahead of `main` by | Commit | Contains |
|---|---|---|---|
| `fix/broken-onclick-handlers-and-portal-sw` | 1 commit (`7a38190`) | "Fix 10 broken UI actions: functions called from inline handlers but never window-exposed" | The window-exposure fixes for 10 dead-button bugs, **plus** the `copyPortalServiceWorker` Vite plugin that closes the `dist/portal/sw.js` gap described in §1 |
| `docs/reorganize-and-archive-history` | 1 commit (`32bb6d5`) | "Reorganize repo docs: archive point-in-time audits, delete duplicates" | Moves 30 root-level `.md` files into `docs/history/`, deletes 3 duplicate root `.md` files, updates ~10 in-code comments/tooltips that pointed at the old paths |

Both branches share the same merge-base with `main` — `9604cdb`, i.e. the current `origin/main` tip — confirmed with `git merge-base main origin/<branch>` for each. In other words: both branches split off at the same point `main` has since moved 8 commits past, and neither has been merged or rebased back in since. This is a genuine three-way divergence (`main`, and each branch, each hold commits the others don't), not a simple "branch is behind" situation — merging either now means an actual merge, not a fast-forward.

**Practical consequence for `vite.config.js` specifically**: the `copyPortalServiceWorker` plugin shown by `git show origin/fix/broken-onclick-handlers-and-portal-sw:vite.config.js` (adds a `plugins:` array with a `closeBundle()` hook that copies `apps/portal/sw.js` → `dist/portal/sw.js`) is **not** present in `main`'s `vite.config.js` today. The §1 gap it fixes is real and current on `main` until that branch is merged.

---

## 6. Manual steps — Supabase Edge Functions

Edge Function deployment is **entirely separate from this GitHub Actions pipeline** and does not happen automatically on any push, merge, or Pages deploy. Confirmed two ways: `.github/workflows/ci.yml` has no step, action, or CLI invocation referencing `supabase` anywhere (grepped, zero matches), and there is no `supabase/config.toml`-driven CI step of any kind in this repo.

The 7 functions currently in `supabase/functions/` —

- `create-checkout-session`
- `extract-cert-data`
- `portal-sign-url`
- `rewrite-notes`
- `send-email`
- `send-push`
- `stripe-webhook`

— are deployed by hand, directly against Supabase project **`dzqyqpuhxdrrpipbehpk`**, via the Supabase MCP/CLI (`deploy_edge_function` or equivalent `supabase functions deploy`), independent of whatever state `main` or GitHub Pages is in. A merge to `main` and a GitHub Pages deploy changes the three static apps; it does not touch any Edge Function's deployed code — those have to be redeployed separately whenever `supabase/functions/*` source changes. `supabase/migrations/` (9 tracked SQL migrations, see [../architecture/07-sql-migrations.md](../architecture/07-sql-migrations.md)) is likewise outside this pipeline — schema changes are applied directly against the live project, not run as a CI step.

---

## See also

- [20-testing-and-qa.md](20-testing-and-qa.md) — the full test suite this pipeline runs: what each of the 63 tests actually covers, what's known-untested, and the manual live-browser verification practice that sits alongside it
- [../architecture/01-system-architecture.md](../architecture/01-system-architecture.md) §2–§4, §10 — build system and deployment in the context of the wider system architecture
- [../architecture/06-supabase.md](../architecture/06-supabase.md) — the Supabase project itself (RLS, Realtime, Storage) that Edge Functions and all three apps talk to
- [../architecture/07-sql-migrations.md](../architecture/07-sql-migrations.md) — the migration set that, like Edge Functions, is applied by hand and outside this CI/CD pipeline
