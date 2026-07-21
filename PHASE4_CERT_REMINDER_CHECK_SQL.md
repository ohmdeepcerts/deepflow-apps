# Fix: the "Check if pg_cron is active" button lies

## What was actually happening

Settings → the "Task 27 — Scheduled Cert Expiry Reminders" panel has a
"✓ Check if pg_cron is active" button. Looking at what it actually does:
it calls an RPC named `query_cron_jobs` that was **never created anywhere**
(the call silently fails and its result is discarded — the code doesn't
even look at it), then falls back to checking only whether the
`cert_reminder_log` **table** exists, and reports "✅ Step 2 complete" if
so — with no check at all for whether the actual `send_cert_reminders()`
function or the daily cron schedule exist.

This is exactly the trap described in the audit: it's very easy to run
just the first SQL block (table creation) from that panel, click "Check,"
see a green checkmark, and reasonably believe the whole feature is live —
when in fact nothing is actually sending reminders, because Steps 3 and 4
were never run.

## The fix

A real, honest 3-part introspection function that checks the table, the
function, and the cron schedule independently and reports each one.

```sql
CREATE OR REPLACE FUNCTION check_cert_reminder_setup()
RETURNS TABLE(step text, done boolean, detail text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Step 2: table
  RETURN QUERY SELECT 'table'::text,
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cert_reminder_log'),
    'cert_reminder_log table'::text;

  -- Step 3: function
  RETURN QUERY SELECT 'function'::text,
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
           WHERE n.nspname='public' AND p.proname='send_cert_reminders'),
    'send_cert_reminders() function'::text;

  -- Step 4: cron schedule — requires the pg_cron extension itself to be
  -- enabled (Database → Extensions in the dashboard, can't be done from
  -- SQL alone). If it isn't enabled yet, cron.job doesn't exist at all —
  -- catch that specific case and report it plainly instead of erroring.
  BEGIN
    RETURN QUERY SELECT 'cron'::text,
      EXISTS(SELECT 1 FROM cron.job WHERE jobname='deepflow-cert-reminders'),
      'daily 9am schedule'::text;
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    RETURN QUERY SELECT 'cron'::text, false,
      'pg_cron extension not enabled yet (Database → Extensions)'::text;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION check_cert_reminder_setup() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_cert_reminder_setup() TO authenticated;
```

I've also updated the "Check if pg_cron is active" button in the app to
call this and show all three steps honestly instead of one misleading
checkmark.

## What I did NOT do, and why

Two remaining pieces of this feature genuinely need action from you, not
code from me:

1. **Enabling the `pg_cron` extension** — this is a toggle in your
   Supabase dashboard (Database → Extensions), not something reachable
   from SQL run through the editor. The in-app panel already has a button
   that opens that page directly for you.
2. **Actually sending the WhatsApp messages** — `send_cert_reminders()`
   only *logs* which certificates need a reminder today into
   `cert_reminder_log`; it doesn't send anything itself (there's no
   WhatsApp Business API access from inside Postgres). The app's own
   panel already documents the intended approach: a Make/Zapier/n8n
   webhook that runs each morning, reads that day's `cert_reminder_log`
   rows, and sends the actual messages. That requires choosing and
   configuring a third-party automation service, which isn't something I
   can do on your behalf.

Once you've enabled the extension and run the original Task 27 SQL (table
+ function + `cron.schedule(...)` call) plus this checker, the "Check"
button will tell you honestly which of the three steps are actually done.
