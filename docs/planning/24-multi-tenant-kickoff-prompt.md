# 24 — Multi-Tenant / Enterprise Transformation: Kickoff Prompt

This is not a description of the current system — it's a ready-to-paste prompt for starting a **new, separate Claude Code session** to scope and build real multi-tenant support for DeepFlow, so it can be sold as a subscription product to other companies instead of being one business's internal tool. Everything below the `---` is meant to be copied as the opening message of that session.

**Why a separate session:** this repo is under active, ongoing maintenance for GB Electrical's live production use in a different, concurrent Claude Code chat. Multi-tenant work is a large, exploratory, higher-risk initiative that shouldn't share a conversation (or a rushed branch) with routine single-org fixes.

---

## Prompt to paste into the new session

I want you to scope and build real multi-tenant / enterprise support for DeepFlow, a job/invoice/compliance-certificate management system currently built and hardcoded for one business (GB Electrical). The goal: let me onboard *other* companies as separate customers, each with their own isolated data and branding, on paid subscription plans — turning this from an internal tool into a real SaaS product.

**Read this first, in this order, before proposing anything:**
1. `docs/README.md` — the documentation map and how the system fits together
2. `docs/architecture/01-system-architecture.md` — the monorepo shape (Office/Engineer/Portal apps + shared `packages/`)
3. `docs/architecture/05-database.md` and `docs/architecture/06-supabase.md` — the schema and how Supabase is configured today
4. `docs/architecture/07-sql-migrations.md` — **critical**: the current migrations folder cannot bootstrap a fresh/empty database (zero `CREATE TABLE` statements anywhere, and most of the live schema history isn't captured as files at all). This blocks a real per-tenant provisioning story and needs solving as part of this work, not worked around.
5. `docs/planning/22-future-roadmap.md` §1 — this exact initiative was already scoped once at a high level; treat it as a starting point, not the final word, and verify its claims against current source rather than trusting it blindly (the codebase has moved since it was written).
6. `docs/security/18-known-issues.md` and `docs/security/17-security.md` — current security posture, so you're not rebuilding on top of unknown gaps
7. `packages/core/supabase.js` — the actual hardcoded connection point (`SB_URL`/`SB_KEY` as string literals) that has to become tenant-aware
8. `docs/architecture/08-authentication-and-roles.md` — current login model (Office: real Supabase Auth; Engineer: custom phone+PIN; Portal: no login at all) — all three need a tenant dimension added, not just a company-switcher bolted on

**Ground rules — read before writing any code:**
- **Verify, don't assume.** Every doc above was accurate when written but this is a live, actively-changing codebase with a second session editing it concurrently. Re-check anything load-bearing against current source before relying on it — grep for the real thing, read the real file, query the live database. This has repeatedly caught real drift in this project; don't skip it.
- **This is exploratory, architecture-level work.** Use plan mode (or equivalent) and get my explicit sign-off on the big decisions below before implementing. Don't start writing migrations or refactoring `packages/core` on your own judgment call for these.
- **Work on a dedicated long-lived branch, never `main`.** The other session pushes to `main` regularly for GB Electrical's live production use. Don't push to `main`, and don't assume `main` is static — pull before you start, and expect it to have moved by the time you're ready to merge.
- **Don't touch GB Electrical's live behavior.** Whatever you build must not change what the current single tenant experiences until I explicitly decide to cut over. If a change is genuinely two-way-door (e.g. adding a nullable `tenant_id` column with a default that makes existing rows behave identically), fine — anything that isn't, flag it rather than doing it.
- **Never push to `main`, merge, or deploy without asking me first**, independent of how confident you are — this is a bigger, slower-moving initiative than routine fixes and deserves a real go/no-go conversation at each major milestone, not a single end-of-session summary.

**Two architecture decisions I need to make with you before implementation — come with a real recommendation and trade-offs for each, don't default silently:**

1. **Tenant isolation model.** Shared Supabase project with `tenant_id` scoping + RLS on every table, vs. one Supabase project per tenant (closer to what exists today, just repeated), vs. something else. This affects the migrations-baseline work, RLS design, cost, and operational complexity very differently — lay out the real trade-offs for DeepFlow's actual scale and my situation (I'm not a large engineering team) rather than picking whichever is architecturally purest.

2. **How subscription billing relates to the *existing* Stripe integration.** DeepFlow already has real Stripe wiring today (`create-checkout-session`, `stripe-webhook`) — but that's for *a tenant's own clients* paying *that tenant's* invoices, not for me charging tenants a subscription to use DeepFlow at all. Those are two different Stripe relationships (possibly even two different Stripe accounts — mine for platform subscriptions, each tenant's own for their client payments, à la Stripe Connect) and conflating them would be a real design mistake. Work out and propose how these coexist before building either.

**What "done" looks like, roughly** (refine this with me, don't treat it as fixed spec): a new company can sign up, go through a real setup wizard (company details, branding, cert types, first admin user) without me touching SQL by hand, gets fully isolated data from every other tenant, pays me a subscription to keep using it, and none of this is visible to or affects GB Electrical's existing usage.

Start by proposing your plan for the two architecture decisions above — don't start implementing yet.

---

## Notes for whoever reads this later

- If GB Electrical's own trading name ever changes, that's a *much* smaller, separate task (make sure nothing hardcodes the current business name — as of 2026-08-09 this was checked and cleaned up: `apps/office/main.js`'s WhatsApp template previews were the only hardcoded fallback strings found, now generic). Don't conflate that small task with the multi-tenant initiative above — they're unrelated in scope even though both were prompted by the same conversation.
- `PROTECTED_ADMINS`/`EMERGENCY_ADMINS` in `apps/office/main.js` hardcode specific *people's* email addresses as an anti-lockout safety mechanism (deliberate, not a bug — see `docs/security/17-security.md`'s audit history). That's a different category from company-name branding and will need its own explicit design decision in a multi-tenant world (per-tenant protected owner accounts, presumably) — don't assume it just needs deleting.
