# Fix: "function gen_salt(unknown) does not exist"

## What happened

Tested the new PIN functions directly against your live database and
`portal_pin_set` failed with:

```
function gen_salt(unknown) does not exist
```

Your Supabase project already had the `pgcrypto` extension installed
before the last migration ran — almost certainly in Supabase's own
`extensions` schema, which is where Supabase puts it by default on most
projects. `CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public`
silently did nothing, because the extension already existed (just not
where I asked it to go) — the `IF NOT EXISTS` skips creation entirely
rather than moving it. My functions only searched the `public` schema for
`crypt()`/`gen_salt()`, so they came up empty.

## The fix

Make the two functions that actually use those crypto functions search
both schemas, instead of assuming which one pgcrypto landed in:

```sql
CREATE OR REPLACE FUNCTION portal_pin_set(p_table text, p_id text, p_pin text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE existing text;
BEGIN
  IF p_table NOT IN ('persons','agencies','agents') THEN
    RAISE EXCEPTION 'Invalid table: %', p_table;
  END IF;
  IF p_pin !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 6 digits';
  END IF;
  EXECUTE format('SELECT portal_pin_hash FROM %I WHERE id = $1', p_table) INTO existing USING p_id;
  IF existing IS NOT NULL THEN
    RAISE EXCEPTION 'A PIN is already set for this account';
  END IF;
  EXECUTE format(
    'UPDATE %I SET portal_pin_hash = crypt($1, gen_salt(''bf'')), portal_pin_fail_count = 0, portal_pin_locked_until = NULL WHERE id = $2',
    p_table
  ) USING p_pin, p_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION portal_pin_verify(p_table text, p_id text, p_pin text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE stored text; fails int; lockedUntil timestamptz; ok boolean;
BEGIN
  IF p_table NOT IN ('persons','agencies','agents') THEN
    RAISE EXCEPTION 'Invalid table: %', p_table;
  END IF;
  EXECUTE format('SELECT portal_pin_hash, portal_pin_fail_count, portal_pin_locked_until FROM %I WHERE id = $1', p_table)
    INTO stored, fails, lockedUntil USING p_id;

  IF stored IS NULL THEN RETURN false; END IF;
  IF lockedUntil IS NOT NULL AND lockedUntil > now() THEN RETURN false; END IF;

  ok := (crypt(p_pin, stored) = stored);

  IF ok THEN
    EXECUTE format('UPDATE %I SET portal_pin_fail_count = 0, portal_pin_locked_until = NULL WHERE id = $1', p_table) USING p_id;
  ELSE
    fails := COALESCE(fails,0) + 1;
    IF fails >= 5 THEN
      EXECUTE format('UPDATE %I SET portal_pin_fail_count = $1, portal_pin_locked_until = now() + interval ''15 minutes'' WHERE id = $2', p_table) USING fails, p_id;
    ELSE
      EXECUTE format('UPDATE %I SET portal_pin_fail_count = $1 WHERE id = $2', p_table) USING fails, p_id;
    END IF;
  END IF;

  RETURN ok;
END;
$$;
```

That's the only change — `SET search_path = public, extensions` instead of
just `public`, on these two functions. `portal_pin_status` and
`portal_pin_reset` don't call any crypto functions, so they're unaffected
and don't need to be re-run.

I already cleaned up the temporary test record I used to find this
(`PIN TEST DELETE ME` in Persons) — nothing was left behind, and no real
client's data was touched.
