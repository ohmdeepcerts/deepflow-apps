# 08 — Authentication and Roles

This document covers WHO can log into each of DeepFlow's three apps, HOW they authenticate, and WHAT they're allowed to see and do once in. It does not re-describe table structure (see [05-database.md](05-database.md)) or general Supabase configuration — Storage, Realtime, full RLS policy text (see [06-supabase.md](06-supabase.md), being written in parallel). Where this document quotes an RLS policy or a function body, it's because that policy/function *is* the access-control mechanism being documented, not a duplication of 06's inventory.

The three apps share one Supabase project (`dzqyqpuhxdrrpipbehpk`) and one `users` table, but implement three genuinely different login mechanisms:

| App | Who | Mechanism |
|---|---|---|
| `apps/office` | Office staff (admin/manager/finance/staff/viewer) | Real Supabase Auth — email + password |
| `apps/engineer` | Field engineers | Custom phone + 6-digit PIN, verified server-side by a `SECURITY DEFINER` RPC, bcrypt-hashed. No Supabase Auth account involved. |
| `apps/portal` | Landlords, agencies, agents (clients) | No account at all. A URL parameter (`?id=`) identifies the entity; an optional 6-digit PIN gate sits in front of it. |

**Methodology:** every login flow below was traced from the actual client code (`apps/office/main.js`, `apps/engineer/main.js`, `apps/portal/main.js`) — not inferred from naming or comments. Every RPC's *live* definition (`pg_get_functiondef`) and grant list (`information_schema.routine_privileges`) was pulled directly from the Supabase project via `execute_sql`, because — as established in [07-sql-migrations.md](07-sql-migrations.md) — the entire engineer PIN-login schema and RPC set (`engineer_pin_login_schema`, `engineer_token_rls_certs_and_storage`, `engineer_pin_login_rpcs`, `fix_engineer_pin_login_ambiguous_column`, `fix_engineer_pin_login_exception_rollback_bug_v2`, `engineer_pin_self_service_reset_flow`) and most of the portal-PIN hardening passes (`fix_portal_pin_rpcs_match_by_token_not_id`, `revert_portal_pin_rpcs_to_match_by_id`, `harden_portal_pin_functions_search_path`, `fix_portal_pin_search_path_include_extensions`) exist only as applied migrations on the live project — there is no `.sql` file in this repo to read them from. Every RLS policy quoted below came from `pg_policies`, live. Nothing here is copied from a migration file or a code comment describing what a function is *supposed* to do.

---

## 1. Office App — Supabase Auth + role-based permissions

### 1.1 Login flow

`doLogin()` (`apps/office/main.js:1314`) does real, server-verified Supabase Auth — not a custom check:

```js
const {data:authData, error:authErr} = await _supaAuth.auth.signInWithPassword({email, password});
```

After a successful sign-in, the app resolves the auth account to an application profile in two steps, both against the `users` table:

1. `users?auth_id=eq.<authUser.id>&select=*` — the normal path once a profile is linked.
2. If that returns nothing, `users?email=eq.<email>&select=*` — a fallback for a `users` row that predates the `auth_id` link, which then self-heals by `PATCH`ing `auth_id` onto that row (`main.js:1358`).

If neither finds a profile and the email isn't a protected admin (§1.5), login is refused with *"Your account exists but has no profile. Ask your Admin to set up your profile in Settings → Users"* and the Supabase session is signed back out (`main.js:1400-1404`) — a valid Supabase Auth account alone is not sufficient to use the app; a matching `users` row is required.

**Password reset** goes through real Supabase Auth too — `doResetPassword()` (`main.js:1472`) calls `_supaAuth.auth.resetPasswordForEmail()`, which emails a reset link; there is no custom password-reset RPC for this app.

**Account provisioning has no in-app "invite" flow.** `addOfficeStaff()` (`main.js:8821`) just shows a toast: *"Use Sync from Supabase to add users."* New office accounts (any role except Engineer) must be created directly in the Supabase Dashboard's Auth → Users first; the Team page's "Sync from Supabase" button then calls a `get_auth_users()` RPC (§1.6) to pull the resulting Auth account into view and let an admin attach a `users` profile row to it. Engineers are the one role provisioned entirely in-app (§2.1) — they never get a Supabase Auth account at all.

### 1.2 The `users` table and roles

