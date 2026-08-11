# 18 — Known Issues (Open)

This document tracks issues that are genuinely **open** as of this writing — things not yet fixed. It
does not cover security posture broadly or audit history (what's already been found and fixed); that's
[17-security.md](17-security.md) (written alongside this document). Where an item below was already
resolved during this documentation-rebuild session, it is *not* listed here — see the note at the end
of each relevant section confirming what was checked and excluded.

**Methodology:** every item below was checked directly against current source, migrations, or `git log`
— not carried over from the brief that scoped this document. Two items turned out to be more nuanced
than their original description once checked (dead code in §3, the push-notification item in §2); the
write-ups below reflect what was actually found. Nothing in this document is framed as urgent —
everything genuinely urgent found during this session's audit was fixed in the same session (see
[17-security.md](17-security.md) for that history). What remains is real but lower-stakes: documentation
debt, one confirmed dead-code path, and deferred product decisions.

---

## 0. Confirmed fixed this session — not listed below

Spot-checked directly against current source/migrations before writing this document, per its brief.
None of the following appear as open items anywhere below:

| Item | Verified fix |
|---|---|
| `get_auth_users()` role gate | `supabase/migrations/20260808082021_restrict_get_auth_users_to_admin_role.sql` — function now raises `'Not authorized'` unless the caller has an active `admin`-role row, replacing the looser `is_office()` (any active non-engineer role) check. |
| Admin-recovery trigger's dropped `pin` column reference | `supabase/migrations/20260808082027_fix_admin_recovery_trigger_dropped_pin_column.sql` — `auto_create_admin_profile()`'s `INSERT` no longer references the removed `pin` column. |
| Public storage bucket / no signed URLs | `supabase/migrations/20260808_make_deepflow_bucket_private.sql` sets `storage.buckets.public=false` for `deepflow`; all three apps now resolve short-lived signed URLs (`portal-sign-url` Edge Function covers Portal, which has no session of its own to sign with). |
| Portal invoice preview's `pdfUrl` field-name bug | `apps/portal/invoice-pdf.js:56-67` — now reads `inv.pdf_url` (the real column), with an inline comment explaining the old camelCase bug and why it always fell back to client-rebuilt PDF. |
| Proforma not copying `agencyName` | Verified in `apps/office/main.js`'s `createProforma()`/`convertProformaToInvoice()`. |
| Credit notes stripping the wrong prefix / no collision guard | `apps/office/credit-notes.js:80-95` — prefix is now chosen by checking which one (`agencyPrefix` vs `landlordPrefix`) the original invoice number actually starts with, and a `Set`-based collision check runs before returning the generated number. |
| `createStandaloneProforma()`'s misleading `'PR'` argument | Argument dropped; the function now calls `nextJobNum()` honestly. |
| `10-business-rules.md` §1.7 `CR-####` vs `CR###` | Doc corrected. |
| PAT cert PDFs' blank Engineer box for manual certs | New Engineer field added to the manual cert form, used as PDF fallback (`cec7d2a`). |
| Missing `send-push` Edge Function source | Recovered into `supabase/functions/send-push/index.ts`. |

---

## 1. Documentation / operational gaps

These don't put data or access at risk today — they're gaps in reproducibility and process discipline.

### 1.1 No fresh-install-safe baseline migration

