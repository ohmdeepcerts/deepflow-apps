# 07 — SQL & Migrations

## 1. There Is No Migration System

This is the single most important fact in this document: DeepFlow has **no migration files, no schema version history, and no automated way to reproduce its database schema from scratch.** There is no `supabase/migrations` folder anywhere in the repository. The database schema exists only as whatever SQL has actually, manually, been run by an administrator in the Supabase SQL Editor over the project's lifetime — some of it documented, some of it (per live testing — see [06_Supabase.md](06_Supabase.md) Section 6) apparently not run at all despite being documented as if it were a completed setup step.

## 2. Where the SQL Actually Lives

Every SQL statement in this project is embedded as plain text inside the Office App's own JavaScript, shown to an administrator in Settings → **Guide & SQL**, as copy-paste blocks with a "click to copy" button. This panel is simultaneously the project's schema documentation, its setup instructions, and its troubleshooting guide — there is no separate `.sql` file anywhere.

## 3. Every SQL Statement, Catalogued

### 3.1 Certificate reminder scheduling (Task 27)
```sql
CREATE TABLE IF NOT EXISTS cert_reminder_log (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  cert_id text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  days_before int,
  method text DEFAULT 'whatsapp'
);
CREATE INDEX IF NOT EXISTS idx_cert_reminder_log_cert ON cert_reminder_log(cert_id, sent_at);

CREATE OR REPLACE FUNCTION send_cert_reminders()
RETURNS TABLE(cert_id text, address text, landlord text, cert_type text, expiry_date date, days_left int, phone text)
LANGUAGE plpgsql SECURITY DEFINER AS $$ ... $$;

SELECT cron.schedule('deepflow-cert-reminders', '0 9 * * *', $$ SELECT send_cert_reminders(); $$);
```
**Purpose:** find certificates due a reminder (at 60/30/14/7/1 days before expiry) and log them once, without re-sending the same reminder within 2 days. **Execution order:** table → function → schedule (three dependent steps). **Live status:** the table exists; the function and the scheduled job do **not** — only step one of three was actually completed. **Depends on:** the `pg_cron` Postgres extension being enabled on the project (unverified). **Related tables:** reads `certs` and `persons`. **Recommended improvement:** finish steps two and three, or remove the false impression (in the admin panel's own wording) that this feature is fully documented and ready — it currently looks more complete than it is.

### 3.2 Engineer requests table
```sql
CREATE TABLE IF NOT EXISTS engineer_requests (
  id text primary key, engineer_name text not null, type text not null,
  date text, hours numeric, rate text, job text, leave_type text,
  leave_from text, leave_to text, notes text, status text default 'pending',
  office_reply text, created bigint default extract(epoch from now())*1000
);
ALTER TABLE engineer_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON engineer_requests FOR ALL USING (true) WITH CHECK (true);
```
**Live status:** the table exists — but live write-testing (see [15_Security.md](15_Security.md) Section 3.2) found anonymous `INSERT` is currently **rejected**, meaning either this exact `allow_all` policy was never actually applied, or a more restrictive policy has since replaced it. **Recommended improvement:** verify directly which policy is actually attached today, given this table needs to accept anonymous writes from the Client Portal by design.

### 3.3 Engineer alerts table
```sql
CREATE TABLE IF NOT EXISTS engineer_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), target text DEFAULT 'all',
  type text DEFAULT 'info', title text, message text, sent_by text,
  created bigint, expires bigint, status text DEFAULT 'active'
);
ALTER TABLE engineer_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON engineer_alerts FOR ALL USING (true) WITH CHECK (true);
```
**Live status:** table exists (confirmed via successful reads in earlier testing). **Special property:** this exact SQL is also embedded as a JavaScript string (`_ALERTS_SQL`) that the Office App can attempt to run automatically via the `exec_sql` RPC (Section 3.5) if this table is ever found missing — a self-healing setup step, though `exec_sql` itself is confirmed not installed, so this automatic path currently cannot actually run; the app would fall back to showing this SQL to the admin manually.

### 3.4 GPS/location columns on `users`
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_lat double precision;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_lng double precision;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen bigint;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_accuracy integer;
```
**Live status:** confirmed present. **Required for:** the Employee App's GPS reporting and the Office App's Live Maps screen — see [03_Employee_App.md](03_Employee_App.md) and [02_Office_App.md](02_Office_App.md).

### 3.5 `get_auth_users()` — enable Team sync
```sql
CREATE OR REPLACE FUNCTION get_auth_users()
RETURNS TABLE(id uuid, email text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, public AS $$ ... $$;
```
**Live status:** installed and working — but, per direct testing, callable by anyone, not just logged-in admins. See [06_Supabase.md](06_Supabase.md) Section 6 and [15_Security.md](15_Security.md) Section 3.4 for the fix.

### 3.6 `create_confirmed_user(email, password)` — instant-active staff logins
A `SECURITY DEFINER` function that directly inserts rows into `auth.users` and `auth.identities`, pre-confirmed, bypassing Supabase's normal email-verification flow. **Live status:** not installed. **Recommended improvement:** if installed, this function's own execute grant should be restricted to `authenticated` admins only, for the same reason as `get_auth_users()` — it is at least as sensitive, arguably more so, since it can create new login credentials.

### 3.7 Users table RLS fix (Fix 1)
```sql
CREATE POLICY "users_read" ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "users_insert" ON users FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "users_update" ON users FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.auth_id = auth.uid() AND u.role='admin' AND u.active=true)) WITH CHECK (true);
CREATE POLICY "users_delete" ON users FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users u WHERE u.auth_id = auth.uid() AND u.role='admin' AND u.active=true));
```
**Purpose:** the one example, in the whole admin panel, of a properly role-scoped policy rather than a blanket `allow_all` — worth using as the template for tightening every other table (see [19_Future_Roadmap.md](19_Future_Roadmap.md)).

### 3.8 Invoice column fixes
```sql
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS agentcc text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS agentname text;
... (several more ADD COLUMN IF NOT EXISTS statements) ...
DROP POLICY IF EXISTS "invoices_office_only" ON invoices;
CREATE POLICY "invoices_auth" ON invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);
```
**Purpose:** a reactive fix, added after invoice saves were apparently failing due to missing columns — direct evidence that this project's schema evolved through "fix it when it breaks" rather than planned migrations.

### 3.9 "Quick reference" query library
A further ~15 read-only `SELECT` statements (view all jobs, jobs by engineer this month, certificates expiring in 90 days, etc.) and maintenance statements (delete old completed jobs, reset an engineer PIN, clear GPS data) — provided as an ad hoc reporting/admin toolkit for someone comfortable pasting SQL directly into the Supabase dashboard. Full text: the Office App's own Settings → Guide & SQL screen, or `renderSqlSnippets()` in `index.html`.

## 4. Recommended Improvements (SQL & Migrations Specifically)

1. **Adopt a real migration tool** (the Supabase CLI's own migration system is the natural fit, given this is already a Supabase project) so schema changes are version-controlled, reviewable, and reproducible — rather than living only as copy-paste instructions and whatever an admin happened to actually run.
2. **Reconcile the admin panel with reality** — several sections currently describe a feature as "run this once and it's ready" when live testing shows the corresponding function was never installed (Section 3.1, 3.6). This should either be fixed (install the missing pieces) or the documentation corrected to reflect what's actually active.
3. **Verify and record which RLS policy is actually attached to each table today**, directly in the Supabase dashboard — this review found real, live evidence that the *documented* `allow_all` pattern does not match the *actual* behaviour on several tables (Section 3.2), meaning the current live policies are, at minimum, undocumented, and possibly the result of ad hoc changes made outside this admin panel entirely.