One row per person who can log in; office staff and field engineers share the table, told apart by `role`. Live-confirmed column list, RLS, and defaults are in [05-database.md §3.9](05-database.md#39-users--login-accounts) and its Appendix — not repeated here. What matters for this document:

- **`role`** stores lowercase values: `admin`, `manager`, `finance`, `staff`, `viewer`, `engineer` (default `'engineer'`). The Office App maps these to capitalized roles via `roleMap` (`main.js:1414`): `Admin`, `Manager`, `Finance`, `Staff`, `Viewer`, `Engineer` — anything unrecognized falls back to `Staff`.
- **A user with `role='engineer'` is explicitly refused Office App login** — `doLogin()` checks `profile.role==='engineer'` and signs them straight back out with *"Engineer accounts use the Engineer Portal, not this app"* (`main.js:1406-1411`), and `applyUserPermissions()` repeats the same block defensively for the session-restore path (`main.js:1500-1507`).
- Live data (checked via `execute_sql`, per the production reset noted in [05-database.md §1](05-database.md#1-current-data-state)): **exactly one `users` row exists today, `role='admin'`** — the surviving admin account. No manager/finance/staff/viewer/engineer accounts currently exist in the live system.

### 1.3 Role → page access

`_canAccessPage()` (`main.js:549`) is the actual gate — checked before every `nav()` call, not just used to decide what the sidebar shows:

```js
const rolePages={
  Admin: null, // null = all pages allowed
  Manager: ['dash','jobs','inv','stmt','rep','req','dir','props','certs','client','set','map'],
  Finance: ['dash','jobs','inv','stmt','rep','dir','props','set'],
  Staff:   ['dash','jobs','inv','stmt','req','dir','props','certs','client'],
};
```

Plus two page-specific rules layered on top: `set` (Settings) additionally requires Admin/Manager/Finance (Staff/Viewer excluded even though the table above doesn't list them), and `audit` (the Audit Log) is Admin-only regardless of what else a role can reach. `applyUserPermissions()` (`main.js:1488`) drives the matching sidebar visibility per role, and separately gates which Settings sub-tabs are visible (`company`/`notifications`/`data`/`guide`: Admin only; `appearance`/`team`/`trades`/`whatsapp`/`jobs`: Admin+Manager; `invoicing`: Admin+Manager+Finance).

**Viewer** has no entry in `rolePages` at all — it's handled as a fallback nav set inside `applyUserPermissions()` (`dash`,`jobs`,`inv`,`stmt`,`rep`,`dir`,`props`,`certs`,`client`) specifically so the role isn't left navigating a completely blank sidebar; every write/delete/finance permission for Viewer is denied at the permission-check layer instead (§1.4).

### 1.4 Role → write/field permissions

`getUserPerm(perm)` (`main.js:1694`) is the single function every write action and every sensitive field actually checks against:

```js
if(u.role==='Admin') return true;
if(u.role==='Viewer') return false;
if(u.role==='Manager'){
  if(perm==='canManageUsers') return false;
  return true;
}
// Finance and Staff both fall through to here — per-user flag lookup:
if(perm==='seeLandlord')      return u.seeLandlord!==false;
...
if(perm==='canEdit')          return u.canEdit===true;
if(perm==='canDelete')        return u.canDelete===true;
if(perm==='canInvoice')       return u.canInvoice===true;
if(perm==='canFinance')       return u.canFinance===true;
if(perm==='canManageUsers')   return false;
```

The genuinely important detail here: **Finance has no dedicated branch.** It falls through to exactly the same per-user boolean-flag lookup as Staff (`can_edit`/`can_delete`/`can_invoice`/`can_finance`, `see_landlord`/`see_landlord_phone`/`see_agent`/`see_contact`/`see_price` — the individual `users` table columns, set per-person on the Team screen). Finance and Staff differ only in which *pages* they can reach (§1.3), not in how their write permissions are evaluated — a Finance user and a Staff user with identical flag values have identical write permissions.

At login, these per-user flags are read once into `_appUser` (`main.js:1424-1432`) with role-aware defaults layered in — `canFinance` defaults to `true` for Admin/Manager regardless of the stored flag (`isAdmin||isMgr||(profile.can_finance===true)`), `canDelete` defaults to `true` for Admin only.

**Server-side backstop:** almost all of this permission model is UI-only (show/hide, matching [05-database.md](05-database.md)'s "not a second server-side check" note) — with one deliberate exception. The `jobs_office_delete` RLS policy (added in `20260720142205_tighten_df_access_catchall_rls_policies.sql`) genuinely enforces `can_delete=true OR role IN ('admin','manager')` at the database level:

```sql
CREATE POLICY jobs_office_delete ON jobs FOR DELETE TO authenticated USING (
  is_office() AND EXISTS (
    SELECT 1 FROM users WHERE auth_id = auth.uid() AND (can_delete = true OR role IN ('admin','manager'))
  )
);
```

Every other role/permission check in this section — nav visibility, page access, field masking, invoice/finance gating — is enforced only in the client JS. A Staff user calling the REST API directly with their own valid JWT could, for example, still read the `jobs` table's `landlordname` column even though the UI hides it from them, because `is_office()` (the underlying RLS predicate — §1.7) doesn't distinguish between office roles at all, only office-vs-engineer.

### 1.5 Emergency admin fallback — two independent layers

Two hardcoded email constants exist in the client bundle, both currently the same two addresses: `EMERGENCY_ADMINS` (`main.js:8846`) and `PROTECTED_ADMINS` (`main.js:8845`) — `['mandeepdynamics@gmail.com', 'mandeep@gbelectricals.co.uk']`.

- **Client-side (`doLogin()` and the session-restore `bootstrap()`, `main.js:1343-1398` and `main.js:12842-12858`):** if a user signs in successfully via Supabase Auth with one of these emails but has no matching `users` row (or has one whose `role` isn't `admin`), the app fabricates an in-memory admin profile, logs them in as Admin for that session regardless, and fires off a best-effort `POST`/`PATCH` to persist that profile (`.catch(()=>{})` — failure is silently swallowed, so login still succeeds even if the write is rejected by RLS).
- **Database-side, and independent of the app entirely:** a live trigger, `trg_auto_admin` (confirmed via `information_schema.triggers` — **on `auth.users`**, not `public.users`), fires `AFTER INSERT` on `auth.users` and calls `auto_create_admin_profile()`:

```sql
CREATE OR REPLACE FUNCTION public.auto_create_admin_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF lower(NEW.email) = 'mandeepdynamics@gmail.com' THEN
    INSERT INTO users (id, name, email, auth_id, role, active, pin, can_edit, can_delete,
      can_invoice, can_finance, see_landlord, see_landlord_phone, see_agent, see_contact,
      see_price, created)
    VALUES (gen_random_uuid(), 'Admin', 'mandeepdynamics@gmail.com', NEW.id, 'admin', true,
      '0000', true, true, true, true, true, true, true, true, true, extract(epoch from now())::bigint)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$
```

This is meant as a disaster-recovery backstop — if the Auth account for the primary owner's email is ever deleted and recreated, this trigger auto-provisions the matching `users` admin row without needing the client-side fallback at all. **See §5 for why this trigger would currently fail if it ever actually fired.**

The Team page also separately protects these two emails from role changes/removal in the UI (`PROTECTED_ADMINS` check, `main.js:8087-8106`) — a Manager or even another Admin cannot demote or delete a protected admin account through the Team screen.

### 1.6 `get_auth_users()` — how the Team page sees Supabase Auth accounts

Listing raw Supabase Auth users isn't possible via the anon/authenticated key directly, so the Team page's "Sync from Supabase" button calls a project-specific RPC, `get_auth_users()`, confirmed live:

```sql
CREATE OR REPLACE FUNCTION get_auth_users() RETURNS TABLE(id uuid, email text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, public AS $$
BEGIN RETURN QUERY SELECT u.id, u.email::text, u.created_at FROM auth.users u ORDER BY u.created_at DESC; END; $$
```

See §5 for its grant list — it's callable by more roles than the Team page itself is visible to.

### 1.7 `is_office()` / `is_engineer()` — the actual RLS boundary

Every office-vs-engineer RLS distinction in the schema ultimately reduces to these two `STABLE SECURITY DEFINER` functions (live-confirmed):

```sql
CREATE OR REPLACE FUNCTION public.is_office() RETURNS boolean ... AS $function$
  SELECT EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role != 'engineer' AND active = true);
$function$;

CREATE OR REPLACE FUNCTION public.is_engineer() RETURNS boolean ... AS $function$
  SELECT EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'engineer' AND active = true);
$function$;
```

`is_office()` returns `true` for **any** non-engineer role — Admin, Manager, Finance, Staff, and Viewer are indistinguishable at this layer. Every role/permission distinction within "office" (§1.3, §1.4) is enforced above this boundary, in the client, with the single exception noted in §1.4.

---

## 2. Engineer App — phone + PIN (not Supabase Auth)

### 2.1 Login flow

Confirmed directly in `apps/engineer/main.js`: there is no email/password field anywhere in this app, and no `_supaAuth.auth.*` call exists in it at all. `doPinLogin()` (`main.js:533`) sends phone + PIN straight to a Postgres RPC:

```js
const rows = await sb('rpc/engineer_pin_login',{method:'POST',body:{p_phone:phone,p_pin:pin}});
```

Live definition of `engineer_pin_login(p_phone text, p_pin text)` (`SECURITY DEFINER`, `search_path = public, extensions`):

- Looks up `users WHERE phone = p_phone AND role = 'engineer' AND active = true`. No match → generic `'Invalid phone or PIN'` (does not reveal whether the phone number exists).
- If `pin_hash IS NULL` (no PIN set yet): returns `needs_setup: true` if `pin_reset_allowed` is also true (routes the client to `_showPinSetup()`), otherwise `'Not authorised to log in — ask your office to grant you access'` — a deactivated/never-granted engineer gets a clean refusal, not a setup prompt.
- If `pin_locked_until > now()`: refused with `'Too many attempts — try again later'` (§2.4).
- PIN format is validated server-side (`^[0-9]{6}$`) — not trusted from the client.
- Verification is real bcrypt: `crypt(p_pin, rec.pin_hash) <> rec.pin_hash`, via the `pgcrypto` extension (hence `search_path` including `extensions`).
- On success: mints `new_token := encode(gen_random_bytes(32), 'hex')` (a 256-bit random hex token, not a JWT), sets `session_expires := now() + 90 days`, resets the fail counter, and returns `{ok:true, session_token, session_expires, eng_id, eng_name}`.

First-time setup goes through the sibling RPC `engineer_pin_self_setup(p_phone, p_new_pin)` — same shape, but only succeeds if `pin_hash IS NULL AND pin_reset_allowed = true`; it hashes the new PIN with `crypt(p_new_pin, gen_salt('bf'))` and immediately issues a session, identical to a normal login.

### 2.2 What the `session_token` actually is

- **Storage:** `localStorage` — `df_eng_token`, alongside `df_eng_user` (the JS `currentUser` object) and `df_eng_sess_expires` (`main.js:515-517`). Restored on reload via `_isTokenAuth()`/`authMode==='token'` checks (`main.js:1774-1788`).
- **Lifetime:** 90 days from issuance (`extract(epoch FROM now())::bigint + 90*24*60*60`), hardcoded server-side inside the RPC — not client-configurable.
- **Transport:** sent as a custom `x-engineer-token` request header on every subsequent API call (`main.js:221,239,461`), not as a Supabase Auth `Authorization: Bearer` JWT. The engineer's actual Supabase REST calls authenticate as the **anon key** (`authToken = tokenAuth ? SB_KEY : await _getJWT()`, `main.js:220`) — identity is proven entirely by the `x-engineer-token` header being checked server-side, not by who the anon key belongs to.
- **What makes it valid:** two `STABLE SECURITY DEFINER` RLS helper functions read that header directly out of `request.headers` and check it against `users.session_token`:

```sql
-- is_valid_engineer_token()
SELECT count(*) INTO v_count FROM users
WHERE session_token = v_token AND role = 'engineer' AND active = true
  AND session_expires > extract(epoch from now())::bigint;
RETURN v_count > 0;
```

  `my_token_engineer_name()` does the equivalent lookup to resolve *which* engineer, and is what scopes `jobs_engineer_token_select`/`jobs_engineer_token_update` to rows where `engineer = my_token_engineer_name()` — an engineer's token only ever grants access to jobs assigned to their own name (a plain string match, per [05-database.md §4.1](05-database.md) — `jobs.engineer` is not a foreign key).

- **Revocation is immediate and real, not just a UI state:** clearing `session_token` server-side (via `engineer_pin_clear`, §2.5, or `engineer_session_logout` on manual sign-out) makes `is_valid_engineer_token()` start returning `false` on the very next request — RLS then returns zero rows rather than an error, which is why the app separately runs `_checkSessionAlive()` (`main.js:646`) polling the engineer's own `users` row every so often, specifically to detect "still logged in client-side but the server just cut me off" and force a client-side sign-out with a toast, rather than leaving a stale session sitting on screen.

### 2.3 Rate limiting / lockout

Handled entirely inside `engineer_pin_login` itself, same shape as the Client Portal's PIN gate (§3.4): on a wrong PIN, `pin_fail_count` increments; at **5** failures, `pin_locked_until := now() + 15 minutes` is set and every subsequent attempt is refused with `'Too many attempts — try again later'` regardless of whether the PIN entered is now correct, until the lockout expires. A successful login resets `pin_fail_count` to 0.

**The predecessor rate-limiting fix, confirmed live:** an older RPC, `verify_engineer_login(p_email, p_hash)`, still exists in the database (its definition is still readable via `pg_get_functiondef`) but is no longer callable by the app or by any anonymous/authenticated client — `information_schema.routine_privileges` shows `EXECUTE` granted only to `postgres` and `service_role` today, not `anon`/`authenticated`. This matches the `h1_revoke_dead_verify_engineer_login_rpc` migration named in [07-sql-migrations.md](07-sql-migrations.md)'s missing-migrations table (`h1` = the naming convention's apparent "High-severity finding 1"). Reading its body explains why revoking it mattered: it took a plaintext client-computed hash (`p_hash`) and compared it against a `users.pin` column with **no lockout, no attempt counter, and no format check** — a genuinely weaker mechanism than `engineer_pin_login`'s bcrypt-plus-5-attempt-lockout, sitting right next to it and (before the revoke) independently callable. Confirmed by grep: no file in `apps/` calls `verify_engineer_login` today — it was already dead code in the client before the grant was revoked, so revoking `EXECUTE` closed a real gap (an un-rate-limited login path reachable directly via the REST API, bypassing the app entirely) rather than breaking anything.

### 2.4 Office-side session controls

Four RPCs, all `is_office()`-gated server-side (confirmed — each starts `IF NOT is_office() THEN RAISE EXCEPTION`), reachable from the Team screen's per-engineer action buttons:

| Action | RPC | Effect |
|---|---|---|
| 🔄 Reset PIN | `engineer_pin_clear(p_id, p_allow_reset:=true)` | Clears `pin_hash`/`session_token`/`session_expires`/fail state; sets `pin_reset_allowed=true` → engineer is logged out immediately and lands on the self-setup screen next visit. |
| 🚫 Force Logout | `engineer_pin_clear(p_id, p_allow_reset:=false)` | Same clear, but `pin_reset_allowed=false` → engineer is logged out **and blocked** ("not authorised") until access is explicitly re-granted. |
| Grant access | `engineer_allow_pin_reset(p_id, p_allow:=true)` | Sets `pin_reset_allowed=true` without touching an existing PIN — used to re-open a blocked account. |
| 🗑 Remove | direct `PATCH users` (client-side, not an RPC) | `active:false`, plus the same PIN/session clear, plus `phone:null` — frees the phone number for reuse by a different engineer while deactivating this row. RLS (`is_office()`) still protects this write. |

The office **never sees or transmits an actual PIN** through any of this — comment at `main.js:8723-8726` confirms the app has no code path that reads a PIN value back from the database; an engineer always sets their own via the self-setup screen.

---

## 3. Client Portal — no account, ID + PIN

### 3.1 How a client reaches their data

`apps/portal/main.js:113`: `export const token=P.get('id'), ptype=P.get('type')||'landlord';` — the entire identity of a portal visitor is two URL query parameters, `?id=<uuid>&type=landlord|agency|agent`. There is no login form, no email, no password, no Supabase Auth session anywhere in this app — confirmed by the complete absence of any `_supaAuth`/`auth.` reference in `apps/portal/main.js`. Every request authenticates as the plain **anon key** (`SB_KEY`, via `restFetch`).

This matches [05-database.md §6](05-database.md#6-portal-access-portal_token-vs-portal_pin_hash): the `portal_token` columns on `jobs`/`agencies` are dead/unreferenced — the real "credential" is simply the row's own `persons.id`/`agencies.id`/`agents.id`, handed out as the portal link itself (e.g. `portal/?id=<id>&type=landlord`, per the in-app "email this link" template at `main.js:415,541`). Anyone holding that link can open the portal for that entity; nothing about the ID format makes it expire or get revoked on its own.

### 3.2 How the entity behind an ID is resolved

Confirmed live — three narrow, single-purpose `SECURITY DEFINER` RPCs, one per entity type, each returning at most the one row asked for by primary-key match and nothing else:

```sql
-- portal_get_person(p_id text)   → SELECT * FROM persons  WHERE id::text = p_id;
-- portal_get_agency(p_id text)   → SELECT * FROM agencies WHERE id::text = p_id;
-- portal_get_agency_agents(p_agency_id text) → SELECT * FROM agents WHERE agencyid::text = p_agency_id ORDER BY name;
```

The in-app comment at `main.js:479-481` explicitly documents this replaced an earlier, more dangerous version: *"Was a direct, unscoped `agencies?id=eq...` read — now a narrow SECURITY DEFINER function that only ever returns the one row asked for, matched server-side."* One asymmetry worth noting: the `agent` branch (`ptype==='agent'`) never calls a resolving RPC at all — it builds `entity={name:decodeURIComponent(P.get('name')), type:'agent', id:token}` directly from URL parameters (`main.js:500-506`), trusting the `name` query param for display purposes only. This doesn't widen data access (every subsequent RPC call is still scoped by `id` alone, resolved server-side against the real `agents` table — see §3.3), so an invalid or spoofed `name` param just produces a portal page with a wrong-looking heading, not access to any other agent's data.

### 3.3 Data scoping — job/invoice/attachment/cert access

Once the entity is resolved, everything else the portal fetches is scoped by that entity's `id` server-side, inside `SECURITY DEFINER` functions — confirmed live for `portal_get_jobs`/`portal_get_invoices` (attachments and certs use the same job-ID-scoped pattern via `portal_get_attachments(p_job_ids)`/`portal_get_certs(p_job_ids)`, called only after `portal_get_jobs` has already returned this entity's own job IDs). This is the mechanism [05-database.md §4.2](05-database.md#42-the-loose-reference-pattern) describes from the schema side; here is what it actually does, live, for `landlord`:

```sql
IF p_type = 'landlord' THEN
  SELECT name INTO v_name FROM persons WHERE id::text = p_id;
  RETURN QUERY SELECT * FROM jobs
    WHERE client_person_id::text = p_id
       OR (v_name IS NOT NULL AND lower(landlordname) = lower(v_name))
    ORDER BY date DESC;
```

Two independent match paths, tried together: the real `client_person_id` FK-style column (populated on every job save since `_resolveLandlordPerson()`, per 05-database.md), **or** a case-insensitive name match against the job's free-text `landlordname` field. `portal_get_invoices` does the equivalent three-way OR against `clientname`/`landlordname` (or `agencyname`)/`billtoname` for invoices, since (per 05-database.md) `invoices.client_person_id`/`client_agency_id` are never actually written by any app code — the name-match fallback is doing all the real work for invoices today, not just backstopping it. The `agency`/`agent` branches follow the same two-path (or, for `agent`, name-or-email) pattern.

**This is exactly the iteration trail 07-sql-migrations.md's missing-migration table implies** — `c2_scope_portal_rpcs_to_resolved_identity`, `fix_portal_jobs_invoices_partial_link_bug`, and `make_portal_name_matching_case_insensitive` are all consistent with what's live today: an ID-first, name-fallback resolution that has clearly been tightened more than once (partial-link-bug fix, case-insensitivity fix) without ever fully retiring the name-matching path, because the underlying `client_person_id`/`client_agency_id` backfill on `invoices` was never done.

### 3.4 The PIN gate — `portal_pin_verify`/`portal_pin_set`/`portal_pin_status`

Because the `?id=` link alone has no expiry and no revoke, a 6-digit PIN sits in front of it, stored per-entity (`persons`/`agencies`/`agents` all carry `portal_pin_hash`/`portal_pin_fail_count`/`portal_pin_locked_until`). `ensurePortalPin()` (`main.js:296`) gates the whole app: unset PIN → forced to `_pinRenderSetup()`; wrong table for a locked account → `_pinRenderLocked()`; otherwise → `_pinRenderEntry()`. A verified session is remembered only in `sessionStorage` (`df_portal_pin_ok_<token>`, tab-scoped, not persisted across browser restarts), and a 20-second poll (`_startPinWatchdog()`) detects an office-triggered PIN reset mid-session and re-locks the tab without waiting for a reload.

Live definition of `portal_pin_verify(p_table, p_id, p_pin)` (`SECURITY DEFINER`, dynamic `EXECUTE format(...)` against whichever of `persons`/`agencies`/`agents` the caller specifies, restricted by an explicit `IF p_table NOT IN (...) THEN RAISE EXCEPTION`):

- No PIN set (`stored IS NULL`) → `false` (routes the client back to setup, not entry).
- `portal_pin_locked_until > now()` → `false` without even checking the submitted PIN.
- Verified via `pgcrypto`'s `crypt(p_pin, stored) = stored`.
- Same 5-attempts-then-15-minutes lockout shape as the Engineer app's `engineer_pin_login` (§2.3) — `fails >= 5` sets `portal_pin_locked_until := now() + interval '15 minutes'`.
- A correct PIN resets the fail counter; the office can only **reset** (clear) a PIN, never see the value — same one-way `crypt()` hash pattern as everywhere else in this schema.

If `portal_pin_status` fails to reach the server at all (e.g. RPC not deployed), `ensurePortalPin()` **fails open** — `main.js:304-307` explicitly lets the visitor through rather than lock out every existing link on a transient error, a deliberate availability-over-strictness choice called out in the code comment itself.

### 3.5 What actually isolates one client from another

Two layers, stacked:

1. **The `?id=` value itself** — a real (v4-format) UUID, per [05-database.md §2](05-database.md#2-conventions-common-to-every-table); not sequential or guessable. Knowing one landlord's portal link gives no way to derive another's.
2. **The PIN**, once set — the only thing that survives a leaked/forwarded link. Before a PIN is set, the ID alone is the entire access boundary (by original design, per §3.4's fail-open behavior and the `_pinRenderSetup()` flow existing specifically to close that gap on first real visit).

Both `attachments_engineer_token` (raised in the task brief) and the RLS layer around Storage were checked directly: `attachments_engineer_token` is an **Engineer**-app policy (`ALL TO public USING (is_valid_engineer_token() AND jobid IN (jobs WHERE engineer = my_token_engineer_name()))`, from `20260720142205_tighten_df_access_catchall_rls_policies.sql`) — it scopes an engineer's *own* token to their *own* assigned jobs' attachments, and has no portal-side role at all. The Client Portal never touches `attachments` via direct RLS-gated REST access; it goes exclusively through `portal_get_attachments(p_job_ids)` (§3.3), a `SECURITY DEFINER` RPC that bypasses RLS entirely and is scoped purely by the job-ID list `portal_get_jobs` already resolved for that visitor. See §5 for a separate, older `attachments` RLS policy that appears to predate this RPC-based design and looks orphaned.

---

## 4. Roles and permissions — summary across all three apps

| App | Role | Authenticates via | Sees | Can do | Notable restriction |
|---|---|---|---|---|---|
| Office | **Admin** | Supabase Auth (email+password) | Everything | Everything, incl. Settings, Team, Audit Log, role changes | Own admin role can't be self-demoted from Team screen |
| Office | **Manager** | Supabase Auth | Dash/Jobs/Invoices/Statements/Reports/Requests/Directory/Properties/Certs/Client/Settings/Map | Same effective write access as Admin (`getUserPerm` grants everything except `canManageUsers`) | No Settings→Company/Notifications/Data/Guide tabs; cannot manage users; cannot see Audit Log |
| Office | **Finance** | Supabase Auth | Dash/Jobs/Invoices/Statements/Reports/Directory/Properties/Settings | Per-user flags (`can_edit`/`can_delete`/`can_invoice`/`can_finance`, `see_*`) — same evaluation as Staff | No Requests/Certs/Client pages; no Team/Audit |
| Office | **Staff** | Supabase Auth | Dash/Jobs/Invoices/Statements/Requests/Directory/Properties/Certs/Client | Per-user flags, same rule as Finance | No Settings nav item at all; no Reports/Map |
| Office | **Viewer** | Supabase Auth | Dash/Jobs/Invoices/Statements/Reports/Directory/Properties/Certs/Client | Read-only — `getUserPerm` returns `false` for every write/delete/finance/invoice permission unconditionally | Cannot edit anything regardless of per-user flags |
| Office | *(Engineer role on a `users` row)* | — | — | — | Explicitly blocked from Office App login; redirected to use the Engineer App |
| Engineer | **Field Engineer** | Phone + 6-digit PIN → `engineer_pin_login` RPC (bcrypt, server-side) | Own assigned jobs (`jobs.engineer = own name` match), own attachments/certs, shared engineer alerts/requests | Update own job status (incl. two-stage completion — see [05-database.md §3.1](05-database.md#31-jobs--the-central-work-order-record)), upload photos, submit overtime/leave requests | Session token expires after 90 days or immediate office-triggered revoke; 5-attempt/15-min PIN lockout |
| Portal | **Landlord** (`persons`) | `?id=<persons.id>&type=landlord` + optional 6-digit PIN | Own jobs/certs/invoices/attachments only (ID match, falling back to case-insensitive name match) | View, download cert/invoice PDFs, pay via Stripe link, submit a portal request (booking/renewal) | No login persistence beyond `sessionStorage`; PIN gate fails open if the status RPC is unreachable |
| Portal | **Agency** (`agencies`) | `?id=<agencies.id>&type=agency` + optional PIN | Own jobs/certs/invoices, plus a roster of its own `agents` (via `agencyid` FK) | Same as Landlord, plus a per-agent filter view | Same PIN mechanics |
| Portal | **Agent** (`agents`) | `?id=<agents.id>&type=agent&name=<display name>` + optional PIN | Jobs/invoices matched by agent name/email (no `client_*_id` FK path exists for agents) | Same view/pay/request actions | Entity identity for this branch is resolved entirely inside the scoped RPCs, not by an upfront lookup RPC (§3.2) |

---

## 5. Known gaps — observed directly, not inferred

Everything below was independently confirmed via `execute_sql` or grep during this review, not assumed from a comment or a migration name.

1. **The disaster-recovery admin trigger (`auto_create_admin_profile()`, §1.5) references a `pin` column that no longer exists on `public.users`.** `information_schema.columns` for `public.users` (checked live) lists `pin_hash`, `pin_fail_count`, `pin_locked_until`, `pin_reset_allowed` — but no plain `pin` column. The trigger's `INSERT INTO users (..., pin, ...)` would raise `column "pin" does not exist`, and because it's an `AFTER INSERT` trigger on `auth.users` with no exception handling, that error would propagate and roll back the triggering statement — i.e. **if the primary admin's Supabase Auth account is ever deleted and re-created, account creation itself would likely fail** rather than silently skip the profile auto-provisioning it was written to guarantee. This wasn't executed/tested (creating a real `auth.users` row is outside the scope of a documentation review), but the column-list mismatch is directly verified, not speculative. The client-side fallback in `doLogin()`/`bootstrap()` (§1.5) is a separate, independent mechanism and is unaffected by this — it doesn't depend on this trigger at all.

2. **`get_auth_users()` (§1.6) is grantable to any `authenticated` session, not just Admin/Manager.** `information_schema.routine_privileges` shows `EXECUTE` granted to `authenticated` (plus `postgres`/`service_role`) with no role check inside the function body itself. The Team page that calls it is UI-gated to Admin/Manager (§1.3), but any logged-in office user of any role — Finance, Staff, or Viewer — could call `supabase.rpc('get_auth_users')` directly and get every Supabase Auth account's `id`/`email`/`created_at`. Low severity (no password data, no PIN hashes — just account existence and email addresses) but a real gap between the app's own access model and what the database actually permits.

3. **A likely-orphaned RLS policy on `attachments`:** `clients_view_own_attachments` (`SELECT`, role `public`) still exists live, gated on `current_setting('app.portal_token', true)` matching `persons.portal_token`/`agencies.portal_token` with `portal_enabled=true`. A full-repo grep found no `set_config`/`app.portal_token` call anywhere — nothing ever sets that session variable, and (per [05-database.md §6](05-database.md#6-portal-access-portal_token-vs-portal_pin_hash)) `portal_token`/`portal_enabled` are themselves confirmed dead columns. This policy appears to predate the current `portal_get_attachments()` RPC-based design (§3.3, §3.5) and can never actually grant access today — not a live security hole (it fails closed, since the setting is never set), just leftover surface area from an earlier portal-access design that was never cleaned up.

4. **`verify_engineer_login` (§2.3) still exists in the database** — de-granted (`EXECUTE` revoked from `anon`/`authenticated`, confirmed live), not dropped. Dead but present; matches the "fix a finding, migrate" pattern [07-sql-migrations.md §5](07-sql-migrations.md) describes, just not fully cleaned up.

5. **All of the above is only checkable because of MCP access to the live project.** As established in [07-sql-migrations.md](07-sql-migrations.md), the RPC definitions this document quotes exist nowhere in the repo as `.sql` files — a future contributor reading only the checked-in code has no way to see `engineer_pin_login`'s lockout logic, `portal_pin_verify`'s bcrypt check, or `is_office()`'s definition without live database access. This document is a snapshot of what those functions do as of the date this review was performed, not a substitute for capturing them as real, versioned migration files.

---

## See also

- [05-database.md](05-database.md) — `users`/`persons`/`agencies`/`agents` schema, columns, the `client_person_id`/`client_agency_id` loose-reference pattern, RLS policy counts
- [06-supabase.md](06-supabase.md) — Storage, Realtime, and full RLS policy reference (once written)
- [07-sql-migrations.md](07-sql-migrations.md) — why the engineer PIN-login and portal-PIN RPCs quoted throughout this document exist only live, not as repo files, and the full list of missing migrations
- [`docs/security/18-known-issues.md`](../security/18-known-issues.md) — formal tracking of open items (being written separately) — §5 above should be cross-referenced there
