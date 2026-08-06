# Real push notifications — database setup

Genuinely free — Web Push doesn't need a paid service. The two VAPID keys
below are a real, freshly-generated key pair (P-256 ECDSA), generated
locally on this machine, used by nobody else. There's no account to sign
up for; they're just your app's own signing identity for push messages.

**Keep the private key secret** — it goes into the Supabase Edge Function's
environment secrets in the next phase (Phase 6B), never into any HTML file.
The public key is safe to expose (it already will be, in `client-portal.html`).

```
VAPID_PUBLIC_KEY  = BCM7SAk356QodrcNAwoO7gOSwXnfGb7ooqN514kYfR8Fv72h1gbkMD23REa7toVURlZPqTTH8BfpWOJSqLRitTE
VAPID_PRIVATE_KEY = rbO_aJZ2KV6IDHaKIAAOKPccja0L3w8WDpXbpCl-Rz8
```

## What this adds

A table to remember which devices asked to be notified (one client can have
several — phone + laptop, say), and two RPCs the portal calls to
subscribe/unsubscribe. Sending the actual push happens in the Edge Function
(Phase 6B) using the service role key, which bypasses RLS entirely — so this
table is locked down to office-only reads (nobody, including the portal's
own anon session, can list who's subscribed) while still letting anon
subscribe/unsubscribe their *own* device.

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_table text NOT NULL,
  entity_id text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_entity_idx ON push_subscriptions(entity_table, entity_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
-- No policies granted to anon/authenticated at all — the table is reachable
-- only through the RPCs below (anon) and the Edge Function (service role,
-- which always bypasses RLS regardless of policies).

CREATE OR REPLACE FUNCTION portal_push_subscribe(p_table text, p_id text, p_endpoint text, p_p256dh text, p_auth text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_table NOT IN ('persons','agencies','agents') THEN
    RAISE EXCEPTION 'Invalid table: %', p_table;
  END IF;
  INSERT INTO push_subscriptions(entity_table, entity_id, endpoint, p256dh, auth)
  VALUES (p_table, p_id, p_endpoint, p_p256dh, p_auth)
  ON CONFLICT (endpoint) DO UPDATE SET entity_table=EXCLUDED.entity_table, entity_id=EXCLUDED.entity_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth;
END;
$$;

CREATE OR REPLACE FUNCTION portal_push_unsubscribe(p_endpoint text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM push_subscriptions WHERE endpoint = p_endpoint;
END;
$$;

REVOKE EXECUTE ON FUNCTION portal_push_subscribe(text,text,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION portal_push_unsubscribe(text) FROM PUBLIC;
-- Explicit anon revoke too — see PHASE5C, the FROM PUBLIC revoke alone
-- doesn't remove Supabase's separate default auto-grant to anon.
REVOKE EXECUTE ON FUNCTION portal_push_subscribe(text,text,text,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION portal_push_unsubscribe(text) FROM anon;

GRANT EXECUTE ON FUNCTION portal_push_subscribe(text,text,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION portal_push_unsubscribe(text) TO anon, authenticated;
```

Note I explicitly `REVOKE ... FROM anon` before `GRANT ... TO anon` on
purpose — after finding the real gap in Phase 5C where a revoke-from-PUBLIC
alone didn't stop the auto-grant, I'm not trusting that pattern silently
again. Here anon SHOULD have access (clients need to subscribe themselves),
so the explicit revoke+grant pair just guarantees the *intended* state
either way, rather than relying on whatever Supabase's default happened to
already set up.

Once you've run this, tell me and I'll verify these two RPCs work correctly
against your live database (same method as the PIN system — a throwaway
test row, not a real client) before moving to Phase 6B.
