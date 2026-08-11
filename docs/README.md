# DeepFlow — Documentation

DeepFlow is the job, compliance-certificate, and invoicing system used by **GB Electrical**, a UK electrical / gas-safety / fire-safety contracting business (NICEIC-registered — [gbelectricals.co.uk](https://gbelectricals.co.uk)). It replaces spreadsheets, paper job sheets, and WhatsApp messages with three web applications sharing one live database, covering the full lifecycle of a job: scheduling, engineer dispatch, on-site completion, certificate generation (Gas Safety, EICR, Fire Alarm, Emergency Lighting, PAT Testing, EPC, Legionella), invoicing, and client-facing visibility for the landlords, agencies, and agents whose properties are being worked on.

This page is the index. It doesn't explain how anything works in detail — every linked document does that. Start here to find out *which* document has what you need.

## What DeepFlow is, in one table

| Audience | App | What they do with it |
|---|---|---|
| Office staff (admin, finance, management) | **Office App** | Schedule jobs, manage the client/property directory, raise invoices and credit notes, track certificate expiry, run financial and engineer-performance reports |
| Field engineers | **Engineer App** | See their day's jobs, update job status on-site, log hours, take before/after photos, request overtime/leave, use built-in electrician calculators |
| Landlords, letting agencies, individual agents | **Client Portal** | View their own jobs, certificates, and invoices, pay invoices online, and raise new job requests — no account needed |

## The three apps, at a glance

DeepFlow is a **Vite monorepo** — one `npm run build` produces three static sites from one shared codebase, deployed together to GitHub Pages. There is no application server; all three apps talk directly to Supabase from the browser.

| App | Entry point | Size (main.js + feature modules) | Deployed as |
|---|---|---|---|
| Office | `apps/office/index.html` → `apps/office/main.js` | main.js (~14.5k lines) plus 12 extracted feature modules (`certs.js`, `directory.js`, `audit.js`, `maps.js`, `engineer-reports.js`, `statements.js`, `expenses.js`, `credit-notes.js`, `invoice-custom-text.js`, `sql-guide.js`, `master-xlsx-export.js`, `backup-diagnostics.js`) | `dist/office/` |
| Engineer | `apps/engineer/index.html` → `apps/engineer/main.js` | main.js (~1.9k lines) plus small focused modules (`map.js`, `requests.js`, `photos.js`, `calc-tools.js`, `geo-weather.js`, `quick-notes.js`, `on-my-way.js`, `guide.js`) | `dist/engineer/` |
| Portal | `apps/portal/index.html` → `apps/portal/main.js` | main.js (~1.2k lines) plus `certs.js`, `invoice-pdf.js`, `properties.js`, `request-wizard.js`, `hero-canvas.js` | `dist/portal/` |

Two more things live in the build but aren't one of the three apps:
- `apps/public/index.html` is DeepFlow-the-product's own marketing/landing page (Vite's default `apps/public/` → publicDir behavior copies it to the dist root).
- `sites/gbelectricals/` is a separate, self-contained marketing site for the GB Electrical business itself — not part of the Vite build, deployed independently of everything above.

`main.js` staying large in Office is a deliberate outcome, not neglect: the Jobs/Invoices logic was investigated for extraction and found to have no safe seam (see the architecture and roadmap docs for why). Everything that *could* be safely pulled out already has been.

## How the pieces fit together

- **Shared code** lives in `packages/` and is imported by all three apps via Vite aliases (`@core`, `@data`, `@business`, `@ui`, `@auth`, `@pdf`, `@offline`):
  - `@core` — the Supabase client and environment/config handling
  - `@business` — the job/invoice `STATUS` enum, invoice-total math, date helpers, and other domain rules
  - `@data` — the camelCase↔snake_case field-mapping layer and per-table repository functions (`dGet`/`dAll`/`dPut`/`dDel`)
  - `@ui` — shared rendering: the invoice PDF template, the PAT certificate template, HTML-escaping helpers
  - `@offline` — the offline write-queue, so a dropped connection in the field never silently loses logged hours or notes
  - `@auth`, `@pdf` — scaffolded with the same READMEs-first discipline as the rest, but deliberately left unpopulated for now (each app's PDF generation and identity handling differ enough that merging them would be a product decision, not a safe refactor)
- **Backend**: one shared Supabase project (Postgres, Free tier) — database, auto-generated REST API, Auth, file storage, and Realtime, with no custom server of any kind.
- **Build & deploy**: Vite builds all three entry points in one pass (`vite.config.js`, `root: 'apps'`); CI (`.github/workflows/ci.yml`) runs the build plus the full test suite (`tests/unit`, `tests/integration` on Vitest; `tests/e2e` on Playwright) on every push and PR, and deploys `dist/` to GitHub Pages only after everything passes.

## Documentation map

### Architecture
| Doc | What's in it |
|---|---|
| [01-system-architecture.md](architecture/01-system-architecture.md) | The monorepo shape, how the three apps and `packages/` fit together, build/deploy pipeline |
| [02-office-app.md](architecture/02-office-app.md) | Office App structure and feature modules, screen by screen |
| [03-engineer-app.md](architecture/03-engineer-app.md) | Engineer App structure, PWA/offline behavior, field tools |
| [04-client-portal.md](architecture/04-client-portal.md) | Client Portal structure, unauthenticated/token-based access model |
| [05-database.md](architecture/05-database.md) | Schema, tables, relationships |
| [06-supabase.md](architecture/06-supabase.md) | How Supabase is configured and used: Auth, Storage, Realtime, RLS |
| [07-sql-migrations.md](architecture/07-sql-migrations.md) | Migration history and conventions (`supabase/migrations/`) |
| [08-authentication-and-roles.md](architecture/08-authentication-and-roles.md) | Office/Engineer login (Supabase Auth) vs. Portal's token+PIN model, roles and permissions |
| [09-storage.md](architecture/09-storage.md) | File storage: certificate PDFs, job photos, buckets and access rules |

### Business
| Doc | What's in it |
|---|---|
| [10-business-rules.md](business/10-business-rules.md) | The domain rules that actually govern the product — job/invoice status transitions, auto-invoice eligibility, VAT/totals |
| [11-workflows.md](business/11-workflows.md) | End-to-end pipelines: job → certificate → invoice, engineer completion, client requests |
| [12-synchronization.md](business/12-synchronization.md) | How data stays consistent across the three apps sharing one database |
| [13-pat-certificates.md](business/13-pat-certificates.md) | PAT Testing certificate generation specifically — numbering, PDF output, known quality fixes |
| [14-certificate-and-invoice-numbering.md](business/14-certificate-and-invoice-numbering.md) | Reference-number schemes for certificates and invoices (landlord vs. agency series) |

### API
| Doc | What's in it |
|---|---|
| [15-apis.md](api/15-apis.md) | The Supabase-generated REST API surface DeepFlow relies on, and any edge functions |

### UI
| Doc | What's in it |
|---|---|
| [16-ui-documentation.md](ui/16-ui-documentation.md) | Shared UI conventions and the `@ui` package's rendering templates |

### Security
| Doc | What's in it |
|---|---|
| [17-security.md](security/17-security.md) | Security posture and audit history |
| [18-known-issues.md](security/18-known-issues.md) | Open issues, including anything accepted as a Free-tier limitation |

### Ops
| Doc | What's in it |
|---|---|
| [19-deployment.md](ops/19-deployment.md) | Build and deploy pipeline, GitHub Pages hosting, CI |
| [20-testing-and-qa.md](ops/20-testing-and-qa.md) | The real test suite: Vitest unit/integration tests, Playwright e2e |
| [21-supabase-usage-dashboard.md](ops/21-supabase-usage-dashboard.md) | Monitoring Supabase Free-tier usage/limits |

### Planning
| Doc | What's in it |
|---|---|
| [22-future-roadmap.md](planning/22-future-roadmap.md) | What's next |
| [23-developer-onboarding.md](planning/23-developer-onboarding.md) | Practical first steps for someone about to start working in this codebase |
| [24-multi-tenant-kickoff-prompt.md](planning/24-multi-tenant-kickoff-prompt.md) | A ready-to-paste prompt for a *separate* Claude Code session to scope real multi-tenant/SaaS support — not a description of the current (single-tenant) system |

### History
[`docs/history/`](history/) holds archived, point-in-time audit and migration notes (including the pre-Vite architecture audit that drove the July 2026 migration). These are a record of decisions made, not living documentation — nothing there describes the system as it exists today. If a fact in `history/` conflicts with a doc listed above, the doc above wins.

## If you're new here, read in this order

1. **This page** — the map.
2. [10-business-rules.md](business/10-business-rules.md) — what the software is actually *for*, in domain terms, before looking at any code.
3. [01-system-architecture.md](architecture/01-system-architecture.md) — how the three apps, `packages/`, and Supabase fit together.
4. [05-database.md](architecture/05-database.md) and [06-supabase.md](architecture/06-supabase.md) — the shared backend everything sits on.
5. Whichever of [02-office-app.md](architecture/02-office-app.md), [03-engineer-app.md](architecture/03-engineer-app.md), or [04-client-portal.md](architecture/04-client-portal.md) matches the app you're about to work in.
6. [23-developer-onboarding.md](planning/23-developer-onboarding.md) — local setup, running tests, making your first change.

## A note on history

Until July 2026, DeepFlow was three independent, monolithic HTML files (over 1MB each) with all logic inline and no build step. It was rebuilt as the Vite monorepo described above — real modules, a real test suite, and one shared `packages/` layer instead of three copies of the same logic. That earlier architecture is gone from the working tree; it's referenced only in `docs/history/` where it matters for understanding a past decision.
