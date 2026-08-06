# Fix: every portal request got the same reference number (CR-0001)

## What was actually happening

Confirmed from your screenshot — every request showed `CR-0001`. The old code
tried to work out the next number by reading all existing `engineer_requests`
rows and finding the highest `[CR-xxxx]` it could parse out of the notes text.
That read goes through the anonymous key, and anonymous visitors don't have
SELECT access to `engineer_requests` (correctly — it holds internal
office/engineer data too). The query didn't error, it just silently came back
with **zero rows**, so the "highest number found" was always 0, and every
request became `CR-0001`. This wasn't an office-app or "before accepting"
issue — it never got as far as looking at real data at all.

## The real fix

Counting rows client-side was also fragile on its own merits — two people
submitting at the exact same moment could both compute the same "next"
number. So instead of patching the broken read, this replaces the whole
approach with a proper Postgres sequence, which is atomic by construction —
no read, no race condition, no RLS dependency.

```sql
-- Seed the sequence starting from whatever the highest real number already
-- used in your data is (so it continues on cleanly rather than restarting
-- at 1 and re-colliding with old CR-0001-labeled rows).
DO $$
DECLARE maxn int;
BEGIN
  SELECT COALESCE(MAX((regexp_match(notes, '\[CR-(\d+)\]'))[1]::int), 0) INTO maxn
  FROM engineer_requests WHERE type = 'portal_request';

  IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname='public' AND sequencename='portal_request_seq') THEN
    EXECUTE format('CREATE SEQUENCE portal_request_seq START %s', maxn + 1);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION portal_next_request_ref()
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT 'CR-'||lpad(nextval('portal_request_seq')::text, 4, '0');
$$;

REVOKE EXECUTE ON FUNCTION portal_next_request_ref() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_next_request_ref() TO anon, authenticated;
```

**How it works once deployed:** `client-portal.html` now calls
`portal_next_request_ref()` to get the number *before* building the request,
instead of trying (and failing) to count existing rows itself. Each call
atomically increments the sequence, so two simultaneous submissions can never
collide, and the number always goes up — no more duplicates.

Note: this doesn't retroactively relabel the existing rows that got stuck at
`CR-0001` — those stay as historical records exactly as submitted. Only new
requests going forward get correct, unique numbers.
