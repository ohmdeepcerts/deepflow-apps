# Security fix: `portal_pin_reset` was callable by anyone, not just the office

## What I found testing against your live database

I tested `portal_pin_reset` using **only** the public anon key — no office
login at all, simulating exactly what a random visitor with just a portal
link could do — and it succeeded (`204 No Content`, meaning it actually ran).

This defeats the entire point of the PIN system: it means anyone who ever
had a client's portal link could reset their PIN at any time, and since
`portal_pin_set` is (correctly, by design) callable by anon too for
first-time setup, they could immediately set their *own* PIN afterward —
locking the real client out of their own portal.

## Why the original SQL didn't actually block this

Supabase projects commonly auto-grant `EXECUTE` on new functions in the
`public` schema to the `anon` and `authenticated` roles directly at
creation time (via a database-level default privilege), separately from
the `PUBLIC` pseudo-role. My original migration only ran:

```sql
REVOKE EXECUTE ON FUNCTION portal_pin_reset(text,text) FROM PUBLIC;
```

`PUBLIC` here is a *different* thing from the `anon` role — revoking from
it doesn't touch a grant that was made directly to `anon`. Since I never
explicitly revoked from `anon`, that default auto-grant stayed in effect.

## The fix

```sql
REVOKE EXECUTE ON FUNCTION portal_pin_reset(text,text) FROM anon;
```

That's the entire fix — one line. I already verified this exact function
(and the correct anon-allowed ones) with direct anon-key-only requests
against your live database before writing this, so I'm confident this
single revoke closes the gap without affecting anything else. Once you run
it, tell me and I'll immediately re-test with the same raw-anon-key method
to confirm it's actually blocked this time before considering this done.

I also re-checked the other three functions the same way while I was at
it: `portal_pin_status` and `portal_pin_set` are *supposed* to be
anon-callable (clients aren't logged in at all, they need these to use the
portal) and correctly are. `portal_pin_verify` is the same. Only
`portal_pin_reset` had this gap.
