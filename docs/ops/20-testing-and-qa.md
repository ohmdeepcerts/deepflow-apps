# 20 — Testing & QA

DeepFlow has a real, passing, three-tier automated test suite — Vitest for unit and integration tests, Playwright for end-to-end — plus an established practice of manually verifying every change live in the browser before it's considered done. This document describes exactly what exists, exactly how to run it, and is equally explicit about what it does **not** cover.

Cross-references: [01-system-architecture.md](../architecture/01-system-architecture.md) §3 covers the same `package.json` scripts from the build/tooling angle; [19-deployment.md](19-deployment.md) covers the CI/deploy pipeline in full (this doc's CI section is a brief pointer only).

---

## 1. Quick reference

| Suite | Command | Files | Tests | Needs |
|---|---|---|---|---|
| Unit | `npm run test:unit` | 4 | 50 | nothing (jsdom, no network) |
| Integration | `npm run test:integration` | 1 | 9 | network — hits the live Supabase project |
| E2E | `npm run test:e2e` | 1 | 4 | a full `npm run build` + local preview server, Playwright's Chromium browser |

All three suites pass as of this writing (confirmed by running each directly, not inferred from CI). None require any `.env` file, secret, or local Supabase instance — the integration suite authenticates with the public anon key that's already embedded in all three apps' shipped bundles (`packages/core/supabase.js`), the same key a browser DevTools inspection would reveal anyway.

Run everything a CI run would run, in order:
```bash
npm run build
npm run test:unit
npm run test:integration
npx playwright install --with-deps chromium   # first time only
npm run test:e2e
```

---

## 2. Vitest configuration (`vitest.config.js`)

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    environment: 'jsdom',
  },
});
```

Deliberately a separate file from `vite.config.js` — that file sets `root: 'apps'` for the multi-page app build, which would break Vitest's discovery of `tests/` and `packages/` at the repo root. Both `tests/unit` and `tests/integration` run under the same config and the same `jsdom` environment (needed because `tests/unit/offline-queue.test.js` touches `localStorage` and `navigator.onLine`, both jsdom globals). There's no separate `environment: 'node'` override for the integration suite even though it does real network I/O — `fetch` works fine under jsdom for that purpose.

`test:unit` and `test:integration` are two separate npm scripts (`vitest run tests/unit` / `vitest run tests/integration`) rather than one `vitest run` — this lets CI (and a developer) run the fast, no-network unit suite on its own without waiting on or depending on live Supabase reachability.

## 3. Playwright configuration (`playwright.config.js`)

```js
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4175',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4175 --strictPort',
    port: 4175,
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
```

Key facts:
- Playwright drives its **own** `webServer` — running `npm run test:e2e` triggers a full production build (`vite build`) and serves the real `dist/` output via `vite preview`, not a dev server. This means e2e failures can surface real build-time problems, not just runtime ones.
- `reuseExistingServer: !process.env.CI` — locally, if something is already listening on 4175 (e.g. a preview you started yourself), Playwright reuses it instead of rebuilding; in CI it always builds fresh.
- Only `chromium` is installed/used (`npx playwright install --with-deps chromium` in CI) — there is no cross-browser (Firefox/WebKit) coverage.
- `screenshot: 'only-on-failure'` — failure screenshots land in `test-results/` (gitignored), nothing is captured on a passing run.
- No project/device matrix — one browser, one viewport, desktop only. No mobile-viewport or touch-input testing.

---

## 4. Unit tests — `tests/unit/` (4 files, 50 tests)

All pure-function tests against `packages/business`, `packages/data`, and `packages/offline` — no network, no DOM rendering, no real app code (`apps/*`) exercised at all.

### `business.test.js` — 10 tests
Tests `packages/business/status.js` and `packages/business/invoice-total.js`:
- **`STATUS` enum**: asserts the exact 7 values (`Pending`, `In Progress`, `Engineer Completed`, `Completed`, `Invoiced`, `Cannot Access`, `Cancelled`) and that the object is frozen (`Object.isFrozen`), so no call site can silently mutate a shared constant.
- **`calcLineItemsTotal`** (the VAT/line-item math shared by the Office App's `calcInvTotal` and the Client Portal's `calcTotal`): summing non-VAT items, adding VAT only to items flagged `vat: true`, defaulting a missing `qty` to 1 and missing `unit` to 0, handling an empty/undefined item list, and a 0% VAT rate producing zero VAT even on `vat:true` items.
- **VAT rate resolution divergence** (documented, not fixed): a dedicated `describe` block reproduces the Office App's `getVatRate()` (`S.vatRate || 20`) and the Client Portal's `_portalVatRate()` (`S?.vatRate ?? 20`) side by side and proves they agree in the common cases but **diverge on an explicit 0% VAT rate with VAT enabled** — Office App wrongly falls back to 20% (because `||` treats `0` as falsy), Portal correctly returns 0% (because `??` only falls back on `null`/`undefined`). This is a real, live, previously-undiscovered bug in the Office App, deliberately left unfixed and pinned down by this test per the "relocate the logic, don't change it" rule that governed the extraction. Anyone fixing it should expect this test to need updating, not deleting.

### `mapping.test.js` — 22 tests
Tests `packages/data/mapping.js` (the camelCase↔snake_case field-mapping layer), generated dynamically over all 10 tables in `TO_DB` (`jobs`, `certs`, `invoices`, `agents`, `persons`, `agencies`, `payments`, `expenses`, `overtime`, `portal_contacts`) — 2 tests per table (20 total) plus 2 fixed tests:
- Per table: `toDb` → `fromDb` round-trips a sample object back to its original shape; every DB-side column name within a table is unique (no two JS fields silently collide onto the same column).
- Fixed: an unmapped/unknown table name passes objects through unchanged; `FROM_DB` is proven to be the exact structural inverse of `TO_DB` for every table.
- This is pure shape-checking — it does not touch the network or the real schema (that's what the integration suite does, see §5).

### `offline-queue.test.js` — 10 tests
Tests `packages/offline/queue.js`:
- **`isNetworkError`** (4 tests): being offline (`navigator.onLine === false`), a `TypeError` from a rejected `fetch`, known network-error message substrings (`"NetworkError..."`, `"Load failed"`), and — the important negative case — that a real server rejection (e.g. `"403: Forbidden"`) is *not* misclassified as a network error.
- **`createOfflineQueue`** (6 tests): a write that succeeds immediately is not queued; a write that fails with a network error is queued (not lost) and fires the `onQueueChange` callback; a real server rejection is re-thrown, not queued; `flush()` replays queued items in order and clears them on success, firing `onSynced` once; `flush()` stops and leaves the remainder queued if a network error recurs mid-flush; `flush()` drops an item the server outright rejects and continues flushing the rest.
- Covers the shared queue behavior extracted from the Office App's and Employee App's near-identical implementations — the two deliberate per-app differences (the localStorage key, and whether a full flush also triggers a Jobs-list refresh) are preserved as caller-supplied parameters and are not asserted on here (they're app-level wiring, not queue logic).

### `repository.test.js` — 8 tests
Tests `packages/data/repository.js`'s `dAll()` 30-second TTL read cache (added to close a real perf gap — ~170 call sites across the Office App previously re-fetched their table on every call):
- A second `dAll()` for the same table within the TTL serves from cache (no second fetch); after the TTL elapses, it re-fetches; `dPut` and `dDel` each invalidate the cache for that table so the next `dAll()` re-fetches (proving a user's own write is never stale); caching one table doesn't affect another; the array returned is a fresh copy each call (mutating the caller's result can't corrupt the cache); the `settings` pseudo-table is never cached; tables registered as `localTables` bypass the network cache entirely and read straight from `localStorage`.
- Uses `vi.useFakeTimers()` to test the TTL deterministically rather than a real 30-second sleep.

---

## 5. Integration tests — `tests/integration/` (1 file, 9 tests)

### `data-mapping.test.js` — 9 tests
The one suite that talks to the network. For every table in `TO_DB` that has at least one mapped column (9 of the 10 — `overtime` maps no fields and is skipped), it fires a real `GET` against the live Supabase REST endpoint (`{SB_URL}/rest/v1/{table}?select=col1,col2,...&limit=1`) using the public anon key from `packages/core/supabase.js`, and asserts a 200 response. PostgREST returns 400 with a "column does not exist" message if any mapped column name is wrong — regardless of RLS, since RLS decides which *rows* come back, not whether the requested column list is valid — so this genuinely proves every column name in the mapping layer matches the real, current schema.

**Scope, honestly stated**: this is schema-shape verification only. It performs no `INSERT`/`UPDATE`/`DELETE`, exercises no RLS policy, no auth flow, no RPC/stored procedure, and no business logic. It would not catch a working column name pointing at the *wrong* semantic data, a broken RLS policy, or a broken Postgres function. It is the automated, permanent version of a manual SQL check that was previously done by hand before this mapping was unified — see the module comment in `packages/data/mapping.js`.

---

## 6. End-to-end tests — `tests/e2e/apps.spec.js` (1 file, 4 tests)

Playwright, run against a real production build served by `vite preview`. All four tests are unauthenticated entry-screen smoke checks — none of them log in or exercise any authenticated app behavior:

- **Client Portal**: the "you need your personal link" state renders when no `?id=` is present, including the exact instructional text (`portal/?id=YOUR-ID`); a garbage `?id=not-a-real-id&type=landlord` does not crash the app (waits 2s, asserts no console/page errors).
- **Employee App**: the phone+PIN login screen renders (`#login-phone`, `#login-pin` visible) with zero console errors. (Confirms there is no email/password login path for this app — phone+PIN is the only one.)
- **Office App**: the email/password login screen renders (`#login-email`, `#login-password`, `#login-btn` visible) with zero console errors.

Every test asserts `errors` (collected from both `page.on('pageerror')` and any `console.error`) has length zero — so a test can "pass" on visible elements while still catching a background JS error that didn't break rendering.

**Historical note**: this file was originally written as a migration-parity check comparing the old flat-file apps against the new Vite build during the July–August 2026 rebuild; now that the old root-level `index.html`/`engineer.html`/`client-portal.html` are retired, it's the permanent regression baseline for "does each app's entry screen still render."

**Known build-time quirk (not a test failure)**: running the e2e suite triggers a full `vite build`, which currently prints a non-fatal warning — `Unable to parse HTML; parse5 error code unexpected-character-in-attribute-name` at `apps/office/index.html:3448`, from an inline code sample in the Settings page's help text containing a literal `<` inside an attribute-like string. Vite proceeds and produces a correct build regardless; this is a build-log warning, not a test failure, and none of the 4 tests are flaky because of it.

No known flaky or skipped tests were found anywhere in the suite — a repo-wide search for `.skip(`, `.todo(`, `xit(`, `xdescribe(` across `tests/` returned nothing, and all 63 tests (50 + 9 + 4) passed on a clean run.

---

## 7. Manual, live-browser verification

Alongside the automated suite, this codebase has a real and consistently-applied practice: **every non-trivial change is manually verified live in the browser against the real backend before being considered done** — not as a replacement for the automated tests, but in addition to them, specifically to catch the class of bug the automated suite structurally cannot (wiring bugs like a function never exposed on `window` for an inline `onclick` handler, a service worker registered at the wrong path, a UI state that renders but is unreachable). This is visible directly in the commit history, e.g.:

- `7a38190` ("Fix 10 broken UI actions..."): *"All fixes verified live in the browser (each function callable with zero errors; credit-note add/edit/remove produces correct totals; sw.js serves 200 in dev and lands in dist/portal/ on build) — **not just grep-confirmed**. Build, 50 unit tests, 9 integration tests all pass."* — automated tests and live verification reported together, explicitly as complementary, not either/or.
- `996143f` ("Add read caching..."): *"Verified live against the real backend (create → immediately visible, delete → immediately gone) plus 8 new unit tests covering the TTL, invalidation, and copy-on-read behavior."*
- `de29876` ("Add invoice preview to job modal..."): *"Found and fixed three pre-existing bugs while cross-checking this live in the browser"* — bugs found this way include a template-literal typo that silently rendered `${...}` instead of real numbers, and a function missing from the `window` exposure list that made an existing button silently dead.

Why this matters as a documented practice, not just incidental commentary: this codebase's known bug class — a handler wired to `onclick="fn()"` in inline HTML that was never added to the app's `Object.assign(window, {...})` exposure block — throws no visible error and produces a silently dead button. Neither the unit suite (no DOM) nor the current e2e suite (only checks unauthenticated login screens) would catch this on an authenticated page. Live-browser verification is the only current check that does.

**For a new developer**: after making a change, the practical equivalent of this practice is — run the app locally (`npm run dev`), actually click through the specific feature you changed and its immediate neighbors, and check the browser console for errors, before considering the change done. This is expected, not optional, even when the automated suite passes.

---

## 8. CI

Full pipeline detail lives in [19-deployment.md](19-deployment.md). Brief summary: `.github/workflows/ci.yml` runs a `build-and-test` job on every push to `main` and every pull request — `npm ci` → `npm run build` → `npm run test:unit` → `npm run test:integration` → install Chromium → `npm run test:e2e`, in that exact order. A separate `deploy` job (publish `dist/` to GitHub Pages) only runs on a push to `main`, and only `needs: build-and-test` — so a failure in any test tier blocks the deploy, and a PR that fails any tier shows as a failing check but cannot deploy anything regardless.

---

## 9. Known gaps — what the automated suite does *not* cover

Stated plainly, not padded with hypothetical future philosophy:

- **`packages/business/dates.js` has zero test coverage.** This is the DST-sensitive date-math module (`daysDiff`, `localDateStr`, `formatDateUK`) that exists specifically because naive UTC-based date handling produced off-by-one-day bugs around BST transitions — exactly the kind of subtle, easy-to-regress logic that most needs a test, and currently has none.
- **The entire `packages/ui` rendering/PDF layer is untested** — `invoice-template.js`, `pat-template.js`, `pdf-vector.js`, `network-canvas.js`, `escaping.js` (~750 lines combined). This is the code that generates the invoice PDF and the PAT certificate PDF; recent real-world PDF quality bugs (missing font, near-blank continuation pages, oversized files — commit `184d266`) were found and fixed through manual inspection of generated PDFs, not caught by any test, because none exist for this layer.
- **No Edge Function has any test.** All 5 functions in `supabase/functions/` (`extract-cert-data`, `send-email`, `create-checkout-session`, `stripe-webhook`, `rewrite-notes`) are untested by anything in this repo. This includes the AI photo-scan certificate-data extraction function (`extract-cert-data` — reads a photo, calls Gemini or falls back to OCR.space to pre-fill the Add Certificate form) and the Stripe payment webhook — both meaningful, side-effecting, external-API-dependent code paths with zero automated coverage.
- **The e2e suite only covers unauthenticated entry screens.** All 4 Playwright tests check that a login/entry screen renders without console errors; none of them log in or exercise a single authenticated workflow (job creation, certificate generation, invoicing, the offline queue, Realtime sync). Everything past the login screen in all three apps is currently reachable only through manual testing.
- **No visual regression testing.** `screenshot: 'only-on-failure'` exists purely for failure debugging, not for diffing against a baseline — a CSS regression that doesn't throw a console error would pass every current test.
- **No accessibility testing** (no `axe-core`/`jest-axe` or equivalent) and **no cross-browser or mobile-viewport testing** (Playwright is configured for desktop Chromium only).
- **The integration suite verifies schema shape, not data correctness or RLS.** See §5 — it cannot catch a broken RLS policy, a working column pointing at the wrong data, or a broken Postgres RPC function.
- **No load/performance testing** of any kind (Supabase Free-tier limits are tracked manually — see the Supabase usage dashboard work referenced in recent commits — not via automated load tests).

None of this is a criticism of the manual-verification practice in §7, which is real and does catch a meaningful class of bug the automated suite can't — but it means the safety net for the areas above is a developer's own attention at change time, not a regression-proof automated check that runs on every future PR.
