# Phase 1 Critical — Supabase-Side Fixes (Run These Yourself)

I don't have database admin access (only the public anon key), so these three need to be run by whoever has access to the Supabase SQL Editor for project `dzqyqpuhxdrrpipbehpk`. Run them in this order. After each one, there's a quick way to confirm it worked.

---

## Fix 1 — Lock down Storage write access (C1, most urgent)

**First, look before you leap:** open **Storage → Policies** in the Supabase dashboard and look at the existing policies on the `deepflow` bucket. There is very likely a policy allowing `anon` (or `public`) to `INSERT`/`UPDATE`/`DELETE` — note its exact name, then either delete it via the dashboard UI or drop it by name below. I can't know its exact name without dashboard access, so the SQL below uses `DROP POLICY IF EXISTS` with the most common default names Supabase generates — if none of these match, delete the offending policy manually via the dashboard first.

```sql
-- Remove common overly-permissive default policy names (safe no-ops if they don't exist)
DROP POLICY IF EXISTS "Allow all" ON storage.objects;
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "allow_all" ON storage.objects;
DROP POLICY IF EXISTS "Give anon users access" ON storage.objects;

-- Reads stay public — the app displays photos via public URLs in <img> tags
CREATE POLICY "deepflow_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'deepflow');

-- Writes require a real, logged-in Supabase Auth session
CREATE POLICY "deepflow_authenticated_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'deepflow');

CREATE POLICY "deepflow_authenticated_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'deepflow');

CREATE POLICY "deepflow_authenticated_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'deepflow');
```

**Verify it worked** — run this from a machine with no Supabase login (e.g. a private browser tab hitting the REST API directly, or ask me to re-run the same safe test I used to find this issue): an anonymous `POST` to `/storage/v1/object/deepflow/<any-path>` should now return `401`/`403` instead of `200`. If you want, tell me once you've run this and I'll re-run the exact same safe, self-cleaning test I used originally to confirm.

---

## Fix 2 — Revoke anonymous access to the staff list (C2)

```sql
REVOKE EXECUTE ON FUNCTION get_auth_users() FROM anon;
GRANT EXECUTE ON FUNCTION get_auth_users() TO authenticated;
```

**Verify:** an anonymous call to `POST /rest/v1/rpc/get_auth_users` should now return an error instead of the staff list. The Office App's own "Sync from Supabase" button (Settings → Team) should still work exactly as before, since it only ever calls this after a real login.

---

## Fix 3 — Find out what UPDATE/DELETE policies actually exist (C3 — this is a check, not a change)

Run this to see every policy currently attached to every table, in one view:

```sql
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;
```

**What to look for:** for each table (especially `jobs`, `users`, `invoices`, `agencies`), check the rows where `cmd` is `UPDATE` or `DELETE`. If `roles` includes `{anon}` or the policy has no role restriction and its `qual`/`with_check` is just `true`, that table currently allows anonymous updates/deletes to real data — the same category of issue as Fix 1, just on the database tables instead of Storage.

**If you find any table with an open UPDATE/DELETE policy for `anon`**, the fix follows the same shape as the `users` policy the app's own Settings → Guide & SQL panel already documents correctly:

```sql
-- Example pattern — adjust the table name and condition per what you find above
DROP POLICY IF EXISTS "<the open policy's name>" ON <table_name>;
CREATE POLICY "<table_name>_authenticated_write"
ON <table_name> FOR UPDATE TO authenticated
USING (true) WITH CHECK (true);
-- (repeat FOR DELETE if needed)
```

Send me what the query in Fix 3 returns (just the table/cmd/roles columns are enough — no need to share row data) and I'll tell you exactly which tables, if any, need tightening and give you the precise `DROP`/`CREATE POLICY` statements for each.

---

## After all three

Let me know once you've run these (or share the Fix 3 results), and I'll re-verify everything the same safe way I used originally — testing against data that's already empty, never touching real records — and update the security documentation to reflect the fixed state.
