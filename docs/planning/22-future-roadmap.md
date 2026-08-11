# 22 — Future Roadmap

This document is forward-looking: real, scoped work that hasn't been built yet, verified against
current source rather than proposed from scratch. It is **not** a bug tracker — open defects, security
gaps, and known limitations belong in [`docs/security/18-known-issues.md`](../security/18-known-issues.md)
(being written separately as part of the same documentation rebuild this document is part of; if it
doesn't exist yet when you're reading this, that's a documentation-sequencing gap, not evidence the
issues it will cover don't exist). Where an item below has a known-issues counterpart, this document
links to it rather than re-describing it.

Nothing bug-fixed during this session's own work — proforma/credit-note numbering, the Storage bucket
policy, `get_auth_users`, the admin recovery trigger, the PAT certificate Engineer field — appears here.
All of that is done, and where relevant is covered in the business/architecture docs, not repeated as
future work.

**Methodology:** every item below was checked directly against current source, migrations, or
`git log`/`git diff` against `origin/main` — not inferred from a planning document or asked-and-assumed.
Where a claim in this document turned out to be more nuanced than expected once checked (the push
notification item, in particular), the finding below reflects what was actually found, not the
original assumption.

---

## 1. Real multi-tenant support — the headline item

DeepFlow is single-tenant today: one hardcoded Supabase project (`dzqyqpuhxdrrpipbehpk`), one company
(GB Electrical), string-literal credentials in `packages/core/supabase.js`. This is documented in full,
with every supporting fact verified, in
[`23-developer-onboarding.md` Part B](23-developer-onboarding.md#part-b--standing-up-a-fresh-instance-for-a-new-company) —
that document is the authoritative account of what standing up a second instance requires *today*
(a developer-assisted fork-and-redeploy, not self-serve). This section is the roadmap framing of the
same gap: what it would take to make that a genuine, supportable product capability instead.

**Status:** explicitly deferred, not undecided. The product owner was asked directly whether to build
real multi-tenancy — env-var-driven Supabase configuration instead of the hardcoded string literals, so
one codebase could serve a second company — during the same session this documentation rebuild was
commissioned in, and was equally explicit on both halves of the answer: **yes, eventually**, but
**sequenced after the audit and documentation work**, not folded into that session. Nothing below is a
commitment to a timeline — it's a record of what the work would concretely involve, so that whenever
it is picked up, it doesn't have to be re-derived from scratch.

**What it would concretely require**, based on the gaps `23-developer-onboarding.md` Part B already
found by walking through a fresh install step by step:

| Piece | What exists today | What real multi-tenancy needs |
|---|---|---|
| Supabase connection | Two string literals (`SB_URL`, `SB_KEY`) in `packages/core/supabase.js`, checked into source control | Environment-variable-driven config (`import.meta.env`/`VITE_`-prefixed vars) read at build or runtime, so a new deployment doesn't require editing and recommitting source |
| Schema provisioning | Manual: read `05-database.md` and 9 partial migration files, reconstruct by hand, or hand-run `supabase db dump` (§2 below) | An actual bootstrap path — at minimum the baseline migration in §2, ideally a provisioning script that runs it against a fresh project unattended |
| First-time setup | None — no admin UI walks a new company through configuring their own instance | A real installation/setup wizard: company details, branding, cert types, initial admin user, all from the Office app itself rather than SQL and source edits |
| Branding/settings isolation | `app_settings` is a **single-row** table (confirmed in [`05-database.md` §3.15](../architecture/05-database.md)) — there's no concept of more than one company's settings coexisting | Either genuine per-tenant row scoping in a shared project, or the current one-Supabase-project-per-company model kept deliberately (a real architectural choice to make, not default into) |
| Edge Functions | 6 functions, 5 committed in-repo; `send-push` is live-only with no committed source (see [`23-developer-onboarding.md` §B5](23-developer-onboarding.md#b5-step-5--edge-functions)) | Per-tenant secrets configuration (Stripe keys, email provider keys, VAPID keys) as a repeatable step, not one-off dashboard entry per instance |

**Deliberately out of scope for this document:** designing the actual mechanism (env var naming,
whether tenancy is row-scoped-shared-project or project-per-tenant, wizard UX). This is a roadmap entry
recording that the work is wanted and roughly what it touches — not a spec. Write the spec when the
work is actually scheduled.

**2026-08-09 — this work is now scheduled, in a separate session.** See
[24-multi-tenant-kickoff-prompt.md](24-multi-tenant-kickoff-prompt.md) — a ready-to-paste prompt for a
dedicated Claude Code session to scope and build this, kept separate from ongoing GB Electrical
maintenance work on purpose.

---

## 2. Near-term: merge the two open feature branches

Two feature branches exist on `origin` with real, finished-looking work that hasn't landed on `main`.
Checked directly via `git log main..origin/<branch>` and `git diff` against the current `main` tip
(`cec7d2a`, 2026-08-08) — both branches are **not** simple fast-forwards; each diverged from `main` at
the same older commit (`9604cdb`) and `main` has since moved 8 commits ahead, so landing either one
needs a real merge/rebase pass, not a one-click merge button.

| Branch | Commit | Date | What it does | Files it touches that `main` has also changed since divergence |
|---|---|---|---|---|
| `fix/broken-onclick-handlers-and-portal-sw` | `7a38190` | 2026-08-06 | Fixes 10 UI actions that were called from inline `onclick=""` handlers but never exposed on `window` (so they silently no-op'd); fixes credit-note add/edit/remove totals; moves `sw.js` from the repo root into `apps/portal/` (co-located with the app that actually registers it — it was 404ing because it never shipped to `dist/portal/`) and adds a Vite `closeBundle` plugin to copy it there on build | `apps/office/main.js`, `apps/office/credit-notes.js`, `apps/engineer/main.js` — real overlap, will need conflict resolution. `vite.config.js` and the `sw.js` move do not overlap with `main`'s recent commits. |
| `docs/reorganize-and-archive-history` | `32bb6d5` | 2026-08-06 | First batch of a documentation cleanup: moves 30 root-level point-in-time audit/planning `.md` files into `docs/history/` (git-mv, history preserved), deletes 3 files confirmed byte-for-byte duplicates of docs already in `docs/` (`BUSINESS_RULES.md`, `SECURITY_AUDIT.md`, `WORKFLOWS.md`), and updates ~10 in-code comment/tooltip references to the old paths | Small (2-7 line) changes in `apps/engineer/main.js`, `apps/office/audit.js`, `apps/office/backup-diagnostics.js`, `apps/office/index.html`, `apps/office/main.js`, `apps/portal/main.js` — path-reference updates, likely low-conflict given how small each diff is |

Both are still fully relevant: `main` has not received either branch's changes (verified —
`docs/history/` doesn't exist on `main`, and `BUSINESS_RULES.md` is still sitting at the repo root).
The `docs/reorganize-and-archive-history` branch's own commit message is worth noting explicitly — it
describes itself as the *first* batch of "a full DeepFlow documentation/architecture audit," with
"full content rewrite of docs/ against current code" as an explicitly-flagged follow-up. That follow-up
is, in effect, what this session and its siblings (`docs/architecture/*`, `docs/business/*`, this
document itself) already are — done a different way, directly on `main`, without the root-level cleanup
this branch would still provide. Merging it doesn't conflict with that work in content, only in the
mechanical sense of the small file-overlaps listed above.

This is near-term work, not speculative future work — both branches are functionally complete; what's
missing is someone reviewing and landing them.

---

## 3. Near-term: dead-code cleanup — the `mo-cert` modal

Confirmed independently by grep (not just cited from `13-pat-certificates.md`, which documents the
same finding in more depth): `apps/office/certs.js` exports `openCertModal()`, `openEditCert()`, and
`openCertModalFromJob()`, and `apps/office/index.html` defines the modal they target
(`id="mo-cert"`, lines 4559-4624). Searching all of `apps/office/index.html` for callers of these three
functions turns up nothing except:

- One HTML comment (`index.html:4594`) referencing `openCertModalFromJob` — documentation, not a call.
- One `onclick` on the modal's own Cancel button, which only calls `closeModal('mo-cert')` — closing
  a modal that's never opened in the first place.

No button, link, or handler anywhere in the live UI opens `mo-cert`. `apps/office/main.js` has zero
references to any of the three function names at all. This matches a commit message that already
flags exactly this (`a6e4209`, quoted in `13-pat-certificates.md` §3): *"an earlier pass mistakenly
targeted the dead mo-cert modal/openCertModal code path, which is unreachable in production."*

**Why this is worth doing, not just noting:** it's low-risk (confirmed zero live callers, so removal
can't break a working feature) and removes a second, non-functional copy of certificate-photo-scan and
appliance-table logic that could otherwise be mistaken for a real extension point — `13-pat-certificates.md`
§3 already warns that the dead modal's appliance table wouldn't even populate correctly if it were
somehow opened, since `renderApplianceTable()` only targets the live form's table id. Removing
`openCertModal()`, `openEditCert()`, `openCertModalFromJob()`, `saveCert()`, `extractCertFromPhoto()`,
and the `mo-cert` modal markup itself is a self-contained cleanup, not a refactor with edge cases to
chase down.

---

## 4. Prerequisite work: a fresh-install baseline migration

Both real multi-tenancy (§1) and any future disaster-recovery restore depend on this gap being closed
first. It's fully analyzed already — see
[`docs/architecture/07-sql-migrations.md` §4](../architecture/07-sql-migrations.md#4-what-a-genuine-fresh-install-would-need)
for the complete finding; summarized here rather than re-derived:

`supabase/migrations/` holds 9 files, and every single one is an `ALTER`/`CREATE INDEX`/`CREATE POLICY`
statement that assumes its target table already exists — `CREATE TABLE` appears zero times across the
folder. Running these against a genuinely empty Supabase project fails immediately on the first
statement. Two real options, neither implemented:

- **(a) Generate one true baseline from the live project** — `supabase db dump --schema public` against
  `dzqyqpuhxdrrpipbehpk`, committed as a new earliest-timestamped migration file. The more reliable
  option, and the one `07-sql-migrations.md` recommends attempting first.
- **(b) Reconstruct by hand** from [`05-database.md`](../architecture/05-database.md) and the existing
  9 files. Slower, more error-prone — `05-database.md` documents the live schema, it wasn't written to
  be mechanically converted back into SQL.

`07-sql-migrations.md` §3 also found a separate, larger gap worth flagging here since it affects how
option (a) should be sequenced: the repo's migration folder is missing 36 migrations that were actually
applied to the live project (80% of its real migration history). A baseline dump should happen *before*
attempting to backfill those, since a schema dump already captures their end state.

---

## 5. Scoped feature: extend real push notifications to Office and Engineer users

The brief for this document assumed no app had ever wired up the browser's Push API — checking that
directly turned up a more specific, more useful finding.

**What's actually built, verified in `apps/portal/main.js`:** the Client Portal has a complete, working
Push API subscription flow. `initPush()` (line 133) registers `./sw.js` and checks for an existing
subscription; `enablePushNotifications()` (line 146) requests notification permission, calls
`reg.pushManager.subscribe({applicationServerKey: VAPID_PUBLIC_KEY, ...})`, and persists the resulting
subscription server-side via the `portal_push_subscribe` RPC — which is how rows land in the
`push_subscriptions` table. There's a real "🔔 Get notified on your phone" control wired to it
(`notif-push-row`/`notif-push-btn`, `apps/portal/index.html:448`). The `send-push` Edge Function then
delivers real pushes to subscribed landlords/agencies/agents — triggered from `apps/office/audit.js`'s
`sendPushNotification()` on job-status-change and cert-ready events, and from `apps/engineer/main.js`
(line 300) on job-status-change. This part of the feature is done, not planned.

**What's genuinely missing:** Office and Engineer users have no equivalent subscription flow for
*themselves*. Both apps call `Notification.requestPermission()` (`apps/office/main.js:10579`,
`apps/engineer/main.js:1599`), but that's the foreground `Notification` API — it only shows a
local notification while the tab is open (the Engineer app polls for new job IDs client-side and shows
one when it sees a change; the Office app does the same for its own events). Neither app calls
`pushManager.subscribe()` or registers a `push` handler in its service worker, so neither can receive a
real, server-sent push while the app is closed or the device is asleep — the exact capability the
Portal app already has.

**Why this is a real, scoped, buildable feature and not speculation:** the hard infrastructure —
`send-push`, `push_subscriptions`, the VAPID keypair, the subscribe-then-persist pattern — already
exists and works, proven by the Portal app using it in production. Extending it to (for example) an
engineer getting a real push when a new job is assigned, or the office getting one for an urgent
engineer alert, is mostly a matter of repeating the Portal's pattern against Office/Engineer's own
service workers and adding an office-side/engineer-side subscribe RPC parallel to
`portal_push_subscribe` — not inventing new server-side capability.

---

## 6. Checked and found not to belong here

In the interest of not padding this document with speculation, two things worth recording as
*checked and ruled out*, since they were plausible candidates:

- **A second historical PAT-TEST data migration.** `13-pat-certificates.md` §7 documents that
  historical PAT-TEST reference numbers were migrated into this database once already, verified against
  8 real historical refs at the time the universal numbering algorithm was built (`c911a47`). A
  repo-wide search for "Firebase," "OHM," and "migrat[ed/ion]" turns up nothing suggesting a further
  migration phase is planned or pending — the one that happened was a one-off, and (per the same
  document) whatever was imported no longer exists in production after the 2026-08-06 data reset. There
  is no evidence of a queued "phase 2" migration to plan for.
- **Populating the `@auth` package.** `packages/core` currently ships `@auth` as a placeholder
  (`export {}` only) — see [`01-system-architecture.md`](../architecture/01-system-architecture.md),
  which notes it's "intended for session/permission-checking primitives shared across apps" but that
  "no app currently imports from `@auth`" today. That's a naming intention, not a scoped plan — there's
  no concrete gap driving it the way there is for the items above, so it isn't listed as a roadmap item
  in its own right. Worth revisiting only if a real duplication between Office's and Engineer's
  permission-checking logic is found later.

---

## See also

- [23-developer-onboarding.md](23-developer-onboarding.md) — Part B is the full, verified account of
  what standing up a fresh instance requires today; §1 above is its roadmap framing
- [`docs/architecture/07-sql-migrations.md`](../architecture/07-sql-migrations.md) — full analysis
  behind §4 above (the baseline-migration gap) and the 36-missing-migrations finding
- [`docs/business/13-pat-certificates.md`](../business/13-pat-certificates.md) — the `mo-cert`
  dead-code finding (§3 above) in its original, more detailed context, and the PAT-TEST migration
  history behind §6's first bullet
- [`docs/architecture/01-system-architecture.md`](../architecture/01-system-architecture.md) — the
  `@auth`/`@pdf` placeholder packages referenced in §6
- [`docs/security/18-known-issues.md`](../security/18-known-issues.md) — open bugs and accepted
  limitations (being written separately); check there for anything that reads like a gap but isn't
  planned work
- [docs/README.md](../README.md) — documentation map and reading order
