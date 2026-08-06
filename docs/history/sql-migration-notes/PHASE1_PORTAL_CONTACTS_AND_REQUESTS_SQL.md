# Portal Contacts table + Request History RPC — run these yourself

Two additions, both needed for the Client Portal changes just made.

---

## 1. `portal_contacts` table (Call Us numbers)

Backs the new "☎ Portal Contacts" tab in Office App → Settings, and the
"Call Us" button in the Client Portal (replacing the old dead `tel:0`
"Emergency" button). This is public business contact info (label, name,
phone) — not personal/sensitive — so a plain anonymous SELECT policy is
appropriate here, no RPC needed.

```sql
CREATE TABLE IF NOT EXISTS portal_contacts (
  id text PRIMARY KEY,
  label text,
  contact_name text,
  phone text,
  sort_order int DEFAULT 0,
  created timestamptz DEFAULT now()
);

ALTER TABLE portal_contacts ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous Client Portal visitors) can read these — they're
-- meant to be publicly visible contact numbers, same as a phone number on a website.
CREATE POLICY "portal_contacts_public_read"
ON portal_contacts FOR SELECT
USING (true);

-- Only logged-in staff can add/edit/delete them.
CREATE POLICY "portal_contacts_staff_write"
ON portal_contacts FOR ALL TO authenticated
USING (true) WITH CHECK (true);
```

**How it works once deployed:** Office App → Settings → ☎ Portal Contacts →
add a label (e.g. "Repairs"), the contact's name, and their number. The
Client Portal's "Call Us" quick-action button reads this table and shows
each one as a tap-to-call link.

---

## 2. `portal_get_requests` RPC (Request History)

The "Your Request History" section on the Client Portal's New Job page has
never actually been able to load anything — it was querying the
`engineer_requests` table directly, which anonymous portal visitors don't
have SELECT access to (correctly, since that table holds internal
office/engineer data too). It was silently failing and always showing
"No previous requests found," which is what you were seeing.

Fixed the same way as everything else in the portal redesign — a narrow
SECURITY DEFINER function instead of a direct table read:

```sql
CREATE OR REPLACE FUNCTION portal_get_requests(p_name text)
RETURNS SETOF engineer_requests
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM engineer_requests
  WHERE engineer_name ILIKE '%'||p_name||'%' AND type = 'portal_request'
  ORDER BY created DESC LIMIT 50;
$$;

REVOKE EXECUTE ON FUNCTION portal_get_requests(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_get_requests(text) TO anon, authenticated;
```

**How it works once deployed:** the Client Portal now calls this function
instead of reading the table directly, so a client's past requests (with
their `[CR-xxxx]` reference and current status — Pending / Confirmed / Job
Booked / Declined) will actually show up on the New Job page.

**Note on live job status:** this restores visibility into the *request's*
own status field (which office staff presumably already set when they
review a request), but it does not yet create a live link showing "your
request CR002 is now job JOB-xxxx, in progress" — that's the follow-up
item we agreed to hold until you confirm how office staff currently convert
an accepted request into a job.