`supabase/migrations/` has **zero `CREATE TABLE` statements** across all 12 files currently in the
folder (9 original + 3 captured this session) — every file is an `ALTER`/`CREATE INDEX`/`CREATE
POLICY`/`DROP`-style statement that assumes its target table already exists. Fully analyzed, with
verification commands and both remediation options laid out, in
[`07-sql-migrations.md` §2 and §4](../architecture/07-sql-migrations.md#2-critical-finding-there-is-no-baseline-schema-in-this-folder) —
summarized here, not re-derived.

**Why it matters:** running `supabase db push` or replaying this folder against a genuinely empty
Supabase project fails on the first statement. There is no self-contained way to stand up a second
instance from this repo alone today.

**Effort/risk to close:** low-to-moderate. `07-sql-migrations.md` §4 lays out the fix — a `supabase db
dump --schema public` against the live project, committed as one new earliest-timestamped baseline
file. Not done here; needs to happen *before* any attempt to backfill §1.2's missing migrations, since
some of those alter objects a fresh dump would already capture in final form.

### 1.2 36 of 45 live-applied migrations have no file in the repo

Also fully covered in
[`07-sql-migrations.md` §3](../architecture/07-sql-migrations.md#3-live-vs-repo-the-folder-is-also-missing-36-migrations-that-were-actually-applied),
which pulled the live migration history via the Supabase `list_migrations` tool against
`dzqyqpuhxdrrpipbehpk` and diffed it file-by-file against the repo. 36 migrations applied between
`20260722142212` and `20260805072152` — including what reads as a severity-coded security remediation
pass (`c1`/`c2`/`c5`/`h1`/`m1`-`m9`/`l1` naming) and the entire engineer PIN-login schema — exist live
with no corresponding committed file.

**Not a growing gap:** this session's own 3 new migrations
(`20260808082021`, `20260808082027`, `20260808_make_deepflow_bucket_private`) were each committed as a
file in the same session they were applied, per §1.1's evidence above. The discipline described in
`supabase/migrations/README.md` is being followed going forward; the 36-migration gap is historical
debt, not an active leak.

**Effort/risk to close:** moderate-to-high effort (36 migrations to reconstruct or accept as
unrecoverable into version control), but zero risk to production — this is purely a version-control
completeness gap, not a live-database problem. Closing it is really the same work as §1.1's baseline
dump: once a baseline is captured, the specific historical gap becomes moot for any *new* fresh install,
though the audit-trail gap (knowing exactly what each of the 36 changed) would remain unless
reconstructed separately.

---

## 2. Product / feature gaps

### 2.1 Push notifications: Portal has it, Office and Engineer don't

This document's brief assumed no app had wired up the browser Push API at all. Checking directly
(`apps/portal/main.js`, `apps/office/main.js`, `apps/engineer/main.js`) found that assumption wrong for
one of the three apps:

- **Client Portal has a complete, working push subscription flow.** `initPush()`
  (`apps/portal/main.js:133`, called from `init()` at line 577 on every page load) checks for an
  existing subscription and shows a real "🔔 Get notified on your phone" button
  (`apps/portal/index.html:448-450`) when none exists. `enablePushNotifications()` (`main.js:146-176`)
  requests permission, calls `reg.pushManager.subscribe()`, and persists the result via the
  `portal_push_subscribe` RPC — this is how rows land in `push_subscriptions`. `send-push` delivers
  real pushes from both `apps/office/audit.js`'s `sendPushNotification()` and
  `apps/engineer/main.js`'s equivalent, on job-status-change and cert-ready events. This part is done,
  not planned. (A full write-up, including a note that two other current docs — `05-database.md` §3.17
  and `06-supabase.md`'s Edge Function table — mis-describe this as unwritten-to, is in
  [`12-synchronization.md` §8](../business/12-synchronization.md#8-a-genuine-correction-to-the-sibling-docs-portal-web-push-is-real-wired-two-way-code).)
- **Office and Engineer users have no equivalent subscription flow for themselves.** Both call
  `Notification.requestPermission()` for foreground-only local notifications (tab must be open); neither
  calls `pushManager.subscribe()` or registers a service-worker `push` handler, so neither can receive a
  real push while closed or asleep. Scoped and sized already in
  [`22-future-roadmap.md` §5](../planning/22-future-roadmap.md#5-scoped-feature-extend-real-push-notifications-to-office-and-engineer-users) —
  described there as "mostly a matter of repeating the Portal's pattern," not new server-side work,
  since `send-push`, `push_subscriptions`, and the VAPID keypair already exist and work.
- **Practical bottom line right now:** `push_subscriptions` holds 0 rows in production following the
  2026-08-06 data reset, and push is off by default on the sending side
  (`S.notifPushEnabled` defaults `false`, Settings → Notifications). So even though the Portal's write
  path is real, nothing has actually re-subscribed since the reset — there is currently no live
  subscriber to send to, which is a data/adoption gap, not a missing-code one.

**Why this matters (low severity):** no security exposure — this is a feature-completeness gap. Low
effort to close per the roadmap doc's own estimate, since the hard parts already exist and work in
Portal.

### 2.2 Dead code: the `mo-cert` modal and its three functions

`apps/office/certs.js` exports `openCertModal()`, `openEditCert(id)`, and `openCertModalFromJob()`;
`apps/office/index.html` defines the modal they target (`id="mo-cert"`, lines 4559-4624). Grepped
directly across all of `apps/` for all three function names — the only hits outside `certs.js` itself
are one HTML comment (`index.html:4594`, documentation not a call) and the modal's own Cancel button
(`onclick="closeModal('mo-cert')"` — closing a modal nothing opens). `apps/office/main.js` has zero
references to any of the three names. The single live "Add Certificate" control in the app opens a
different, newer modal (`cf2-*` fields, `openCertForm()`) instead.

This matches a commit message that already flagged it: *"an earlier pass mistakenly targeted the dead
mo-cert modal/openCertModal code path, which is unreachable in production"* (`a6e4209`). Documented in
full, including a second-order bug (the dead modal's appliance table wouldn't even populate correctly
if somehow opened, since `renderApplianceTable()` only targets the live form's table id), in
[`13-pat-certificates.md`](../business/13-pat-certificates.md) and
[`22-future-roadmap.md` §3](../planning/22-future-roadmap.md#3-near-term-dead-code-cleanup-the-mo-cert-modal).

**A deliberate decision was made not to remove this in the current session** (time/risk tradeoff, not a
technical blocker) — it remains sitting in the codebase as unreachable code.

**Why this matters (low severity, ready-to-do):** zero live callers confirmed, so removal cannot break
a working feature. Removing `openCertModal()`, `openEditCert()`, `openCertModalFromJob()`, `saveCert()`,
`extractCertFromPhoto()` (the older, separate photo-extraction function tied to this same dead modal),
and the `mo-cert` markup itself is a self-contained cleanup — low risk, low effort, no edge cases to
chase down.

### 2.3 Loose reference pattern: `client_person_id`/`client_agency_id` unenforced

`jobs.client_person_id`/`client_agency_id` and `invoices.client_person_id`/`client_agency_id` are `uuid`
columns meant to reference `persons.id`/`agencies.id` — but those target columns are `text`, so Postgres
cannot declare a real foreign key across the type mismatch as currently typed. Full detail, including
which half is actually written (`jobs.client_person_id` is, on every job save, via
`_resolveLandlordPerson()`; the other three are never written by any application code and stay `NULL`)
and the name-matching fallback that does the real work in production, is in
[`05-database.md` §4.2](../architecture/05-database.md#42-the-loose-reference-pattern-client_person_idclient_agency_id-and-why-its-not-a-real-fk).

This is longstanding, previously investigated project history — an earlier internal audit
(`docs/19_Future_Roadmap.md`, a superseded root-level doc) tracked closing it as item **M4** ("Add real
foreign-key-based relationships, finishing what `client_person_id`/`client_agency_id` started"). It was
accepted as a deferred, client-side-mitigated item rather than fixed then, and remains so now — the
Client Portal RPCs and the Stripe checkout Edge Function both already implement the ID-first/name-
fallback resolution that mitigates the gap in practice.

**Why this matters (low-to-moderate severity):** not a live vulnerability — the fallback path is
deliberate and functional — but it means data can be linked one way on some rows (jobs, going forward)
and a different, fragile way on others (invoices, and historical jobs), which is a real source of subtle
bugs if the two paths ever disagree. Closing it properly requires backfilling the ID columns, updating
every write path, and only then migrating reads off the name-matching fallback — moderate effort, and a
multi-step migration that needs care given it touches how every invoice/job resolves its client today.

---

## 3. Deferred by product decision

### 3.1 No true multi-tenancy

`packages/core/supabase.js` hardcodes `SB_URL` and `SB_KEY` as string literals rather than reading them
from environment variables — confirmed directly in the file (lines 16-18). This means the same codebase
cannot serve a second company without editing and recommitting source.

**Status:** not an oversight — explicitly scoped as deferred future work by the product owner, who was
asked directly during this session and answered "yes eventually, but sequenced after the audit and
documentation work." Fully written up, including what real multi-tenancy would concretely require, as
the headline item in [`22-future-roadmap.md` §1](../planning/22-future-roadmap.md#1-real-multi-tenant-support-the-headline-item) —
link there rather than re-deriving. Not urgent by design; listed here for completeness since it is,
factually, an open gap in the code today.

---

## 4. Process: unmerged branches — RESOLVED 2026-08-09

Both branches described in the original version of this section (`docs/reorganize-and-archive-history`,
`fix/broken-onclick-handlers-and-portal-sw`) were rebased onto current `main`, verified (build + 50 unit
tests, plus a manual check that neither silently clobbered the other's or `main`'s later changes), merged,
and their PRs closed. Both remote and local copies of the branches were deleted afterward — `main` is now
the only branch in the repo. No open item remains here.

---

## 5. A live secret was found and rotated (2026-08-09) — RESOLVED 2026-08-11

GitGuardian flagged a VAPID private key committed in plaintext in two archived docs
(`docs/history/sql-migration-notes/PHASE6_PUSH_NOTIFICATIONS_SQL.md` and
`PHASE6B_PUSH_EDGE_FUNCTION.md`) — this repo is public, so the key had to be treated as compromised. A
new keypair was generated on 2026-08-09 and the new public key was committed (`apps/portal/main.js`,
`apps/office/main.js`, `apps/engineer/main.js`), but the matching private key was never persisted
anywhere and was subsequently lost before it was set as the live secret — so `send-push` remained broken
regardless. On 2026-08-11 a second, final keypair was generated; the new public key was committed to all
three apps, and the private key was handed directly to the user (never written to any file) to set as the
`VAPID_PRIVATE_KEY` secret on the `send-push` Edge Function. Confirmed working: an unauthenticated test
call to `send-push` returns a clean `401 Unauthorized` from the function's own auth check rather than a
boot-time crash, which it would if `webpush.setVapidDetails()` (called at module load, before any request
handling) had rejected either key. Both cutovers were zero-risk — `push_subscriptions` held 0 rows
throughout, so no existing subscription was ever tied to an old key. Also not done: scrubbing the
original leaked key out of git *history* (the current files are fixed, but the old value is still
recoverable from past commits) — a full rewrite would need a force-push and is a separate, optional
decision, not assumed here.

---

## See also

- [17-security.md](17-security.md) — broader security posture and audit history (what's already been
  found and fixed); written alongside this document
- [`07-sql-migrations.md`](../architecture/07-sql-migrations.md) — full detail behind §1.1 and §1.2
- [`22-future-roadmap.md`](../planning/22-future-roadmap.md) — full detail behind §2.1, §2.2, and §3.1
- [`12-synchronization.md`](../business/12-synchronization.md) — full detail behind §2.1's push-notification correction
- [`05-database.md`](../architecture/05-database.md) — full detail behind §2.3
- [`19-deployment.md`](../ops/19-deployment.md) — full detail behind §4
