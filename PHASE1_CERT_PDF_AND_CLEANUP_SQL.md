# Certificate PDF column + final RLS cleanup — run these yourself

Two unrelated things bundled in one file since they're both quick.

---

## 1. Add the PDF columns to `certs` (needed for the new upload feature)

The Office App can now attach a signed PDF to a certificate, and the Client
Portal shows a "Download" button once one exists. This just adds storage for
the file's public URL and its Storage path (kept so a "Remove PDF" can also
delete the underlying file).

```sql
ALTER TABLE certs ADD COLUMN IF NOT EXISTS pdf_url text;
ALTER TABLE certs ADD COLUMN IF NOT EXISTS pdf_path text;
```

**Also run this** — unrelated to PDFs, but you'll hit it immediately when you try to
save any certificate right now. The "Add / Edit" form has an "Agent / Agency"
field that writes to a column that was never added to the table (this is why
you got `Could not find the 'agent' column of 'certs' in the schema cache` —
every certificate save is currently failing with a 400, not just new PDF ones):

```sql
ALTER TABLE certs ADD COLUMN IF NOT EXISTS agent text;
```

That's it — no RLS changes needed here. The Client Portal already reads
certs through `portal_get_certs()`, which does `SELECT *`, so the new columns
flow through automatically once you deploy the updated files. Uploads from
the Office App go through Supabase Storage using your already-logged-in
session, protected by the `deepflow_authenticated_insert` policy from Phase 1.

**How it works once deployed:** open a certificate for editing in the Office
App → "Certificate Document (PDF)" section → Upload PDF. (Brand-new,
not-yet-saved certificates need to be saved once first — Storage needs a real
certificate ID to attach the file to.) The Client Portal will then show a
"Download" button on that certificate automatically.

---

## 2. Final cleanup — remove the old unscoped policies

This is the step I said I'd hold off on until the new RPC-based Client Portal
was confirmed working live. You've now tested it against the real deployed
portal link and it works correctly, so this is safe to run.

**What this does:** removes anonymous (`anon`) SELECT access to `persons`,
`agencies`, `agents`, `jobs`, and `invoices` directly — access to this data
now only goes through the `portal_get_*()` functions from
`PHASE1_PORTAL_RPC_SQL.md`, which only ever return one client's own data.
Direct anonymous table reads become impossible after this, which is the
correct end state.

**Before running:** double check nothing else in your stack (a report tool,
a Zapier integration, anything besides the three app files) reads these
tables directly using the anon key. If everything reads through the apps
only, you're clear to run this.

```sql
-- Run the check below first if you want to see exact policy names before dropping.
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname='public' AND tablename IN ('persons','agencies','agents','jobs','invoices')
ORDER BY tablename, cmd;
```

Once you've confirmed the policy names match what's below (or adjust names
to match what the check above returns), run:

```sql
-- Adjust policy names below to match exactly what the SELECT above returned
-- for anon-role SELECT policies on each table.
DROP POLICY IF EXISTS "Enable read access for all users" ON persons;
DROP POLICY IF EXISTS "Enable read access for all users" ON agencies;
DROP POLICY IF EXISTS "Enable read access for all users" ON agents;
DROP POLICY IF EXISTS "Enable read access for all users" ON jobs;
DROP POLICY IF EXISTS "Enable read access for all users" ON invoices;
```

**Important:** the Office App and Employee App log in with real Supabase Auth
sessions (`authenticated` role), so if these old policies were scoped to
`anon` only, dropping them won't affect staff at all — only anonymous portal
traffic, which now goes through the RPCs instead. If any of these tables'
existing SELECT policy also covers `authenticated`, don't drop it — only drop
the `anon`-facing one.

Send me the output of the `SELECT ... FROM pg_policies` check above if you
want me to confirm the exact policy names to drop before you run the `DROP`
statements — safer than guessing generic names.
