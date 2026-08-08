# 06 — Supabase

How DeepFlow uses Supabase-the-platform: client configuration, Auth, Row Level Security, Storage, Realtime, and an overview of the six Edge Functions. This document does not repeat the table/column/relationship content of [05-database.md](05-database.md) or the migration-history findings of [07-sql-migrations.md](07-sql-migrations.md) — it assumes both, and links back to them rather than duplicating.

**Methodology:** every claim below was checked directly against either the live project (`dzqyqpuhxdrrpipbehpk`, via the Supabase MCP server's `get_advisors`, `list_tables`, `list_edge_functions`, `get_project`, and direct `execute_sql` queries against `pg_policies`/`pg_proc`/`storage.buckets`/`storage.objects`) or the real application source (`packages/core/supabase.js`, the `supabase/functions/*/index.ts` files, and `apps/office`, `apps/engineer`, `apps/portal` — grepped for `supabase.auth.`, `.channel(`, `sbStorage`, `.storage.from(`, `createSignedUrl`, `getPublicUrl`). Nothing here is inferred from the old `docs/06_Supabase.md` or carried over from assumption.

As [07-sql-migrations.md §3](07-sql-migrations.md#3-live-vs-repo-the-folder-is-also-missing-36-migrations-that-were-actually-applied) establishes, the repo's `supabase/migrations/` folder is missing 36 of the 45 migrations actually applied to the live project — including most of the security-hardening work (the `c1`–`c5`, `h1`, `m1`–`m9`, `l1` severity-coded migrations). Where this document describes current RLS/security posture, it's describing **what `get_advisors`, `pg_policies`, and `pg_proc` show live today** — not what the 9 repo migration files alone would suggest. Where a specific uncaptured migration's *name* is relevant, it's cited from that table (its SQL isn't available to read — said so honestly at each point, not guessed).

---

## 1. Client Setup

The Supabase connection — URL, anon key, and the raw REST fetch primitive — lives in one place: `packages/core/supabase.js`. All three apps import from it; nothing else in the codebase declares its own copy (confirmed by grepping for `SB_URL =`/`SB_KEY =` across every `.js` file — the only hits are `packages/core/supabase.js:16-17`).

```js
// packages/core/supabase.js:16-18
export const SB_URL = 'https://dzqyqpuhxdrrpipbehpk.supabase.co';
export const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'; // anon key, JWT-encoded
```

- `createSupaAuthClient()` (`packages/core/supabase.js:26-28`) wraps `createClient(SB_URL, SB_KEY)` — used by the Office App and Engineer App for real Supabase Auth sessions. The Client Portal never calls this (confirmed: no `supabase.auth.` hits anywhere under `apps/portal`) — it has no Supabase Auth session concept at all.
- `makeJwtResolver()` (`packages/core/supabase.js:34-43`) returns a `getJWT()` helper: resolves the current session's access token, falling back to the bare anon key (`SB_KEY`) if there's no session.
- `restFetch()` (`packages/core/supabase.js:55-73`) is the shared raw `fetch(...)` wrapper for PostgREST calls — every app's own `sb()`/`_sb()` helper is a thin, app-specific wrapper around this.

### The hardcoded URL/key is a deliberate gap, not an oversight

`SB_URL` and `SB_KEY` are **string literals compiled into the bundle**, not read from an environment variable (`import.meta.env.*`, `process.env.*`, or any build-time injection — none of those patterns appear anywhere in `packages/core/supabase.js` or the three apps' Vite configs). Every deployed build of every app, for every environment, points at the same one Supabase project.

**Why this is safe in practice today:** `SB_KEY` is the Supabase **anon** key — it identifies the request as coming from an unauthenticated/public client, not a privileged one, and by itself grants no access beyond what RLS policies allow for the `anon`/`authenticated` roles. Section 3 below shows RLS is enabled on all 21 `public` tables with no blanket-access policy remaining. Shipping this key in a public bundle is the same trust model Supabase documents for the anon key generally: it's meant to be public, and the database-level policies are what actually gate access — not secrecy of the key. The real secrets (`SUPABASE_SERVICE_ROLE_KEY`, Stripe/Resend/Gemini keys) live only server-side, as Edge Function secrets (Section 7), never in any app bundle.

**Why this is a real gap for future work:** hardcoding means there is currently no way to point a build at a *different* Supabase project without editing this source file — there's no per-environment config (no staging/prod split, no per-customer project for a future multi-tenant or self-hosted deployment). This is the same gap [07-sql-migrations.md §4](07-sql-migrations.md#4-what-a-genuine-fresh-install-would-need) documents from the migrations side (no baseline schema to replay against a fresh project) and [`docs/planning/23-developer-onboarding.md` §A5](../planning/23-developer-onboarding.md#a5-the-supabase-connection-hardcoded-not-env-var-driven) documents from the onboarding side. All three are describing the same one architectural fact from different angles. Fixing it — env-var injection, a per-tenant config layer, whatever the eventual design is — is a separate, deliberate roadmap item; it is not designed or attempted here.

---

## 2. Auth Model — Summary

Full detail belongs in `08-authentication-and-roles.md` (being written alongside this document) — this section only establishes what was verified, so the two docs don't drift.

Grepping `supabase.auth.` and the custom RPC call site across all three apps shows **three different auth models in the same codebase**, not one:

| App | Mechanism | Evidence |
|---|---|---|
| Office App | Real Supabase Auth, email+password | `_supaAuth.auth.signInWithPassword({email, password})` — `apps/office/main.js:1328`. Also uses `auth.signOut()` (`:1402`, `:1408`, `:1619`), `auth.resetPasswordForEmail()` (`:1479`), `auth.getSession()` (`:12840`). |
| Engineer App | **Dual-mode**: real Supabase Auth (password-mode) *or* custom phone+PIN | `_isTokenAuth()` (`apps/engineer/main.js:216`) checks `currentUser?.authMode==='token'` to decide per-session which path is active. Token-mode login calls `rpc/engineer_pin_login` (`apps/engineer/main.js:545`), a `SECURITY DEFINER` RPC that verifies the PIN server-side (bcrypt, via `pgcrypto`) and returns a `users.session_token`, sent on every subsequent request as an `x-engineer-token` header instead of a Supabase JWT. |
| Client Portal | Always anonymous | No `supabase.auth.` call anywhere under `apps/portal`. The portal identifies its visitor by the row's own `id` in the URL (`?id=...&type=landlord|agency|agent`) plus, where enabled, a `portal_pin_*` RPC-verified PIN (Section 4). |

This split explains why several Edge Functions (Section 7) check *both* an `Authorization: Bearer <JWT>` header *and* an `x-engineer-token` header before treating a caller as authenticated — a password-mode engineer carries the former, a token-mode engineer carries the latter, and neither can be assumed absent.

See [08-authentication-and-roles.md](08-authentication-and-roles.md) for the full login flow, role/permission model, and PIN lifecycle (not duplicated here).

---

## 3. Row Level Security

### 3.1 Coverage

`list_tables` against `dzqyqpuhxdrrpipbehpk` confirms RLS is enabled on all 21 `public` tables, with no exceptions:

```
users, persons, agencies, agents, jobs, certs, invoices, job_comments, activity,
attachments, engineer_requests, engineer_alerts, app_settings, payments,
cert_reminder_log, expenses, overtime, audit_log, portal_contacts, invoice_audit,
push_subscriptions
```

`push_subscriptions` is enabled with **zero policies** (confirmed both via `list_tables`/`pg_policies` and via `get_advisors`'s `rls_enabled_no_policy` lint, INFO level) — an RLS-enabled table with no policy defaults to deny-all for every role except `service_role`. That's consistent with it being schema for the not-yet-application-wired Web Push feature (see [05-database.md §3.17](05-database.md#317-push_subscriptions)); the `send-push` Edge Function (Section 7) reads/writes it using the service-role key, which bypasses RLS entirely, so the missing policies don't block it.

### 3.2 The `df_access` catch-all — what it was, and confirming it's actually gone

Historically, a policy named `df_access` existed on multiple tables with the logic "any authenticated user OR any valid engineer token gets `ALL` access" — a blanket bypass that made every more carefully role-scoped policy on the same table moot, since Postgres RLS OR-combines permissive policies. The one repo migration that touches it, `supabase/migrations/20260720142205_tighten_df_access_catchall_rls_policies.sql`, removed it from 6 tables (`jobs`, `users`, `attachments`, `engineer_requests`, `engineer_alerts`, `app_settings`) and replaced it with role-scoped equivalents.

That migration's own header names the exact bug: *"any logged-in user of ANY role (including Finance/Staff/Viewer, who the application's own UI already restricts) could read, insert, update, or delete ANY row in these tables by calling the Supabase REST API directly, bypassing the app's client-side permission checks entirely."*

This session queried `pg_policies` directly for any policy named `%df_access%` across `public` — **zero rows returned.** `df_access` is completely gone from the live project today, not just from the 6 tables the repo migration touched. Per [07-sql-migrations.md §3](07-sql-migrations.md#3-live-vs-repo-the-folder-is-also-missing-36-migrations-that-were-actually-applied), the uncaptured `20260722142233_c1_scope_catchall_rls_to_office` migration is the most likely place the remaining removals happened — named consistently with a "Critical finding 1" fix — but its SQL isn't available to read, so that's a reasonable inference from the naming pattern and the live end-state, not a verified read of that file's contents.

### 3.3 Current pattern: role-check helper functions, `STABLE`-marked

Every current policy checks one of five small `SECURITY DEFINER` helper functions rather than inlining role logic per-policy. Their live source (`pg_proc.prosrc`, read directly):

```sql
-- is_office()
SELECT EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role != 'engineer' AND active = true);

-- is_engineer()
SELECT EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'engineer' AND active = true);

-- my_engineer_name()
SELECT name FROM users WHERE auth_id = auth.uid() AND role = 'engineer' AND active = true LIMIT 1;

-- is_valid_engineer_token() / my_token_engineer_name()
-- (apps/engineer's x-engineer-token equivalent of the two above — reads
--  request.headers->>'x-engineer-token', matches it against users.session_token
--  where role='engineer', active=true, session_expires in the future)
```

`supabase/migrations/20260720174522_mark_rls_helper_functions_stable.sql` marks all five `STABLE` instead of Postgres's default `VOLATILE`. Its own comment states why: these are deterministic within a single statement (the calling user's identity can't change mid-query), but as `VOLATILE` functions "were being re-evaluated by the planner on every single row an RLS-protected query touched, instead of once per query" — flagged in an earlier Data Layer audit (Finding 8) but not fixed until this migration. `STABLE` lets Postgres cache the result and reuse it across rows.

**Separately**, the direct `auth.uid()`/`current_setting()` calls that appear *inline inside policy `USING`/`WITH CHECK` clauses* (not inside these helper functions) are wrapped in `(select ...)` — e.g. `jobs_office_delete`'s qual reads `... AND (users.auth_id = ( SELECT auth.uid() AS uid)) ...` rather than a bare `auth.uid()`. This is the standard Supabase RLS performance pattern (an "initplan" the planner evaluates once instead of once per row) and is the fingerprint of the uncaptured `20260725180218_m9_wrap_rls_auth_calls_for_perf` migration named in [07-sql-migrations.md §3](07-sql-migrations.md#3-live-vs-repo-the-folder-is-also-missing-36-migrations-that-were-actually-applied) — its SQL isn't available to read directly, but the live policy definitions show the pattern applied consistently across every policy that references `auth.uid()` or `current_setting()` directly (verified by reading every policy's `qual`/`with_check`, Section 3.4). Confirming this actually worked: `get_advisors` (performance) run live in this session returned **zero `auth_rls_initplan` lint results** — the specific warning this pattern exists to silence.

Together, `STABLE` marking (function-level result caching) and `(select ...)` wrapping (initplan caching for calls not behind a function) are two different mechanisms achieving the same "evaluate once per query, not once per row" goal — the schema uses both, on the parts of the policy logic where each applies.

### 3.4 Full live policy reference

42 policies across 20 tables (`push_subscriptions` has none, Section 3.1), read directly from `pg_policies`. Grouped by table; `qual`/`with_check` logic is paraphrased where verbose, verbatim where short.

| Table | Policy | Cmd | Role(s) | Logic |
|---|---|---|---|---|
| `activity` | `activity_client_requests` | INSERT | anon | unrestricted insert (portal activity logging) |
| | `activity_office_all` | ALL | authenticated | `is_office()` |
| `agencies` | `agencies_office_only` | ALL | authenticated | `is_office()` |
| `agents` | `agents_office_only` | ALL | authenticated | `is_office()` |
| `app_settings` | `portal_settings_read` | SELECT | anon | `key = '__all__'` |
| | `settings_office_only` | ALL | authenticated | `is_office()` |
| `attachments` | `attachments_engineer_own` | ALL | authenticated | `is_engineer()` AND `jobid` in jobs where `engineer = my_engineer_name()` |
| | `attachments_engineer_token` | ALL | public | `is_valid_engineer_token()` AND `jobid` in jobs where `engineer = my_token_engineer_name()` |
| | `attachments_office_all` | ALL | authenticated | `is_office()` |
| | `clients_view_own_attachments` | SELECT | public | `jobid` in jobs whose `client_person_id`/`client_agency_id` resolves from the session's `app.portal_token` setting (portal read path) |
| `audit_log` | `audit_log_office_only` | ALL | authenticated | `is_office()` |
| `cert_reminder_log` | `cert_reminder_log_office_all` | ALL | authenticated | `is_office()` |
| `certs` | `certs_engineer_read` | SELECT | authenticated | `is_engineer()` |
| | `certs_engineer_token_read` | SELECT | public | `is_valid_engineer_token()` |
| | `certs_office_all` | ALL | authenticated | `is_office()` |
| `engineer_alerts` | `engineer_alerts_office_all` | ALL | authenticated | `is_office()` |
| | `engineer_alerts_token` | ALL | public | `is_valid_engineer_token()` |
| `engineer_requests` | `eng_requests_engineer_own` | ALL | authenticated | `is_engineer()` AND `engineer_name = my_engineer_name()` |
| | `eng_requests_engineer_token` | ALL | public | `is_valid_engineer_token()` AND `engineer_name = my_token_engineer_name()` |
| | `eng_requests_office_all` | ALL | authenticated | `is_office()` |
| | `portal_requests_insert` | INSERT | anon | unrestricted insert (portal "book a job"/leave requests) |
| `expenses` | `expenses_office_only` | ALL | authenticated | `is_office()` |
| `invoice_audit` | `invoice_audit_office_insert` | INSERT | authenticated | unrestricted insert |
| | `invoice_audit_office_read` | SELECT | authenticated | `is_office()` |
| `invoices` | `invoices_office_all` | ALL | authenticated | `is_office()` |
| `job_comments` | `job_comments_office_only` | ALL | authenticated | `is_office()` |
| `jobs` | `jobs_engineer_own` | SELECT | authenticated | `is_engineer()` AND `engineer = my_engineer_name()` |
| | `jobs_engineer_token_select` | SELECT | public | `is_valid_engineer_token()` AND `engineer = my_token_engineer_name()` |
| | `jobs_engineer_token_update` | UPDATE | public | same, for UPDATE |
| | `jobs_engineer_update_own` | UPDATE | authenticated | `is_engineer()` AND `engineer = my_engineer_name()` |
| | `jobs_office_delete` | DELETE | authenticated | `is_office()` AND (`can_delete = true` OR `role IN ('admin','manager')`) |
| | `jobs_office_insert` | INSERT | authenticated | unrestricted insert |
| | `jobs_office_select` | SELECT | authenticated | `is_office()` |
| | `jobs_office_update` | UPDATE | authenticated | `is_office()` |
| `overtime` | `overtime_office_only` | ALL | authenticated | `is_office()` |
| `payments` | `payments_office_only` | ALL | authenticated | `is_office()` |
| `persons` | `persons_office_only` | ALL | authenticated | `is_office()` |
| `portal_contacts` | `portal_contacts_office_write` | ALL | authenticated | `is_office()` |
| | `portal_contacts_public_read` | SELECT | public | `true` (unrestricted read — portal chrome content) |
| `users` | `users_engineer_own_read` | SELECT | authenticated | `is_engineer()` AND `auth_id = (select auth.uid())` |
| | `users_engineer_token_own_read` | SELECT | public | `is_valid_engineer_token()` AND `session_token` matches the `x-engineer-token` header |
| | `users_office_all` | ALL | authenticated | `is_office()` |

This total (42) matches [05-database.md §7](05-database.md#7-row-level-security--summary)'s per-table policy-count summary exactly — that table was generated independently from `pg_policies` counts, this one from the full policy definitions; they agree.

### 3.5 `SECURITY DEFINER` RPCs — the anon/authenticated split

`get_advisors` (security) flags every `SECURITY DEFINER` function callable by `anon` or `authenticated` as a WARN-level `*_security_definer_function_executable` finding — expected and by design here (these RPCs are the entire mechanism behind Client Portal and Engineer PIN sessions, which have no table-level RLS identity of their own to check against). What's actually informative is *which* functions are anon-reachable versus authenticated-only, since that split reveals real, intentional access boundaries:

**Callable by `anon`** (22 functions) — the public-facing surface with no Supabase session required: `engineer_pin_login`, `engineer_pin_self_setup`, `engineer_session_logout`, `is_engineer`, `is_office`, `is_valid_engineer_token`, `my_engineer_name`, `my_token_engineer_name`, `portal_get_agency`, `portal_get_agency_agents`, `portal_get_attachments`, `portal_get_certs`, `portal_get_invoices`, `portal_get_jobs`, `portal_get_person`, `portal_get_requests`, `portal_next_request_ref`, `portal_pin_set`, `portal_pin_status`, `portal_pin_verify`, `portal_push_subscribe`, `portal_push_unsubscribe`.

**Callable by `authenticated` but *not* `anon`** (11 additional functions — a real, verifiable boundary, not just "everything is open"): `check_cert_reminder_setup`, `engineer_allow_pin_reset`, `engineer_pin_clear`, `engineer_pin_set`, `get_auth_users`, `next_agn_num`, `next_cr_num`, `next_inv_num`, `next_job_num`, `next_proforma_num`, `portal_pin_reset`.

That split lines up exactly with what [05-database.md §6](05-database.md#6-portal-access-portal_token-vs-portal_pin_hash) describes about the PIN reset flow: **`portal_pin_set`** (the client setting their own PIN) is anon-callable, because the portal visitor has no session — but **`portal_pin_reset`** (office staff force-resetting someone's PIN) is authenticated-only. The document-number generators (`next_job_num`, `next_inv_num`, etc.) and admin-facing functions (`get_auth_users`, `engineer_pin_clear`, `engineer_allow_pin_reset`) are correctly restricted to logged-in Office/Engineer sessions, not exposed to the public API at all.

**Example — the "resolved identity" pattern** (the mechanism the uncaptured `20260722142348_c2_scope_portal_rpcs_to_resolved_identity` migration is named for; its SQL isn't available to read, but the live function definition shows the pattern it implies). `portal_get_jobs`'s actual current body, read via `pg_get_functiondef`:

```sql
CREATE OR REPLACE FUNCTION public.portal_get_jobs(p_type text, p_id text)
 RETURNS SETOF jobs
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_name text; v_email text;
BEGIN
  IF p_type = 'landlord' THEN
    SELECT name INTO v_name FROM persons WHERE id::text = p_id;
    RETURN QUERY SELECT * FROM jobs
      WHERE client_person_id::text = p_id
         OR (v_name IS NOT NULL AND lower(landlordname) = lower(v_name))
      ORDER BY date DESC;
  ELSIF p_type = 'agency' THEN ...
  ELSIF p_type = 'agent' THEN ...
  END IF;
END;
$function$
```

The RPC takes only a `type`/`id` pair, resolves the matching name **server-side** from the `persons`/`agencies`/`agents` table itself, and only then does the case-insensitive name-fallback match (`lower(...) = lower(...)`, consistent with the uncaptured `20260805072152_make_portal_name_matching_case_insensitive` migration named in 07's table) — it never trusts a client-supplied name directly. This mirrors the `client_person_id`-then-name-fallback resolution [05-database.md §4.2](05-database.md#42-the-loose-reference-pattern--client_person_idclient_agency_id-and-why-its-not-a-real-fk) describes for `jobs`/`invoices`, and the identical two-step check `create-checkout-session` (Section 7) implements independently for Stripe payments.

The `harden_helper_function_search_paths` and `tighten_office_only_rpc_grants` uncaptured migrations (named in [07-sql-migrations.md §3](07-sql-migrations.md#3-live-vs-repo-the-folder-is-also-missing-36-migrations-that-were-actually-applied)) are consistent with what's visible live: every `SECURITY DEFINER` function checked in this session has an explicit `SET search_path TO 'public'` (or `'public, extensions'` for the two that need `pgcrypto`) — the standard mitigation for the classic search-path-hijacking attack against `SECURITY DEFINER` functions.

---

## 4. Live Security & Performance Advisors

Run directly against `dzqyqpuhxdrrpipbehpk` in this session (not carried over from a prior audit document).

### Security (`get_advisors`, type `security`)

57 total lint results, falling into exactly three categories:

| Category | Count | Level | Assessment |
|---|---|---|---|
| `rls_enabled_no_policy` | 1 (`push_subscriptions`) | INFO | By design — Section 3.1 |
| `anon_security_definer_function_executable` / `authenticated_security_definer_function_executable` | 55 (22 anon + 33 authenticated) | WARN | By design — Section 3.5. This is the mechanism behind Client Portal and Engineer PIN sessions, not an oversight. |
| `auth_leaked_password_protection` | 1 | WARN | *"Supabase Auth prevents the use of compromised passwords by checking against HaveIBeenPwned.org. Enable this feature to enhance security."* Consistent with prior project security-review history: a known, accepted gap tied to the project's plan tier (Leaked Password Protection is a paid Auth add-on), not re-verified against billing in this session but not newly discovered either. |

No `rls_disabled_in_public`, no unrestricted table with a missing owner-scoping policy, and no other finding types appeared.

### Performance (`get_advisors`, type `performance`)

Two categories, both low-severity given the current data state:

- **`unused_index`** (INFO) on `idx_jobs_invoice`, `jobs_postcode_idx`, `idx_agents_agencyid`, `idx_jobs_portal`, `idx_certs_expiry` — expected right now: per [05-database.md §1](05-database.md#1-current-data-state), every one of these tables is empty following the 2026-08-06 data reset, so no index has had a chance to be used yet. Not a signal to drop them.
- **`multiple_permissive_policies`** (WARN) on `attachments`, `certs`, `engineer_alerts`, `engineer_requests`, `jobs`, `portal_contacts`, `users` — a real, minor performance cost (Postgres must evaluate every permissive policy for a given role/action, even when only one would ultimately allow the row), but not a security issue: each table's overlapping policies are still each individually correct in isolation (e.g. `jobs`'s `authenticated`/`SELECT` action is covered by `jobs_engineer_own`, `jobs_engineer_token_select`, and `jobs_office_select` — three different, non-overlapping-in-practice audiences sharing one role/action pairing at the Postgres level). Consolidating these into fewer, `CASE`-style policies is a real, available optimization, not attempted here.
- **Zero `auth_rls_initplan` results** — confirms Section 3.3's claim that the `(select auth.*())` wrapping pattern is applied consistently across the live policy set.

---

## 5. Storage — Summary

Full inventory and access-pattern detail belongs in `09-storage.md` (a sibling doc) — this section is a brief, verified summary so this document isn't silent on Storage entirely.

- **One bucket:** `deepflow` (`storage.buckets`, live-queried: `public = true`, no `file_size_limit`, no `allowed_mime_types` restriction).
- **Folder convention** (from the real upload call sites, not guessed): `jobs/<jobid>/<timestamp>-<rand>.<ext>` for job photos (`apps/engineer/photos.js:209-211,290-291`), `certs/<certid>/<filename>` for certificate PDFs (`apps/office/certs.js:1537-1538,1631-1632`), `invoices/<invid>/<number>.pdf` for invoice PDFs (`apps/office/main.js:7242`).
- **Upload/delete access is RLS-gated**, via 7 policies on `storage.objects` (live-queried from `pg_policies`): `deepflow_staff_insert`/`_update`/`_delete` (office or engineer, `is_office() OR is_engineer()`) and `deepflow_engineer_token_insert`/`_update`/`_delete` (`is_valid_engineer_token()`), plus one `deepflow_staff_select`.
- **Downloads are not RLS-gated at all — because the bucket is public.** Per Supabase's own documentation (confirmed via `search_docs` in this session): *"When a bucket is designated as 'Public,' it effectively bypasses access controls for both retrieving and serving files within the bucket. This means that anyone who possesses the asset URL can readily access the file."* This matches the code: every upload helper across all three apps (`sbStorage()` in `apps/office/certs.js:134-143`, `apps/engineer/main.js:466-474`, and `_invPdfSbStorage()` in `apps/office/main.js:7227-7236`) returns the **public** URL form (`${SB_URL}/storage/v1/object/public/deepflow/${path}`) after an authenticated upload — never a signed URL. Grepping all three apps for `createSignedUrl`/`getPublicUrl`/`.storage.from(` found **zero matches** — nothing in this codebase uses the Supabase JS client's storage API or ever generates a time-limited signed URL; every stored file (job photo, cert PDF, invoice PDF) is reachable by anyone who has or guesses its URL, indefinitely, with no auth check on the read path. The `storage.objects` SELECT policy above only gates the *authenticated listing/download* API path — it does not apply to a public bucket's direct object URLs.

This is worth flagging plainly: it's the Storage-layer analog of the anon-key point in Section 1 — safe in the sense that URLs aren't guessable at scale (they embed a real job/cert/invoice UUID and, for photos, a timestamp+random suffix), but it is not access-controlled the way the database rows describing those same files are. See `09-storage.md` for the full picture.

---

## 6. Realtime

Exactly one live subscription exists in the codebase — confirmed by grepping `.channel(` across every app and package; the only hit outside documentation is `apps/office/main.js`.

`apps/office/main.js:10704-10736`'s `startRealtimeSync()`:

```js
_rtChannel = _supaAuth
  .channel('jobs-realtime')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, payload => {
    handleRealtimeChange(payload);
  })
  .subscribe((status, err) => { /* ... */ });
```

- Subscribes to **all** events (`*`) on `public.jobs` only — no other table has a live subscription anywhere in the three apps.
- On `SUBSCRIBED`, stops an existing polling fallback (`_notifPollInterval`) and shows a "Real-time" live badge.
- On `CLOSED`/`CHANNEL_ERROR`, falls back to polling (`startLivePoll()`) and retries the Realtime connection after 10 seconds.
- Requires `jobs` to be in the `supabase_realtime` publication — added by `supabase/migrations/20260720100129_add_jobs_to_realtime_publication.sql`, the one repo migration that touches Realtime at all. No corresponding migration (repo or in the uncaptured-36 list from [07-sql-migrations.md §3](07-sql-migrations.md#3-live-vs-repo-the-folder-is-also-missing-36-migrations-that-were-actually-applied)) adds any other table to that publication, consistent with the code-level finding that only `jobs` is subscribed.

Engineer App and Client Portal both poll rather than subscribe — neither has a `.channel(` call.

---

## 7. Edge Functions — Overview

Six functions, all `ACTIVE` (confirmed via `list_edge_functions` against the live project). Full request/response contracts belong in [`docs/api/15-apis.md`](../api/15-apis.md) (a sibling doc covering all API surfaces, not written yet as of this document) — this section names each function, its purpose, and its auth model only.

| Function | Platform `verify_jwt` | Auth actually enforced | Purpose |
|---|---|---|---|
| `create-checkout-session` | false | Manual: Office Supabase JWT, **or** portal `{portalType, portalId}` resolved against the invoice the same two-step way `portal_get_invoices` does | Creates a Stripe Checkout Session for one invoice's outstanding balance and returns its URL. Computes the real total from `invoices.items` itself (`invoices.total` is a dead column — see [05-database.md §3.4](05-database.md#34-invoices--every-kind-of-billing-document)), since trusting the stored column would make every invoice look already paid. Source: `supabase/functions/create-checkout-session/index.ts`. |
| `extract-cert-data` | false | Manual: Supabase JWT only (Office App) | Reads a photographed certificate (or a handwritten PAT appliance log) and returns structured fields — cert number/type/dates, or a list of appliance rows — to pre-fill the Add Certificate form. Tries Gemini (multimodal) first, falls back to OCR.space (text-only) if Gemini is disabled, unconfigured, or fails. Source: `supabase/functions/extract-cert-data/index.ts`. |
| `rewrite-notes` | false | Manual: Supabase JWT **or** `x-engineer-token` (both checked, either accepted) | Cleans up an engineer's rushed on-site notes into clear, professional English via Gemini, preserving every technical fact and never inventing content; no fallback if Gemini is unavailable — the UI surfaces a clear error and leaves the original text untouched. Source: `supabase/functions/rewrite-notes/index.ts`. |
| `send-email` | false | Manual: Supabase JWT only (Office App) | Sends transactional email (invoice emails, cert-expiry reminders, etc.) via either Resend or SendGrid, switched purely by the `EMAIL_PROVIDER` secret. Reply-To is always the office's own address. Source: `supabase/functions/send-email/index.ts`. |
| `send-push` | **true** | Platform JWT check **plus** manual `auth.getUser(jwt)` — the extra check exists because the anon key is itself a validly-signed JWT and would otherwise pass the platform check alone | Sends a Web Push notification to a landlord/agency/agent's registered device(s) (`push_subscriptions`), resolved by fuzzy name match, and prunes subscriptions that report as expired (HTTP 410/404). Its source was recovered into the repo in the commit immediately preceding this document (`57ac519`, per `git log`) — before that it existed live but not in version control. Note: per [05-database.md §3.17](05-database.md#317-push_subscriptions), no application code currently *writes* to `push_subscriptions`, so this function currently has no real subscriptions to send to in production. Source: `supabase/functions/send-push/index.ts`. |
| `stripe-webhook` | false | Stripe's own HMAC signature scheme (`Stripe-Signature` header), verified manually — not a Supabase JWT at all | Receives Stripe's `checkout.session.completed` event, records the payment the same way the Office App's own save-payment flow does, and flips the invoice to `Paid` once the computed total (again, from `items`, not the dead `total` column) is covered. Idempotent via a lookup on `payments.ref = <stripe payment_intent id>`, since Stripe retries webhook delivery at-least-once. Source: `supabase/functions/stripe-webhook/index.ts`. |

Two functions (`create-checkout-session`, `stripe-webhook`) have `verify_jwt` off at the platform level because their callers structurally can't carry a Supabase JWT (an anonymous portal visitor; Stripe itself) — both compensate with their own in-function authorization instead, documented in their own source comments. `send-push` is the only function where the platform-level check is *also* on, layered with its own manual check for the reason given above.

---

## See also

- [05-database.md](05-database.md) — the schema itself: tables, columns, relationships, JSONB shapes
- [07-sql-migrations.md](07-sql-migrations.md) — what's in `supabase/migrations/`, and the 36-migration gap between the repo and the live project that this document's RLS section relies on
- [08-authentication-and-roles.md](08-authentication-and-roles.md) — full login flows, role/permission model, PIN lifecycle (being written alongside this document)
- [09-storage.md](09-storage.md) — full Storage inventory and access-pattern detail (being written alongside this document)
- [`docs/api/15-apis.md`](../api/15-apis.md) — full Edge Function request/response contracts (not yet written)
- [`docs/planning/23-developer-onboarding.md`](../planning/23-developer-onboarding.md) — the hardcoded-connection gap (§A5) and fresh-install gap (§B2), both referenced above
