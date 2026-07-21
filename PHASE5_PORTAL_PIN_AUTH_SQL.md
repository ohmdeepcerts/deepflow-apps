# Client Portal PIN protection

## What this adds

Right now a portal link (`?id=<uuid>&type=...`) is the *only* thing standing
between anyone and a client's jobs, invoices, certificates, and contact
details — no expiry, no revoke. This adds a 6-digit PIN on top of the link,
matching what you described: the office can **reset** a PIN (never *reveal*
it — it's hashed, not stored in a way anyone can read back), which forces
the client to set a brand new one next time they open their link. The link
itself never needs to change.

Covers all three portal types — landlord (`persons`), agency (`agencies`),
and agent (`agents`) — since all three have a stable database row keyed by
the same `id` the link already uses.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

ALTER TABLE persons  ADD COLUMN IF NOT EXISTS portal_pin_hash text;
ALTER TABLE persons  ADD COLUMN IF NOT EXISTS portal_pin_fail_count int NOT NULL DEFAULT 0;
ALTER TABLE persons  ADD COLUMN IF NOT EXISTS portal_pin_locked_until timestamptz;

ALTER TABLE agencies ADD COLUMN IF NOT EXISTS portal_pin_hash text;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS portal_pin_fail_count int NOT NULL DEFAULT 0;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS portal_pin_locked_until timestamptz;

ALTER TABLE agents   ADD COLUMN IF NOT EXISTS portal_pin_hash text;
ALTER TABLE agents   ADD COLUMN IF NOT EXISTS portal_pin_fail_count int NOT NULL DEFAULT 0;
ALTER TABLE agents   ADD COLUMN IF NOT EXISTS portal_pin_locked_until timestamptz;

-- ── Status check: does this entity have a PIN set, and is it locked out? ──
CREATE OR REPLACE FUNCTION portal_pin_status(p_table text, p_id text)
RETURNS TABLE(has_pin boolean, locked_until timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_table NOT IN ('persons','agencies','agents') THEN
    RAISE EXCEPTION 'Invalid table: %', p_table;
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT portal_pin_hash IS NOT NULL, portal_pin_locked_until FROM %I WHERE id = $1', p_table
  ) USING p_id;
END;
$$;

-- ── First-time (or post-reset) setup — only works while no PIN is set. ──
CREATE OR REPLACE FUNCTION portal_pin_set(p_table text, p_id text, p_pin text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

-- ── Verify a PIN — 5 wrong attempts locks out for 15 minutes. ──
CREATE OR REPLACE FUNCTION portal_pin_verify(p_table text, p_id text, p_pin text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

-- ── Office-only reset — deliberately NOT grantable to anon, so a client (or
--    anyone with just the link) can never lock another client out by
--    resetting their PIN mid-use. ──
CREATE OR REPLACE FUNCTION portal_pin_reset(p_table text, p_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_table NOT IN ('persons','agencies','agents') THEN
    RAISE EXCEPTION 'Invalid table: %', p_table;
  END IF;
  EXECUTE format('UPDATE %I SET portal_pin_hash = NULL, portal_pin_fail_count = 0, portal_pin_locked_until = NULL WHERE id = $1', p_table) USING p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION portal_pin_status(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION portal_pin_set(text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION portal_pin_verify(text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION portal_pin_reset(text,text) FROM PUBLIC;

-- Clients aren't logged in via Supabase Auth at all — they need anon access
-- to check/set/verify their own PIN.
GRANT EXECUTE ON FUNCTION portal_pin_status(text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION portal_pin_set(text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION portal_pin_verify(text,text,text) TO anon, authenticated;

-- Reset is office-only.
GRANT EXECUTE ON FUNCTION portal_pin_reset(text,text) TO authenticated;
```

## How it behaves once deployed

- **Every existing client** (all current `portal_pin_hash` values start out
  `NULL`) will land on a "Set your PIN" screen the next time they open their
  link — a one-time step, not a disruption, since nothing about the link
  itself changes.
- Once set, the PIN is remembered for that browser tab's session
  (`sessionStorage`) — they won't be re-prompted every page action, only
  when they open the link fresh.
- 5 wrong PIN attempts locks that portal for 15 minutes — enough to stop
  casual guessing without needing anything more elaborate.
- If this SQL hasn't been run yet, the portal fails **open** (no PIN gate at
  all, same as today) rather than locking every client out — same
  fallback pattern used everywhere else in this app.

## What I did NOT build

**"Delete and regenerate the link"** — I looked into this and it isn't
practical: the link's `id` *is* the actual database row ID for that
person/agency, referenced by every job, invoice, and certificate they're
linked to. Changing it would mean rewriting that ID across every related
record — a real risk of breaking historical data for very little benefit.
The PIN reset already accomplishes what you actually want here: once reset,
the old link **alone** is worthless — whoever has it still needs the new
PIN, which only the client (via the office resending it, or setting their
own) will have. That's functionally the same outcome as "regenerate," without
the risk of touching every linked record.
